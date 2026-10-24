-- =============================================================================
-- 0004 — backend completion (forward-only; safe to apply on top of 0001–0003)
--   1. FIX  handle_new_user: a 1-character e-mail local part ("c@x.com") broke sign-up.
--   2. Rate limiting for learner RPCs.
--   3. RPC-only reads (the app no longer needs PostgREST table embedding).
--   4. Mistake Vault + targeted practice in SQL.
--   5. Service-role helpers for the Edge Functions.
-- Every function is SECURITY DEFINER with a pinned search_path; learner functions verify auth.uid().
-- =============================================================================

-- ------------------------------------------------------------------ 1. sign-up fix
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  nm := left(trim(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1))), 60);
  if char_length(nm) < 2 then nm := 'Learner'; end if;      -- never let a display-name rule block account creation
  insert into public.profiles (id, display_name) values (new.id, nm);
  return new;
end $$;

-- ------------------------------------------------------------------ 2. rate limiting
create table public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null default now(),
  hits int not null default 0,
  primary key (user_id, bucket)
);
alter table public.rate_limits enable row level security;       -- no policies: invisible to clients
revoke all on public.rate_limits from anon, authenticated;

-- Fixed-window counter. Raises 'rate_limited' (SQLSTATE 54000) when the bucket is exhausted.
create or replace function public._rate_limit(p_user uuid, p_bucket text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
declare h int;
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, hits) values (p_user, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update set
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end,
    hits         = case when r.window_start < now() - p_window then 1 else r.hits + 1 end
  returning hits into h;
  if h > p_max then raise exception 'rate_limited' using errcode = '54000'; end if;
end $$;
-- service-role entry point (Edge Functions pass the verified user id)
create or replace function public.rate_limit_for(p_user uuid, p_bucket text, p_max int, p_window_seconds int) returns void
language sql security definer set search_path = public as $$ select public._rate_limit(p_user, p_bucket, p_max, make_interval(secs => p_window_seconds)) $$;

-- Re-define the three learner attempt functions with rate limits (bodies otherwise unchanged from 0003).
create or replace function public.start_or_resume_attempt(p_test_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_test public.tests%rowtype; v_ver public.test_versions%rowtype; v_att public.test_attempts%rowtype;
  have boolean;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._rate_limit(uid, 'start', 30, interval '60 seconds');
  select * into v_test from public.tests where id = p_test_id and publication_status = 'published' and is_listed;
  if not found then raise exception 'test_not_available' using errcode = 'P0002'; end if;
  select * into v_ver from public.test_versions where test_id = v_test.id and version_number = v_test.current_version;
  if not found then raise exception 'test_version_missing' using errcode = 'P0002'; end if;

  select * into v_att from public.test_attempts where user_id = uid and test_id = p_test_id and status = 'in_progress' for update;
  have := found;
  if have and now() > v_att.deadline_at + public.submit_grace() then
    update public.test_attempts set status = 'expired', submission_kind = 'time_expired', submitted_at = v_att.deadline_at,
           time_used_seconds = least(v_ver.duration_seconds, extract(epoch from (v_att.deadline_at - v_att.started_at))::int)
     where id = v_att.id;
    have := false;
  end if;
  if not have then
    begin
      insert into public.test_attempts (user_id, test_id, test_version_id, status, started_at, deadline_at)
      values (uid, p_test_id, v_ver.id, 'in_progress', now(), now() + make_interval(secs => v_ver.duration_seconds))
      returning * into v_att;
    exception when unique_violation then
      select * into v_att from public.test_attempts where user_id = uid and test_id = p_test_id and status = 'in_progress';
    end;
  end if;
  return public.attempt_payload(v_att.id);
end $$;

create or replace function public.get_attempt(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a public.test_attempts%rowtype;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._rate_limit(uid, 'get', 240, interval '60 seconds');
  select * into a from public.test_attempts where id = p_attempt_id and user_id = uid for update;
  if not found then return null; end if;
  if a.status = 'in_progress' and now() > a.deadline_at + public.submit_grace() then
    update public.test_attempts set status = 'expired', submission_kind = 'time_expired', submitted_at = a.deadline_at,
           time_used_seconds = extract(epoch from (a.deadline_at - a.started_at))::int where id = a.id;
  end if;
  return public.attempt_payload(p_attempt_id);
end $$;

create or replace function public.save_responses(p_attempt_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); a public.test_attempts%rowtype; v public.test_versions%rowtype;
  qids text[]; item jsonb; qid text; ans jsonb; sq bigint; cnt int;
  applied int := 0; stale int := 0; rejected jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._rate_limit(uid, 'save', 600, interval '60 seconds');
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then raise exception 'invalid_payload' using errcode = '22023'; end if;
  select * into a from public.test_attempts where id = p_attempt_id and user_id = uid for share;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status <> 'in_progress' then
    return jsonb_build_object('serverNow', now(), 'applied', 0, 'stale', 0, 'rejected', rejected, 'fatal', 'not_in_progress');
  end if;
  if now() > a.deadline_at + public.submit_grace() then
    return jsonb_build_object('serverNow', now(), 'applied', 0, 'stale', 0, 'rejected', rejected, 'fatal', 'deadline_passed');
  end if;
  select * into v from public.test_versions where id = a.test_version_id;
  select array_agg(q->>'id') into qids from jsonb_array_elements(v.public_content->'questions') q;

  for item in select * from jsonb_array_elements(p_items) loop
    qid := item->>'questionId'; ans := coalesce(item->'answer', 'null'::jsonb); sq := coalesce((item->>'seq')::bigint, 0);
    if qid is null or not (qid = any(qids)) then
      rejected := rejected || jsonb_build_array(jsonb_build_object('questionId', qid, 'reason', 'Unknown question.')); continue;
    end if;
    if jsonb_typeof(ans) not in ('null','string','array')
       or (jsonb_typeof(ans) = 'string' and char_length(ans #>> '{}') > 200)
       or (jsonb_typeof(ans) = 'array' and jsonb_array_length(ans) > 10) then
      rejected := rejected || jsonb_build_array(jsonb_build_object('questionId', qid, 'reason', 'Invalid answer.')); continue;
    end if;
    insert into public.responses (attempt_id, question_id, answer, flagged, unsure, seq, saved_at)
    values (a.id, qid, ans, coalesce((item->>'flagged')::boolean, false), coalesce((item->>'unsure')::boolean, false), sq, now())
    on conflict (attempt_id, question_id) do update
      set answer = excluded.answer, flagged = excluded.flagged, unsure = excluded.unsure, seq = excluded.seq, saved_at = now()
      where public.responses.seq < excluded.seq;
    get diagnostics cnt = row_count;
    if cnt = 1 then applied := applied + 1; else stale := stale + 1; end if;
  end loop;
  return jsonb_build_object('serverNow', now(), 'applied', applied, 'stale', stale, 'rejected', rejected);
end $$;

-- finalize_attempt now also returns the stored report when the attempt is already scored.
create or replace function public.finalize_attempt(p_attempt_id uuid, p_user uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.test_attempts%rowtype; v public.test_versions%rowtype;
begin
  if p_kind not in ('learner_submitted','time_expired') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  select * into a from public.test_attempts where id = p_attempt_id and user_id = p_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status = 'in_progress' then
    select * into v from public.test_versions where id = a.test_version_id;
    if now() > a.deadline_at + public.submit_grace() then
      update public.test_attempts set status = 'expired', submission_kind = 'time_expired', submitted_at = a.deadline_at,
             time_used_seconds = v.duration_seconds where id = a.id returning * into a;
    else
      update public.test_attempts set status = 'submitted', submission_kind = p_kind, submitted_at = now(),
             time_used_seconds = least(v.duration_seconds, extract(epoch from (now() - a.started_at))::int) where id = a.id returning * into a;
    end if;
  end if;
  return to_jsonb(a) || jsonb_build_object('result_view', (select r.result_view from public.results r where r.attempt_id = a.id));
end $$;

-- Everything the scoring Edge Function needs in one call (service role only).
create or replace function public.get_scoring_inputs(p_attempt_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'versionNumber', v.version_number, 'content', v.public_content,
    'keys', coalesce((select jsonb_agg(jsonb_build_object('questionId', k.question_id, 'version', k.version, 'marks', k.marks, 'rule', k.rule, 'display', k.display, 'explanation', k.explanation))
              from public.answer_keys k where k.question_id in (select q->>'id' from jsonb_array_elements(v.public_content->'questions') q)), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('questionId', r.question_id, 'answer', r.answer, 'unsure', r.unsure)) from public.responses r where r.attempt_id = a.id), '[]'::jsonb))
  from public.test_attempts a join public.test_versions v on v.id = a.test_version_id where a.id = p_attempt_id;
$$;

create or replace function public.get_answer_keys(p_question_ids text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('questionId', k.question_id, 'version', k.version, 'marks', k.marks, 'rule', k.rule, 'display', k.display, 'explanation', k.explanation)), '[]'::jsonb)
  from public.answer_keys k where k.question_id = any(p_question_ids);
$$;

-- ------------------------------------------------------------------ 3. RPC-only reads
create or replace function public.list_catalogue() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'title', t.title, 'description', t.description,
           'assessmentType', t.assessment_type, 'currentVersion', t.current_version, 'content', v.public_content) order by t.created_at), '[]'::jsonb)
  from public.tests t join public.test_versions v on v.test_id = t.id and v.version_number = t.current_version
  where t.publication_status = 'published' and t.is_listed;
