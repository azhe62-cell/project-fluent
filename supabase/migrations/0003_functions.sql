-- =============================================================================
-- Attempt lifecycle functions (authoritative server-side logic).
-- Learner-callable:  start_or_resume_attempt, get_attempt, save_responses
-- Service-role only: finalize_attempt, store_result  (called by the submit-attempt Edge Function)
-- STATUS: not yet executed against a live database (see 0001 header).
-- =============================================================================

-- Network-latency allowance, mirrors SUBMIT_GRACE_MS in src/engine/attempt.ts (5 s).
create or replace function public.submit_grace() returns interval language sql immutable as $$ select interval '5 seconds' $$;

-- Builds the JSON the client receives. Contains the ANSWER-FREE snapshot only.
create or replace function public.attempt_payload(p_attempt_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', a.id, 'userId', a.user_id, 'testId', a.test_id, 'testVersion', v.version_number,
      'status', a.status, 'createdAt', a.created_at, 'startedAt', a.started_at, 'deadlineAt', a.deadline_at,
      'submittedAt', a.submitted_at, 'submissionKind', a.submission_kind),
    'content', v.public_content,
    'responses', coalesce((select jsonb_object_agg(r.question_id,
        jsonb_build_object('questionId', r.question_id, 'answer', r.answer, 'flagged', r.flagged, 'unsure', r.unsure, 'seq', r.seq))
      from public.responses r where r.attempt_id = a.id), '{}'::jsonb),
    'serverNow', now())
  from public.test_attempts a join public.test_versions v on v.id = a.test_version_id
  where a.id = p_attempt_id;
$$;

create or replace function public.start_or_resume_attempt(p_test_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_test public.tests%rowtype; v_ver public.test_versions%rowtype; v_att public.test_attempts%rowtype;
  have boolean;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into v_test from public.tests where id = p_test_id and publication_status = 'published' and is_listed;
  if not found then raise exception 'test_not_available' using errcode = 'P0002'; end if;
  select * into v_ver from public.test_versions where test_id = v_test.id and version_number = v_test.current_version;
  if not found then raise exception 'test_version_missing' using errcode = 'P0002'; end if;

  select * into v_att from public.test_attempts where user_id = uid and test_id = p_test_id and status = 'in_progress' for update;
  have := found;
  if have and now() > v_att.deadline_at + public.submit_grace() then
    -- Abandoned / overdue: record it explicitly as EXPIRED (scored later from saved answers).
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
    exception when unique_violation then   -- parallel tab / double click won the race
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
  select * into a from public.test_attempts where id = p_attempt_id and user_id = uid for update;
  if not found then return null; end if;     -- not yours / doesn't exist: indistinguishable
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
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then raise exception 'invalid_payload' using errcode = '22023'; end if;
  -- FOR SHARE: a concurrent finalize (which takes an exclusive row lock) waits for in-flight saves.
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
    -- Shape/size limits only; full per-type validation (option ids, selectCount) is re-run by the
    -- scoring Edge Function using the shared engine, and invalid answers score as unanswered.
    if jsonb_typeof(ans) not in ('null','string','array')
       or (jsonb_typeof(ans) = 'string' and char_length(ans #>> '{}') > 200)
       or (jsonb_typeof(ans) = 'array' and jsonb_array_length(ans) > 10) then
      rejected := rejected || jsonb_build_array(jsonb_build_object('questionId', qid, 'reason', 'Invalid answer.')); continue;
    end if;
    insert into public.responses (attempt_id, question_id, answer, flagged, unsure, seq, saved_at)
    values (a.id, qid, ans, coalesce((item->>'flagged')::boolean, false), coalesce((item->>'unsure')::boolean, false), sq, now())
    on conflict (attempt_id, question_id) do update
      set answer = excluded.answer, flagged = excluded.flagged, unsure = excluded.unsure, seq = excluded.seq, saved_at = now()
      where public.responses.seq < excluded.seq;           -- stale / out-of-order writes are ignored
    get diagnostics cnt = row_count;
    if cnt = 1 then applied := applied + 1; else stale := stale + 1; end if;
  end loop;
  return jsonb_build_object('serverNow', now(), 'applied', applied, 'stale', stale, 'rejected', rejected);
end $$;

-- ---------------------------------------------------------------- service-role only
-- Idempotent, atomic finalisation (mirrors finalizeAttempt() in src/engine/attempt.ts).
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
  return to_jsonb(a);     -- unchanged if it was already submitted / expired / scored
end $$;

create or replace function public.store_result(p_attempt_id uuid, p_result jsonb, p_answered int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.test_attempts%rowtype; res public.results%rowtype;
begin
  select * into a from public.test_attempts where id = p_attempt_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status = 'scored' then
    select * into res from public.results where attempt_id = a.id; return res.result_view;
  end if;
  if a.status not in ('submitted','expired') then raise exception 'not_final' using errcode = '55000'; end if;
  insert into public.results (attempt_id, raw_score, max_score, section_scores, scoring_version, result_view, metadata)
  values (a.id, (p_result->'score'->>'rawScore')::numeric, (p_result->'score'->>'maxScore')::numeric,
          p_result->'score'->'sectionScores', p_result->'score'->>'scoringVersion', p_result,
          jsonb_build_object('submissionKind', a.submission_kind))
  on conflict (attempt_id) do nothing;
  update public.test_attempts set status = 'scored' where id = a.id;
  insert into public.activity_events (user_id, event_type, questions) values (a.user_id, 'attempt_completed', greatest(p_answered, 0));
  select * into res from public.results where attempt_id = a.id;
  return res.result_view;
end $$;

-- ---------------------------------------------------------------- privileges
revoke all on function public.attempt_payload(uuid), public.start_or_resume_attempt(text), public.get_attempt(uuid),
  public.save_responses(uuid, jsonb), public.finalize_attempt(uuid, uuid, text), public.store_result(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.start_or_resume_attempt(text), public.get_attempt(uuid), public.save_responses(uuid, jsonb) to authenticated;
grant execute on function public.finalize_attempt(uuid, uuid, text), public.store_result(uuid, jsonb, int) to service_role;
grant execute on function public.is_admin() to authenticated;