$$;

create or replace function public.get_result(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return (select r.result_view from public.results r join public.test_attempts a on a.id = r.attempt_id where a.id = p_attempt_id and a.user_id = uid);
end $$;

create or replace function public.list_my_results() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(r.result_view order by r.created_at desc) from public.results r join public.test_attempts a on a.id = r.attempt_id where a.user_id = uid), '[]'::jsonb);
end $$;

create or replace function public.list_my_attempts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'userId', a.user_id, 'testId', a.test_id, 'testVersion', v.version_number,
            'status', a.status, 'createdAt', a.created_at, 'startedAt', a.started_at, 'deadlineAt', a.deadline_at, 'submittedAt', a.submitted_at,
            'submissionKind', a.submission_kind) order by a.created_at desc)
          from public.test_attempts a join public.test_versions v on v.id = a.test_version_id where a.user_id = uid), '[]'::jsonb);
end $$;

create or replace function public.list_my_activity() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('type', e.event_type, 'questions', e.questions, 'at', e.created_at) order by e.created_at) from public.activity_events e where e.user_id = uid), '[]'::jsonb);
end $$;

-- Every answer the learner has given (mock reviews + graded practice) — input to the recommendation rules.
create or replace function public.get_answer_records() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(rec order by rec->>'at') from (
      select jsonb_build_object('questionId', i->>'questionId', 'skillTags', coalesce(i->'skillTags', '[]'::jsonb),
               'correct', (i->>'outcome') = 'correct', 'at', r.created_at, 'source', 'mock') as rec
        from public.results r join public.test_attempts a on a.id = r.attempt_id, jsonb_array_elements(r.result_view->'review') i
       where a.user_id = uid
      union all
      select jsonb_build_object('questionId', g->>'questionId', 'skillTags', coalesce(g->'skillTags', '[]'::jsonb),
               'correct', (g->>'outcome') = 'correct', 'at', ps.completed_at,
               'source', case when ps.mode = 'recommended' then 'practice' else 'vault' end)
        from public.practice_sessions ps, jsonb_array_elements(coalesce(ps.performance_summary->'grades', '[]'::jsonb)) g
       where ps.user_id = uid and ps.status = 'completed'
    ) x), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ 4. Mistake Vault
create or replace function public._vault_json(m public.mistake_items) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', m.id, 'userId', m.user_id, 'questionId', m.question_id, 'questionVersion', m.question_version,
    'sourceAttemptId', m.source_attempt_id, 'submitted', m.submitted, 'reason', m.reason, 'skillTags', to_jsonb(m.skill_tags),
    'topicTags', to_jsonb(m.topic_tags), 'passageId', coalesce(m.passage_id, ''), 'status', m.review_status, 'correctStreak', m.correct_streak,
    'freshCorrect', m.fresh_correct, 'reviewCount', m.review_count, 'selfRating', m.self_rating, 'createdAt', m.created_at,
    'lastReviewedAt', m.last_reviewed_at, 'nextReviewAt', m.next_review_at) $$;

create or replace function public.list_my_vault() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(public._vault_json(m) order by m.created_at) from public.mistake_items m where m.user_id = uid), '[]'::jsonb);
end $$;

-- Saves eligible items (incorrect / partial / unanswered / unsure) from a SUBMITTED attempt's stored report.
-- The eligibility comes from the server's own stored review — never from client-supplied outcomes.
create or replace function public.add_to_vault(p_attempt_id uuid, p_question_ids text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rv jsonb; item jsonb; outcome text; reason text; added int := 0; skipped int := 0; cnt int;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._rate_limit(uid, 'vault', 60, interval '60 seconds');
  if not exists (select 1 from public.test_attempts where id = p_attempt_id and user_id = uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select r.result_view into rv from public.results r where r.attempt_id = p_attempt_id;
  if rv is null then raise exception 'not_final' using errcode = '55000'; end if;
  for item in select * from jsonb_array_elements(rv->'review') loop
    outcome := item->>'outcome';
    reason := case when outcome in ('incorrect','partial','unanswered') then outcome when coalesce((item->>'unsure')::boolean, false) then 'unsure' else null end;
    if reason is null then continue; end if;
    if p_question_ids is not null and not ((item->>'questionId') = any(p_question_ids)) then continue; end if;
    insert into public.mistake_items (user_id, question_id, question_version, source_attempt_id, submitted, reason, skill_tags, topic_tags, passage_id, next_review_at)
    values (uid, item->>'questionId', (item->>'version')::int, p_attempt_id, item->'submitted', reason,
            array(select jsonb_array_elements_text(coalesce(item->'skillTags', '[]'::jsonb))),
            array(select jsonb_array_elements_text(coalesce(item->'topicTags', '[]'::jsonb))), item->>'passageId', now() + interval '1 day')
    on conflict (user_id, question_id, question_version) do nothing;                   -- de-duplication
    get diagnostics cnt = row_count;
    if cnt = 1 then added := added + 1; else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- "Understood" is only a note. It can never grant mastery (mirrors selfRate() in src/engine/vault.ts).
create or replace function public.self_rate_vault_item(p_id uuid, p_rating text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.mistake_items%rowtype;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_rating not in ('understood','needs_practice') then raise exception 'invalid_rating' using errcode = '22023'; end if;
  perform public._rate_limit(uid, 'vault', 60, interval '60 seconds');
  select * into m from public.mistake_items where id = p_id and user_id = uid for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_rating = 'needs_practice' then
    update public.mistake_items set self_rating = p_rating, review_status = case when review_status = 'new' then 'new' else 'learning' end,
           correct_streak = 0, next_review_at = now() + interval '1 day' where id = m.id returning * into m;
  else
    update public.mistake_items set self_rating = p_rating where id = m.id returning * into m;
  end if;
  return public._vault_json(m);
end $$;

-- ------------------------------------------------------------------ 5. Targeted practice
alter table public.practice_sessions add column content jsonb not null default '{"questions":[],"passages":[]}';   -- answer-free snapshot

create or replace function public._practice_json(ps public.practice_sessions) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', ps.id, 'mode', ps.mode, 'skill', ps.skill, 'questionIds', to_jsonb(ps.question_ids), 'vaultItemId', ps.vault_item_id,
    'status', ps.status, 'createdAt', ps.created_at, 'completedAt', ps.completed_at, 'grades', ps.performance_summary->'grades') $$;

create or replace function public._has_seen(p_user uuid, p_question text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.results r join public.test_attempts a on a.id = r.attempt_id, jsonb_array_elements(r.result_view->'review') i
                  where a.user_id = p_user and i->>'questionId' = p_question)
      or exists (select 1 from public.practice_sessions ps, jsonb_array_elements(coalesce(ps.performance_summary->'grades', '[]'::jsonb)) g
                  where ps.user_id = p_user and ps.status = 'completed' and g->>'questionId' = p_question);
$$;

-- The hidden practice bank, answer-free. Slug 'practice-bank-reading' is created by the seed.
create or replace function public.get_practice_bank() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_build_object('passages', v.public_content->'passages', 'questions', v.public_content->'questions')
    from public.tests t join public.test_versions v on v.test_id = t.id and v.version_number = t.current_version
   where t.slug = 'practice-bank-reading' and t.publication_status = 'published'), jsonb_build_object('passages', '[]'::jsonb, 'questions', '[]'::jsonb));
end $$;

create or replace function public.create_practice_session(p_mode text, p_skill text, p_question_ids text[], p_vault_item_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); item public.mistake_items%rowtype; ids text[]; sk text := p_skill; vid uuid := null;
  content jsonb; ps public.practice_sessions%rowtype; known int;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._rate_limit(uid, 'practice', 60, interval '60 seconds');
  if p_mode not in ('recommended','vault_retry','vault_fresh') then raise exception 'invalid_mode' using errcode = '22023'; end if;

  if p_mode = 'recommended' then
    ids := p_question_ids;
    if ids is null or cardinality(ids) not between 1 and 10 or cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception 'invalid_payload' using errcode = '22023'; end if;
    if sk is not null and sk !~ '^[a-z_]{1,40}$' then sk := null; end if;
  else
    select * into item from public.mistake_items where id = p_vault_item_id and user_id = uid;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    vid := item.id; sk := item.skill_tags[1];
    if p_mode = 'vault_retry' then
      ids := array[item.question_id];
    else
      if p_question_ids is null or cardinality(p_question_ids) <> 1 or p_question_ids[1] = item.question_id then raise exception 'invalid_payload' using errcode = '22023'; end if;
      ids := p_question_ids;
      -- A "fresh" question must come from the practice bank, share a skill with the mistake, and never have been answered before.
      if not exists (select 1 from jsonb_array_elements(public.get_practice_bank()->'questions') q
                      where q->>'id' = ids[1] and exists (select 1 from jsonb_array_elements_text(q->'skillTags') s where s = any(item.skill_tags)))
         or public._has_seen(uid, ids[1]) then raise exception 'not_fresh' using errcode = '22023'; end if;
    end if;
  end if;

  with src as (select v.public_content c from public.tests t join public.test_versions v on v.test_id = t.id and v.version_number = t.current_version where t.publication_status = 'published'),
       sel as (select q from src, jsonb_array_elements(src.c->'questions') q where q->>'id' = any(ids))
  select jsonb_build_object(
           'questions', coalesce((select jsonb_agg(q order by array_position(ids, q->>'id')) from sel), '[]'::jsonb),
           'passages',  coalesce((select jsonb_agg(distinct p) from src, jsonb_array_elements(src.c->'passages') p where p->>'id' in (select q->>'passageId' from sel)), '[]'::jsonb)),
         (select count(*) from sel)
    into content, known;
  if known <> cardinality(ids) then raise exception 'unknown_question' using errcode = '22023'; end if;

  select * into ps from public.practice_sessions
   where user_id = uid and status = 'created' and mode = p_mode and vault_item_id is not distinct from vid and question_ids = ids limit 1;
  if found then return public._practice_json(ps); end if;       -- same open session: reuse (refresh-safe)
  insert into public.practice_sessions (user_id, mode, skill, question_ids, vault_item_id, content) values (uid, p_mode, sk, ids, vid, content) returning * into ps;
  return public._practice_json(ps);
end $$;

create or replace function public.get_practice_session(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); ps public.practice_sessions%rowtype;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into ps from public.practice_sessions where id = p_id and user_id = uid;
  if not found then return null; end if;
  return jsonb_build_object('session', public._practice_json(ps), 'questions', ps.content->'questions', 'passages', ps.content->'passages');
end $$;

-- ---- service role: grading support
create or replace function public.get_practice_for_grading(p_session_id uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ps public.practice_sessions%rowtype;
begin
  select * into ps from public.practice_sessions where id = p_session_id and user_id = p_user;
  if not found then return null; end if;
  return jsonb_build_object('session', public._practice_json(ps), 'questions', ps.content->'questions',
    'vault', coalesce((select jsonb_agg(public._vault_json(m)) from public.mistake_items m
                        where m.user_id = p_user and ((ps.vault_item_id is not null and m.id = ps.vault_item_id)
                           or (ps.vault_item_id is null and m.question_id = any(ps.question_ids) and m.review_status <> 'mastered'))), '[]'::jsonb));
end $$;

-- Atomic + idempotent: grades, vault progress and the activity event are written together, once.
create or replace function public.store_practice_result(p_session_id uuid, p_user uuid, p_grades jsonb, p_vault_updates jsonb, p_answered int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ps public.practice_sessions%rowtype; u jsonb;
begin
  select * into ps from public.practice_sessions where id = p_session_id and user_id = p_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if ps.status = 'completed' then return public._practice_json(ps); end if;
  update public.practice_sessions set status = 'completed', completed_at = now(), performance_summary = jsonb_build_object('grades', p_grades) where id = ps.id returning * into ps;
  for u in select * from jsonb_array_elements(coalesce(p_vault_updates, '[]'::jsonb)) loop
    update public.mistake_items set review_status = u->>'status', correct_streak = (u->>'correctStreak')::int, fresh_correct = (u->>'freshCorrect')::int,
           review_count = (u->>'reviewCount')::int, last_reviewed_at = (u->>'lastReviewedAt')::timestamptz, next_review_at = (u->>'nextReviewAt')::timestamptz
     where id = (u->>'id')::uuid and user_id = p_user;        -- only the session owner's own items can change
  end loop;
  insert into public.activity_events (user_id, event_type, questions) values (p_user, 'practice_completed', greatest(p_answered, 0));
  return public._practice_json(ps);
end $$;

-- ------------------------------------------------------------------ privileges
revoke all on function
  public._rate_limit(uuid, text, int, interval), public.rate_limit_for(uuid, text, int, int), public.get_scoring_inputs(uuid), public.get_answer_keys(text[]),
  public.list_catalogue(), public.get_result(uuid), public.list_my_results(), public.list_my_attempts(), public.list_my_activity(), public.get_answer_records(),
  public._vault_json(public.mistake_items), public.list_my_vault(), public.add_to_vault(uuid, text[]), public.self_rate_vault_item(uuid, text),
  public._practice_json(public.practice_sessions), public._has_seen(uuid, text), public.get_practice_bank(),
  public.create_practice_session(text, text, text[], uuid), public.get_practice_session(uuid),
  public.get_practice_for_grading(uuid, uuid), public.store_practice_result(uuid, uuid, jsonb, jsonb, int),
  public.start_or_resume_attempt(text), public.get_attempt(uuid), public.save_responses(uuid, jsonb), public.finalize_attempt(uuid, uuid, text),
  public.handle_new_user(), public.submit_grace(), public.is_admin()
  from public, anon, authenticated;

grant execute on function public.list_catalogue() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function
  public.start_or_resume_attempt(text), public.get_attempt(uuid), public.save_responses(uuid, jsonb), public.get_result(uuid),
  public.list_my_results(), public.list_my_attempts(), public.list_my_activity(), public.get_answer_records(), public.list_my_vault(),
  public.add_to_vault(uuid, text[]), public.self_rate_vault_item(uuid, text), public.get_practice_bank(),
  public.create_practice_session(text, text, text[], uuid), public.get_practice_session(uuid)
  to authenticated;
grant execute on function
  public.rate_limit_for(uuid, text, int, int), public.get_scoring_inputs(uuid), public.get_answer_keys(text[]), public.finalize_attempt(uuid, uuid, text),
  public.store_result(uuid, jsonb, int), public.get_practice_for_grading(uuid, uuid), public.store_practice_result(uuid, uuid, jsonb, jsonb, int)
  to service_role;
-- internal helpers (_rate_limit, _vault_json, _practice_json, _has_seen, attempt_payload, submit_grace, handle_new_user) are called only
-- from inside SECURITY DEFINER functions / triggers and are not exposed to API roles.
-- is_admin() must stay executable by authenticated because RLS policies evaluate it as the caller.
