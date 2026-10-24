-- ===== migrations/0001_schema.sql =====
-- =============================================================================
-- Project Fluent — schema (PostgreSQL / Supabase)
-- STATUS: written and reviewed, NOT yet executed against a live database in this
-- repository's test run (no PostgreSQL available in the build sandbox). Run it on a
-- development Supabase project and execute docs/DATABASE.md "verification queries".
-- =============================================================================

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 2 and 60),
  target_exam   text,
  study_goal    text check (study_goal is null or char_length(study_goal) <= 200),
  role          text not null default 'learner' check (role in ('learner','admin')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- Creates the profile when an auth user is created. display_name comes from sign-up metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- ------------------------------------------------------------------ content
-- Content ids are stable text slugs (e.g. 'rd01-q03') so seeds are reproducible.
create table public.tests (
  id                  text primary key,
  slug                text not null unique,
  title               text not null,
  description         text not null,
  assessment_type     text not null check (assessment_type in ('reading','listening','writing','speaking')),
  publication_status  text not null default 'draft' check (publication_status in ('draft','in_review','published','archived')),
  is_listed           boolean not null default true,     -- false for the hidden practice bank
  current_version     int not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger tests_updated before update on public.tests for each row execute function public.set_updated_at();

create table public.test_versions (
  id                     text primary key,                -- '<test_id>@v<n>'
  test_id                text not null references public.tests(id) on delete cascade,
  version_number         int  not null,
  duration_seconds       int  not null check (duration_seconds > 0),
  scoring_configuration  jsonb not null default '{}',
  section_configuration  jsonb not null default '[]',
  -- Immutable, answer-free snapshot served to learners. An attempt is bound to ONE version,
  -- so editing a draft can never change what an in-flight attempt shows or how it is scored.
  public_content         jsonb not null,
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  unique (test_id, version_number)
);

create table public.test_sections (
  id                 text primary key,
  test_version_id    text not null references public.test_versions(id) on delete cascade,
  section_type       text not null,
  title              text not null,
  instructions       text,
  display_order      int  not null,
  time_limit_seconds int
);

create table public.passages (
  id          text primary key,
  section_id  text not null references public.test_sections(id) on delete cascade,
  title       text not null,
  content     jsonb not null,
  metadata    jsonb not null default '{}'
);

create table public.questions (
  id                  text primary key,
  section_id          text not null references public.test_sections(id) on delete cascade,
  passage_id          text references public.passages(id) on delete set null,
  question_type       text not null,
  prompt              text not null,
  instructions        text,
  options             jsonb,
  display_number      int not null default 0,
  marks               int not null default 1 check (marks > 0),
  skill_tags          text[] not null default '{}',
  topic_tags          text[] not null default '{}',
  difficulty_estimate smallint not null check (difficulty_estimate between 1 and 3),  -- editorial estimate only
  content_version     int not null default 1,
  publication_status  text not null default 'draft' check (publication_status in ('draft','in_review','published','archived')),
  review_status       text not null default 'unreviewed' check (review_status in ('unreviewed','reviewed','approved')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger questions_updated before update on public.questions for each row execute function public.set_updated_at();

-- Marking data + explanations. NEVER readable by learners: no SELECT policy exists for this table.
-- (Deviation from the brief's column list: `explanation` lives here, not on `questions`, because it
--  reveals the answer and must stay server-side until submission.)
create table public.answer_keys (
  question_id  text not null references public.questions(id) on delete cascade,
  version      int  not null default 1,
  marks        int  not null,
  rule         jsonb not null,
  display      text not null,
  explanation  text not null,
  created_at   timestamptz not null default now(),
  primary key (question_id, version)
);

-- ------------------------------------------------------------------ attempts
create table public.test_attempts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  test_id            text not null references public.tests(id),
  test_version_id    text not null references public.test_versions(id),
  status             text not null default 'created' check (status in ('created','in_progress','submitted','expired','scored')),
  started_at         timestamptz,
  deadline_at        timestamptz,
  submitted_at       timestamptz,
  submission_kind    text check (submission_kind in ('learner_submitted','time_expired')),
  time_used_seconds  int,
  created_at         timestamptz not null default now()
);
-- At most ONE open attempt per learner per test: makes double-clicks and parallel tabs safe.
create unique index one_open_attempt_per_test on public.test_attempts (user_id, test_id) where status = 'in_progress';
create index attempts_user_created on public.test_attempts (user_id, created_at desc);

create table public.responses (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references public.test_attempts(id) on delete cascade,
  question_id    text not null,
  answer         jsonb not null default 'null',
  flagged        boolean not null default false,
  unsure         boolean not null default false,
  seq            bigint not null default 0,          -- client sequence; higher wins, stale writes are ignored
  saved_at       timestamptz not null default now(),
  marking_status text not null default 'unmarked',
  unique (attempt_id, question_id)
);

create table public.results (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null unique references public.test_attempts(id) on delete cascade,  -- ≤ 1 result per attempt
  raw_score        numeric not null,
  max_score        numeric not null,
  section_scores   jsonb not null,
  scoring_version  text not null,
  result_view      jsonb not null,    -- full report snapshot (answers + explanations at time of marking)
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------ learning loop
create table public.mistake_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  question_id        text not null,
  question_version   int  not null,
  source_attempt_id  uuid references public.test_attempts(id) on delete set null,
  submitted          jsonb,
  reason             text not null check (reason in ('incorrect','partial','unanswered','unsure')),
  skill_tags         text[] not null default '{}',
  topic_tags         text[] not null default '{}',
  passage_id         text,
  review_status      text not null default 'new' check (review_status in ('new','learning','mastered')),
  correct_streak     int not null default 0,
  fresh_correct      int not null default 0,
  review_count       int not null default 0,
  self_rating        text check (self_rating in ('understood','needs_practice')),
  created_at         timestamptz not null default now(),
  last_reviewed_at   timestamptz,
  next_review_at     timestamptz,
  unique (user_id, question_id, question_version)       -- vault de-duplication
);

create table public.practice_sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  mode                 text not null check (mode in ('recommended','vault_retry','vault_fresh')),
  skill                text,
  question_ids         text[] not null,
  vault_item_id        uuid references public.mistake_items(id) on delete set null,
  status               text not null default 'created' check (status in ('created','completed')),
  performance_summary  jsonb,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

-- Minimum event data for streaks / daily goal. Never contains answers.
create table public.activity_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null check (event_type in ('attempt_completed','practice_completed')),
  questions   int  not null default 0,
  created_at  timestamptz not null default now()
);
create index activity_user_time on public.activity_events (user_id, created_at desc);


-- ===== migrations/0002_rls.sql =====
-- =============================================================================
-- Row Level Security.
-- Principle: learners can READ their own rows and the published, answer-free content.
-- Every WRITE that matters (start attempt, save answers, submit, score) goes through
-- SECURITY DEFINER functions or Edge Functions that re-check ownership and state.
-- =============================================================================
alter table public.profiles          enable row level security;
alter table public.tests             enable row level security;
alter table public.test_versions     enable row level security;
alter table public.test_sections     enable row level security;
alter table public.passages          enable row level security;
alter table public.questions         enable row level security;
alter table public.answer_keys       enable row level security;
alter table public.test_attempts     enable row level security;
alter table public.responses         enable row level security;
alter table public.results           enable row level security;
alter table public.mistake_items     enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.activity_events   enable row level security;

-- profiles: read own; update ONLY harmless columns (role cannot be self-assigned — column grants below)
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant  update (display_name, target_exam, study_goal) on public.profiles to authenticated;

-- public catalogue (published + listed only; the answer-free snapshot lives in test_versions.public_content)
create policy tests_public_read on public.tests for select to anon, authenticated using (publication_status = 'published' and is_listed);
create policy test_versions_public_read on public.test_versions for select to anon, authenticated
  using (exists (select 1 from public.tests t where t.id = test_id and t.publication_status = 'published' and t.is_listed and t.current_version = version_number));

-- questions / answer_keys / sections / passages: NO learner policies → invisible to learners. Admin only.
create policy admin_all_tests     on public.tests         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_versions  on public.test_versions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_sections  on public.test_sections for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_passages  on public.passages      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_questions on public.questions     for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_keys      on public.answer_keys   for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- learner-owned data: SELECT own only. No INSERT/UPDATE/DELETE policies → clients cannot write directly.
create policy attempts_select_own on public.test_attempts for select to authenticated using (user_id = auth.uid());
create policy responses_select_own on public.responses for select to authenticated
  using (exists (select 1 from public.test_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy results_select_own on public.results for select to authenticated
  using (exists (select 1 from public.test_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy mistakes_select_own on public.mistake_items for select to authenticated using (user_id = auth.uid());
create policy practice_select_own on public.practice_sessions for select to authenticated using (user_id = auth.uid());
create policy activity_select_own on public.activity_events for select to authenticated using (user_id = auth.uid());

-- Defence in depth: strip default table privileges, then grant only what the policies above need.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.tests, public.test_versions to anon, authenticated;
grant select on public.profiles, public.test_attempts, public.responses, public.results,
                public.mistake_items, public.practice_sessions, public.activity_events to authenticated;
grant update (display_name, target_exam, study_goal) on public.profiles to authenticated;
-- admin policies need table privileges for authenticated; the policies (is_admin()) still gate every row.
grant select, insert, update, delete on public.tests, public.test_versions, public.test_sections,
      public.passages, public.questions, public.answer_keys to authenticated;


-- ===== migrations/0003_functions.sql =====
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


-- ===== migrations/0004_backend_completion.sql =====
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


-- ===== seed.sql =====
-- GENERATED by scripts/generate-seed.ts — do not edit by hand.
-- Original demo content only. Contains NO learner accounts or fake statistics.
begin;
insert into public.tests (id, slug, title, description, assessment_type, publication_status, is_listed, current_version) values ('test-reading-mini-01', 'reading-mini-mock-01', 'Reading Mini-Mock 1', 'Two original passages on urban ecology and coastal defence. Nineteen questions across multiple choice, True/False/Not Given, sentence and summary completion, matching and short-answer formats.', 'reading', 'published', true, 1) on conflict (id) do nothing;
insert into public.test_versions (id, test_id, version_number, duration_seconds, scoring_configuration, section_configuration, public_content, published_at) values ('test-reading-mini-01@v1', 'test-reading-mini-01', 1, 1200, '{"scoringVersion":"reading-raw-v1"}'::jsonb, '[{"id":"s-roofs","title":"Passage 1 — The Rooftop Meadow Experiment","passageId":"p-roofs","groups":[{"id":"g1","heading":"Questions 1–2","instructions":"Choose the correct letter, A, B, C or D.","questionIds":["rd01-q01","rd01-q02"]},{"id":"g2","heading":"Questions 3–5","instructions":"Do the following statements agree with the information in the passage? Choose TRUE if the statement agrees, FALSE if it contradicts the passage, or NOT GIVEN if there is no information on this.","questionIds":["rd01-q03","rd01-q04","rd01-q05"]},{"id":"g3","heading":"Questions 6–8","instructions":"Complete each sentence with words from the passage. Use the word limit shown for each question.","questionIds":["rd01-q06","rd01-q07","rd01-q08"]},{"id":"g4","heading":"Question 9","instructions":"Choose TWO letters. This question is worth 2 marks: 1 for each correct choice.","questionIds":["rd01-q09"]}]},{"id":"s-marsh","title":"Passage 2 — Letting the Tide Back In","passageId":"p-marsh","groups":[{"id":"g5","heading":"Question 10","instructions":"Choose the correct letter, A, B, C or D.","questionIds":["rd01-q10"]},{"id":"g6","heading":"Questions 11–13","instructions":"Do the following statements agree with the information in the passage? Choose TRUE, FALSE or NOT GIVEN.","questionIds":["rd01-q11","rd01-q12","rd01-q13"]},{"id":"g7","heading":"Questions 14–15","instructions":"Which paragraph contains the following information? Choose the correct letter, A–E.","questionIds":["rd01-q14","rd01-q15"],"sharedOptions":[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"},{"id":"C","label":"Paragraph C"},{"id":"D","label":"Paragraph D"},{"id":"E","label":"Paragraph E"}]},{"id":"g8","heading":"Questions 16–18","instructions":"Complete the summary below. Write ONE WORD ONLY from the passage for each answer.","questionIds":["rd01-q16","rd01-q17","rd01-q18"],"variant":"summary"},{"id":"g9","heading":"Question 19","instructions":"Answer the question below using NO MORE THAN THREE WORDS from the passage.","questionIds":["rd01-q19"]}]}]'::jsonb, '{"id":"test-reading-mini-01","slug":"reading-mini-mock-01","title":"Reading Mini-Mock 1","description":"Two original passages on urban ecology and coastal defence. Nineteen questions across multiple choice, True/False/Not Given, sentence and summary completion, matching and short-answer formats.","assessmentType":"reading","version":1,"durationSeconds":1200,"scoringNote":"Raw practice marks only (20 available). This is a shortened mini-mock, not a full-length exam, so no band score is estimated.","passages":[{"id":"p-roofs","title":"The Rooftop Meadow Experiment","kicker":"Urban ecology","paragraphs":[{"label":"A","text":"When the council of a mid-sized northern port first proposed planting meadows on municipal roofs in 2014, most residents assumed the plan was merely decorative. Officials, however, had a practical aim: to find out whether flat roofs, which make up almost a fifth of the built-up area, could support the pollinating insects that had been disappearing from the surrounding streets."},{"label":"B","text":"A team led by the ecologist Dr Marit Halloran surveyed forty roofs over six summers. Each roof was planted with one of three seed mixes: a drought-tolerant sedum blend, a mixed wildflower meadow, or a lawn-style grass with scattered clover. Volunteers counted visiting insects for twenty minutes every fortnight, always between ten in the morning and noon, when activity is most stable."},{"label":"C","text":"The results surprised even the researchers. Wildflower roofs attracted on average three times as many species of bee and hoverfly as the sedum roofs, yet the sedum roofs were far cheaper to maintain, needing water only in the driest weeks. The clover-and-grass roofs performed worst of all, attracting mainly common species that were already abundant in the city''s parks."},{"label":"D","text":"Height proved less important than expected. It had been assumed that insects would rarely reach roofs above the tenth floor, but surveys recorded bumblebees on a roof 42 metres above the street. What mattered more was the presence of a \"stepping stone\": another planted roof or garden within roughly 300 metres. Isolated roofs, even those with ideal planting, were visited only occasionally."},{"label":"E","text":"The project also revealed limits. Soil on most roofs was only eight centimetres deep, too shallow for the taller plants that some specialised bees prefer, and several wildflower species died out after three winters. Halloran now argues that the council should fund \"habitat corridors\" — chains of connected roofs — rather than isolated showpieces, and that deeper planting beds should be built into new buildings from the outset. Critics reply that the extra weight would raise construction costs, and that the money would be better spent protecting existing parks."}]},{"id":"p-marsh","title":"Letting the Tide Back In","kicker":"Coastal engineering","paragraphs":[{"label":"A","text":"For centuries, engineers along low-lying coasts did much the same thing: they built walls. Earth embankments held back the tide and turned tidal flats into farmland. By the 1950s, however, many of these walls were failing, and the cost of rebuilding them was beginning to exceed the value of the fields behind them."},{"label":"B","text":"In the 1990s a small number of coastal authorities tried a reversal known as managed realignment. Instead of repairing an old wall, they breached it deliberately, allowing seawater to flood the land behind. Within a few years, salt-tolerant plants such as glasswort and sea lavender had colonised the mud, and their dense stems began to slow the waves that crossed them."},{"label":"C","text":"The protective effect is measurable. Field studies suggest that a marsh a hundred metres wide can reduce wave height by more than half before the water reaches the remaining sea wall, which then needs less maintenance. Marshes also trap sediment, so in some places the land has been rising by several millimetres a year, partly keeping pace with the sea."},{"label":"D","text":"Yet the approach is not without problems. Farmers whose land is flooded must be compensated, and negotiations can last for years. Some new marshes have also developed more slowly than predicted: where land had sunk after centuries of drainage, it sat too low, and tidal water covered it for too long for plants to establish. Engineers have responded by delivering dredged mud to raise the ground before the wall is opened."},{"label":"E","text":"Not everyone is convinced that marshes can replace walls entirely. The ecologist Tomas Reyes points out that a marsh protects best against ordinary storms, whereas the most extreme surges can overtop it. He recommends treating marshes as the first of two lines of defence, with a smaller wall retained behind them."}]}],"sections":[{"id":"s-roofs","title":"Passage 1 — The Rooftop Meadow Experiment","passageId":"p-roofs","groups":[{"id":"g1","heading":"Questions 1–2","instructions":"Choose the correct letter, A, B, C or D.","questionIds":["rd01-q01","rd01-q02"]},{"id":"g2","heading":"Questions 3–5","instructions":"Do the following statements agree with the information in the passage? Choose TRUE if the statement agrees, FALSE if it contradicts the passage, or NOT GIVEN if there is no information on this.","questionIds":["rd01-q03","rd01-q04","rd01-q05"]},{"id":"g3","heading":"Questions 6–8","instructions":"Complete each sentence with words from the passage. Use the word limit shown for each question.","questionIds":["rd01-q06","rd01-q07","rd01-q08"]},{"id":"g4","heading":"Question 9","instructions":"Choose TWO letters. This question is worth 2 marks: 1 for each correct choice.","questionIds":["rd01-q09"]}]},{"id":"s-marsh","title":"Passage 2 — Letting the Tide Back In","passageId":"p-marsh","groups":[{"id":"g5","heading":"Question 10","instructions":"Choose the correct letter, A, B, C or D.","questionIds":["rd01-q10"]},{"id":"g6","heading":"Questions 11–13","instructions":"Do the following statements agree with the information in the passage? Choose TRUE, FALSE or NOT GIVEN.","questionIds":["rd01-q11","rd01-q12","rd01-q13"]},{"id":"g7","heading":"Questions 14–15","instructions":"Which paragraph contains the following information? Choose the correct letter, A–E.","questionIds":["rd01-q14","rd01-q15"],"sharedOptions":[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"},{"id":"C","label":"Paragraph C"},{"id":"D","label":"Paragraph D"},{"id":"E","label":"Paragraph E"}]},{"id":"g8","heading":"Questions 16–18","instructions":"Complete the summary below. Write ONE WORD ONLY from the passage for each answer.","questionIds":["rd01-q16","rd01-q17","rd01-q18"],"variant":"summary"},{"id":"g9","heading":"Question 19","instructions":"Answer the question below using NO MORE THAN THREE WORDS from the passage.","questionIds":["rd01-q19"]}]}],"questions":[{"id":"rd01-q01","version":1,"number":1,"type":"multiple_choice","passageId":"p-roofs","prompt":"What was the council''s main purpose in planting the roofs?","marks":1,"options":[{"id":"A","label":"to make public buildings look more attractive"},{"id":"B","label":"to find out whether roofs could support pollinating insects"},{"id":"C","label":"to reduce heating costs in municipal buildings"},{"id":"D","label":"to grow food for local residents"}],"skillTags":["inference","paraphrase_recognition"],"topicTags":["urban-ecology"],"difficulty":1},{"id":"rd01-q02","version":1,"number":2,"type":"multiple_choice","passageId":"p-roofs","prompt":"Why were the insect counts always made between ten in the morning and noon?","marks":1,"options":[{"id":"A","label":"Fewer volunteers were available later in the day."},{"id":"B","label":"Insects were easier to identify in strong sunlight."},{"id":"C","label":"Insect activity is most consistent at that time."},{"id":"D","label":"Rain was less likely in the morning."}],"skillTags":["locating_detail","paraphrase_recognition"],"topicTags":["urban-ecology","research-method"],"difficulty":2},{"id":"rd01-q03","version":1,"number":3,"type":"true_false_not_given","passageId":"p-roofs","prompt":"Wildflower roofs attracted more species of bee and hoverfly than sedum roofs.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims","locating_detail"],"topicTags":["urban-ecology"],"difficulty":1},{"id":"rd01-q04","version":1,"number":4,"type":"true_false_not_given","passageId":"p-roofs","prompt":"The sedum roofs needed regular watering throughout every summer.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims","paraphrase_recognition"],"topicTags":["urban-ecology"],"difficulty":2},{"id":"rd01-q05","version":1,"number":5,"type":"true_false_not_given","passageId":"p-roofs","prompt":"The volunteers who counted insects were paid for their time.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims"],"topicTags":["urban-ecology","research-method"],"difficulty":2},{"id":"rd01-q06","version":1,"number":6,"type":"sentence_completion","passageId":"p-roofs","prompt":"The clover-and-grass roofs mainly attracted ______ species.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["urban-ecology"],"difficulty":1},{"id":"rd01-q07","version":1,"number":7,"type":"sentence_completion","passageId":"p-roofs","prompt":"Roofs with no other planted site within roughly 300 metres were visited only ______, even when well planted.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["urban-ecology"],"difficulty":2},{"id":"rd01-q08","version":1,"number":8,"type":"sentence_completion","passageId":"p-roofs","prompt":"Halloran believes new buildings should be built with deeper planting ______ from the outset.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["urban-ecology","policy"],"difficulty":2},{"id":"rd01-q09","version":1,"number":9,"type":"multi_select","passageId":"p-roofs","prompt":"Which TWO limitations of the project are mentioned in the passage?","marks":2,"selectCount":2,"options":[{"id":"A","label":"The soil was too shallow for some taller plants."},{"id":"B","label":"Volunteers lost interest in counting insects."},{"id":"C","label":"Some wildflower species did not survive beyond three winters."},{"id":"D","label":"Strong wind made the roofs unsafe to visit."},{"id":"E","label":"The council cut funding after the first six summers."}],"skillTags":["locating_detail","paraphrase_recognition"],"topicTags":["urban-ecology"],"difficulty":3},{"id":"rd01-q10","version":1,"number":10,"type":"multiple_choice","passageId":"p-marsh","prompt":"Which problem with sea walls is described in paragraph A?","marks":1,"options":[{"id":"A","label":"They were too low to stop ordinary tides."},{"id":"B","label":"Rebuilding them could cost more than the land they protected was worth."},{"id":"C","label":"They damaged the farmland behind them."},{"id":"D","label":"Few engineers knew how to maintain them."}],"skillTags":["paraphrase_recognition","locating_detail"],"topicTags":["coastal-engineering"],"difficulty":1},{"id":"rd01-q11","version":1,"number":11,"type":"true_false_not_given","passageId":"p-marsh","prompt":"Managed realignment was first tried in the 1950s.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims","locating_detail"],"topicTags":["coastal-engineering"],"difficulty":1},{"id":"rd01-q12","version":1,"number":12,"type":"true_false_not_given","passageId":"p-marsh","prompt":"Plants that colonise a breached area can slow incoming waves.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims","paraphrase_recognition"],"topicTags":["coastal-engineering"],"difficulty":1},{"id":"rd01-q13","version":1,"number":13,"type":"true_false_not_given","passageId":"p-marsh","prompt":"Creating a salt marsh costs less than building a new sea wall.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims"],"topicTags":["coastal-engineering","policy"],"difficulty":3},{"id":"rd01-q14","version":1,"number":14,"type":"matching_information","passageId":"p-marsh","prompt":"a method used to correct slow marsh development","marks":1,"options":[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"},{"id":"C","label":"Paragraph C"},{"id":"D","label":"Paragraph D"},{"id":"E","label":"Paragraph E"}],"skillTags":["scanning_paragraphs","paraphrase_recognition"],"topicTags":["coastal-engineering"],"difficulty":2},{"id":"rd01-q15","version":1,"number":15,"type":"matching_information","passageId":"p-marsh","prompt":"a warning that marshes may not cope with the most extreme storms","marks":1,"options":[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"},{"id":"C","label":"Paragraph C"},{"id":"D","label":"Paragraph D"},{"id":"E","label":"Paragraph E"}],"skillTags":["scanning_paragraphs","paraphrase_recognition"],"topicTags":["coastal-engineering"],"difficulty":2},{"id":"rd01-q16","version":1,"number":16,"type":"summary_completion","passageId":"p-marsh","prompt":"A marsh one hundred metres wide may reduce wave height by more than ______ before the water reaches the sea wall.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["coastal-engineering"],"difficulty":1},{"id":"rd01-q17","version":1,"number":17,"type":"summary_completion","passageId":"p-marsh","prompt":"Because marshes trap ______, the land in some of them gradually gains height.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["coastal-engineering"],"difficulty":1},{"id":"rd01-q18","version":1,"number":18,"type":"summary_completion","passageId":"p-marsh","prompt":"Where land has sunk too low, engineers deliver dredged ______ to raise it before the wall is breached.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["coastal-engineering"],"difficulty":2},{"id":"rd01-q19","version":1,"number":19,"type":"short_answer","passageId":"p-marsh","prompt":"What does Tomas Reyes suggest keeping behind a marsh?","marks":1,"wordLimit":3,"instructions":"NO MORE THAN THREE WORDS","skillTags":["locating_detail","vocabulary_precision"],"topicTags":["coastal-engineering","policy"],"difficulty":2}]}'::jsonb, now()) on conflict (id) do nothing;
insert into public.test_sections (id, test_version_id, section_type, title, instructions, display_order) values ('s-roofs', 'test-reading-mini-01@v1', 'reading', 'Passage 1 — The Rooftop Meadow Experiment', null, 1) on conflict (id) do nothing;
insert into public.test_sections (id, test_version_id, section_type, title, instructions, display_order) values ('s-marsh', 'test-reading-mini-01@v1', 'reading', 'Passage 2 — Letting the Tide Back In', null, 2) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('p-roofs', 's-roofs', 'The Rooftop Meadow Experiment', '[{"label":"A","text":"When the council of a mid-sized northern port first proposed planting meadows on municipal roofs in 2014, most residents assumed the plan was merely decorative. Officials, however, had a practical aim: to find out whether flat roofs, which make up almost a fifth of the built-up area, could support the pollinating insects that had been disappearing from the surrounding streets."},{"label":"B","text":"A team led by the ecologist Dr Marit Halloran surveyed forty roofs over six summers. Each roof was planted with one of three seed mixes: a drought-tolerant sedum blend, a mixed wildflower meadow, or a lawn-style grass with scattered clover. Volunteers counted visiting insects for twenty minutes every fortnight, always between ten in the morning and noon, when activity is most stable."},{"label":"C","text":"The results surprised even the researchers. Wildflower roofs attracted on average three times as many species of bee and hoverfly as the sedum roofs, yet the sedum roofs were far cheaper to maintain, needing water only in the driest weeks. The clover-and-grass roofs performed worst of all, attracting mainly common species that were already abundant in the city''s parks."},{"label":"D","text":"Height proved less important than expected. It had been assumed that insects would rarely reach roofs above the tenth floor, but surveys recorded bumblebees on a roof 42 metres above the street. What mattered more was the presence of a \"stepping stone\": another planted roof or garden within roughly 300 metres. Isolated roofs, even those with ideal planting, were visited only occasionally."},{"label":"E","text":"The project also revealed limits. Soil on most roofs was only eight centimetres deep, too shallow for the taller plants that some specialised bees prefer, and several wildflower species died out after three winters. Halloran now argues that the council should fund \"habitat corridors\" — chains of connected roofs — rather than isolated showpieces, and that deeper planting beds should be built into new buildings from the outset. Critics reply that the extra weight would raise construction costs, and that the money would be better spent protecting existing parks."}]'::jsonb, '{"kicker":"Urban ecology"}'::jsonb) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('p-marsh', 's-marsh', 'Letting the Tide Back In', '[{"label":"A","text":"For centuries, engineers along low-lying coasts did much the same thing: they built walls. Earth embankments held back the tide and turned tidal flats into farmland. By the 1950s, however, many of these walls were failing, and the cost of rebuilding them was beginning to exceed the value of the fields behind them."},{"label":"B","text":"In the 1990s a small number of coastal authorities tried a reversal known as managed realignment. Instead of repairing an old wall, they breached it deliberately, allowing seawater to flood the land behind. Within a few years, salt-tolerant plants such as glasswort and sea lavender had colonised the mud, and their dense stems began to slow the waves that crossed them."},{"label":"C","text":"The protective effect is measurable. Field studies suggest that a marsh a hundred metres wide can reduce wave height by more than half before the water reaches the remaining sea wall, which then needs less maintenance. Marshes also trap sediment, so in some places the land has been rising by several millimetres a year, partly keeping pace with the sea."},{"label":"D","text":"Yet the approach is not without problems. Farmers whose land is flooded must be compensated, and negotiations can last for years. Some new marshes have also developed more slowly than predicted: where land had sunk after centuries of drainage, it sat too low, and tidal water covered it for too long for plants to establish. Engineers have responded by delivering dredged mud to raise the ground before the wall is opened."},{"label":"E","text":"Not everyone is convinced that marshes can replace walls entirely. The ecologist Tomas Reyes points out that a marsh protects best against ordinary storms, whereas the most extreme surges can overtop it. He recommends treating marshes as the first of two lines of defence, with a smaller wall retained behind them."}]'::jsonb, '{"kicker":"Coastal engineering"}'::jsonb) on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q01', 's-roofs', 'p-roofs', 'multiple_choice', 'What was the council''s main purpose in planting the roofs?', null, '[{"id":"A","label":"to make public buildings look more attractive"},{"id":"B","label":"to find out whether roofs could support pollinating insects"},{"id":"C","label":"to reduce heating costs in municipal buildings"},{"id":"D","label":"to grow food for local residents"}]'::jsonb, 1, 1, ARRAY['inference','paraphrase_recognition']::text[], ARRAY['urban-ecology']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q02', 's-roofs', 'p-roofs', 'multiple_choice', 'Why were the insect counts always made between ten in the morning and noon?', null, '[{"id":"A","label":"Fewer volunteers were available later in the day."},{"id":"B","label":"Insects were easier to identify in strong sunlight."},{"id":"C","label":"Insect activity is most consistent at that time."},{"id":"D","label":"Rain was less likely in the morning."}]'::jsonb, 2, 1, ARRAY['locating_detail','paraphrase_recognition']::text[], ARRAY['urban-ecology','research-method']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q03', 's-roofs', 'p-roofs', 'true_false_not_given', 'Wildflower roofs attracted more species of bee and hoverfly than sedum roofs.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 3, 1, ARRAY['identifying_writer_claims','locating_detail']::text[], ARRAY['urban-ecology']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q04', 's-roofs', 'p-roofs', 'true_false_not_given', 'The sedum roofs needed regular watering throughout every summer.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 4, 1, ARRAY['identifying_writer_claims','paraphrase_recognition']::text[], ARRAY['urban-ecology']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q05', 's-roofs', 'p-roofs', 'true_false_not_given', 'The volunteers who counted insects were paid for their time.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 5, 1, ARRAY['identifying_writer_claims']::text[], ARRAY['urban-ecology','research-method']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q06', 's-roofs', 'p-roofs', 'sentence_completion', 'The clover-and-grass roofs mainly attracted ______ species.', 'NO MORE THAN ONE WORD', null, 6, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['urban-ecology']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q07', 's-roofs', 'p-roofs', 'sentence_completion', 'Roofs with no other planted site within roughly 300 metres were visited only ______, even when well planted.', 'NO MORE THAN ONE WORD', null, 7, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['urban-ecology']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q08', 's-roofs', 'p-roofs', 'sentence_completion', 'Halloran believes new buildings should be built with deeper planting ______ from the outset.', 'NO MORE THAN ONE WORD', null, 8, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['urban-ecology','policy']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q09', 's-roofs', 'p-roofs', 'multi_select', 'Which TWO limitations of the project are mentioned in the passage?', null, '[{"id":"A","label":"The soil was too shallow for some taller plants."},{"id":"B","label":"Volunteers lost interest in counting insects."},{"id":"C","label":"Some wildflower species did not survive beyond three winters."},{"id":"D","label":"Strong wind made the roofs unsafe to visit."},{"id":"E","label":"The council cut funding after the first six summers."}]'::jsonb, 9, 2, ARRAY['locating_detail','paraphrase_recognition']::text[], ARRAY['urban-ecology']::text[], 3, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q10', 's-marsh', 'p-marsh', 'multiple_choice', 'Which problem with sea walls is described in paragraph A?', null, '[{"id":"A","label":"They were too low to stop ordinary tides."},{"id":"B","label":"Rebuilding them could cost more than the land they protected was worth."},{"id":"C","label":"They damaged the farmland behind them."},{"id":"D","label":"Few engineers knew how to maintain them."}]'::jsonb, 10, 1, ARRAY['paraphrase_recognition','locating_detail']::text[], ARRAY['coastal-engineering']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q11', 's-marsh', 'p-marsh', 'true_false_not_given', 'Managed realignment was first tried in the 1950s.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 11, 1, ARRAY['identifying_writer_claims','locating_detail']::text[], ARRAY['coastal-engineering']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q12', 's-marsh', 'p-marsh', 'true_false_not_given', 'Plants that colonise a breached area can slow incoming waves.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 12, 1, ARRAY['identifying_writer_claims','paraphrase_recognition']::text[], ARRAY['coastal-engineering']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q13', 's-marsh', 'p-marsh', 'true_false_not_given', 'Creating a salt marsh costs less than building a new sea wall.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 13, 1, ARRAY['identifying_writer_claims']::text[], ARRAY['coastal-engineering','policy']::text[], 3, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q14', 's-marsh', 'p-marsh', 'matching_information', 'a method used to correct slow marsh development', null, '[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"},{"id":"C","label":"Paragraph C"},{"id":"D","label":"Paragraph D"},{"id":"E","label":"Paragraph E"}]'::jsonb, 14, 1, ARRAY['scanning_paragraphs','paraphrase_recognition']::text[], ARRAY['coastal-engineering']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q15', 's-marsh', 'p-marsh', 'matching_information', 'a warning that marshes may not cope with the most extreme storms', null, '[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"},{"id":"C","label":"Paragraph C"},{"id":"D","label":"Paragraph D"},{"id":"E","label":"Paragraph E"}]'::jsonb, 15, 1, ARRAY['scanning_paragraphs','paraphrase_recognition']::text[], ARRAY['coastal-engineering']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q16', 's-marsh', 'p-marsh', 'summary_completion', 'A marsh one hundred metres wide may reduce wave height by more than ______ before the water reaches the sea wall.', 'NO MORE THAN ONE WORD', null, 16, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['coastal-engineering']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q17', 's-marsh', 'p-marsh', 'summary_completion', 'Because marshes trap ______, the land in some of them gradually gains height.', 'NO MORE THAN ONE WORD', null, 17, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['coastal-engineering']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q18', 's-marsh', 'p-marsh', 'summary_completion', 'Where land has sunk too low, engineers deliver dredged ______ to raise it before the wall is breached.', 'NO MORE THAN ONE WORD', null, 18, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['coastal-engineering']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('rd01-q19', 's-marsh', 'p-marsh', 'short_answer', 'What does Tomas Reyes suggest keeping behind a marsh?', 'NO MORE THAN THREE WORDS', null, 19, 1, ARRAY['locating_detail','vocabulary_precision']::text[], ARRAY['coastal-engineering','policy']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.tests (id, slug, title, description, assessment_type, publication_status, is_listed, current_version) values ('test-bank-reading-01', 'practice-bank-reading', 'Reading practice bank', 'Hidden bank of short items used for targeted practice. Not listed in the catalogue.', 'reading', 'published', false, 1) on conflict (id) do nothing;
insert into public.test_versions (id, test_id, version_number, duration_seconds, scoring_configuration, section_configuration, public_content, published_at) values ('test-bank-reading-01@v1', 'test-bank-reading-01', 1, 3600, '{"scoringVersion":"reading-raw-v1"}'::jsonb, '[{"id":"bank-s1","title":"Practice bank","passageId":"pb-lighthouse","groups":[]}]'::jsonb, '{"id":"test-bank-reading-01","slug":"practice-bank-reading","title":"Reading practice bank","description":"Hidden bank of short items used for targeted practice. Not listed in the catalogue.","assessmentType":"reading","version":1,"durationSeconds":3600,"scoringNote":"Practice bank — items are graded individually.","passages":[{"id":"pb-lighthouse","title":"The Lamp-Keepers'' Logbooks","kicker":"History","paragraphs":[{"text":"Logbooks kept by lighthouse keepers on the north coast between 1880 and 1930 record far more than the weather. Keepers noted passing ships, repairs to the lamp and, surprisingly often, the birds that struck the glass on foggy nights. A recent project has digitised the entries so that ornithologists can compare them with modern migration records."}]},{"id":"pb-bakery","title":"The Overnight Bakery","kicker":"Everyday systems","paragraphs":[{"text":"In many towns, bread is baked while most people sleep. Bakers begin at about midnight, when dough prepared the previous afternoon has finished a slow rise in cool rooms. Working before dawn means loaves reach shops still warm, and ovens, which take hours to heat, can be run at their most efficient when electricity demand is low."}]},{"id":"pb-library","title":"The Library of Things","kicker":"Community","paragraphs":[{"label":"A","text":"In several neighbourhoods, a library now lends objects as well as books: drills, sewing machines, tents and even telescopes. Members pay a small yearly fee and may borrow an item for up to a week."},{"label":"B","text":"Organisers say the idea reduces waste, because most households use a drill for only a few minutes in its whole life. Some residents worry that items will come back damaged, so each tool is inspected and repaired by volunteers after every loan."}]},{"id":"pb-ice","title":"Reading the Ice","kicker":"Climate science","paragraphs":[{"text":"Layers in glacier ice trap tiny bubbles of ancient air. Scientists drilling cores several kilometres deep can measure the gases in those bubbles to estimate past atmospheric conditions, although the oldest layers are thin and tightly compressed, which makes dating them difficult."}]},{"id":"pb-orchard","title":"The Silent Orchard","kicker":"Agriculture","paragraphs":[{"text":"After the local bee population collapsed, the orchard''s owners began pollinating blossoms by hand with small brushes. The method works, but a single worker can treat only a few trees each day, and the apples now sell at nearly double the price."}]}],"questions":[{"id":"pb-q01","version":1,"number":0,"type":"true_false_not_given","passageId":"pb-lighthouse","prompt":"The logbooks recorded only weather conditions.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims"],"topicTags":["history"],"difficulty":1},{"id":"pb-q02","version":1,"number":0,"type":"true_false_not_given","passageId":"pb-lighthouse","prompt":"The keepers had been trained as ornithologists.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims"],"topicTags":["history"],"difficulty":2},{"id":"pb-q03","version":1,"number":0,"type":"sentence_completion","passageId":"pb-lighthouse","prompt":"Birds were most often recorded striking the glass on ______ nights.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["history"],"difficulty":1},{"id":"pb-q04","version":1,"number":0,"type":"multiple_choice","passageId":"pb-bakery","prompt":"According to the passage, why does bread often reach shops still warm?","marks":1,"options":[{"id":"A","label":"Shops keep their own ovens running all day."},{"id":"B","label":"The baking is finished just before dawn."},{"id":"C","label":"Dough is delivered to shops to be baked there."},{"id":"D","label":"Bakers use warmer flour at night."}],"skillTags":["paraphrase_recognition","inference"],"topicTags":["everyday-systems"],"difficulty":2},{"id":"pb-q05","version":1,"number":0,"type":"sentence_completion","passageId":"pb-bakery","prompt":"Dough prepared the previous afternoon finishes a slow rise in ______ rooms.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["everyday-systems"],"difficulty":1},{"id":"pb-q06","version":1,"number":0,"type":"true_false_not_given","passageId":"pb-bakery","prompt":"Night baking takes advantage of lower electricity demand.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims","paraphrase_recognition"],"topicTags":["everyday-systems"],"difficulty":2},{"id":"pb-q07","version":1,"number":0,"type":"matching_information","passageId":"pb-library","prompt":"a concern about the condition of returned items","marks":1,"options":[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"}],"skillTags":["scanning_paragraphs"],"topicTags":["community"],"difficulty":1},{"id":"pb-q08","version":1,"number":0,"type":"matching_information","passageId":"pb-library","prompt":"the length of time an item may be borrowed","marks":1,"options":[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"}],"skillTags":["scanning_paragraphs"],"topicTags":["community"],"difficulty":1},{"id":"pb-q09","version":1,"number":0,"type":"sentence_completion","passageId":"pb-library","prompt":"After every loan, each tool is inspected and repaired by ______.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["community"],"difficulty":1},{"id":"pb-q10","version":1,"number":0,"type":"multiple_choice","passageId":"pb-ice","prompt":"What makes the oldest layers of ice difficult to date?","marks":1,"options":[{"id":"A","label":"They contain no air bubbles."},{"id":"B","label":"They are thin and tightly compressed."},{"id":"C","label":"They lie beneath solid rock."},{"id":"D","label":"Drilling destroys them."}],"skillTags":["paraphrase_recognition","locating_detail"],"topicTags":["climate-science"],"difficulty":1},{"id":"pb-q11","version":1,"number":0,"type":"true_false_not_given","passageId":"pb-ice","prompt":"Ice cores can be drilled to depths of several kilometres.","marks":1,"options":[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}],"skillTags":["identifying_writer_claims","locating_detail"],"topicTags":["climate-science"],"difficulty":1},{"id":"pb-q12","version":1,"number":0,"type":"multiple_choice","passageId":"pb-ice","prompt":"Which statement is best supported by the passage?","marks":1,"options":[{"id":"A","label":"Ice cores give a perfect record of every single year."},{"id":"B","label":"Estimates drawn from the oldest layers are likely to be less precise."},{"id":"C","label":"Glaciers contain no modern air."},{"id":"D","label":"The trapped gases must be measured at the drilling site."}],"skillTags":["inference"],"topicTags":["climate-science"],"difficulty":3},{"id":"pb-q13","version":1,"number":0,"type":"multiple_choice","passageId":"pb-orchard","prompt":"What can be inferred about the hand-pollinated apples?","marks":1,"options":[{"id":"A","label":"They are of lower quality than before."},{"id":"B","label":"Producing them takes far more labour than it used to."},{"id":"C","label":"They ripen earlier in the season."},{"id":"D","label":"Bees refuse to visit their blossoms."}],"skillTags":["inference"],"topicTags":["agriculture"],"difficulty":2},{"id":"pb-q14","version":1,"number":0,"type":"sentence_completion","passageId":"pb-orchard","prompt":"The owners pollinate blossoms by hand using small ______.","marks":1,"wordLimit":1,"instructions":"NO MORE THAN ONE WORD","skillTags":["vocabulary_precision","locating_detail"],"topicTags":["agriculture"],"difficulty":1}],"sections":[{"id":"bank-s1","title":"Practice bank","passageId":"pb-lighthouse","groups":[]}]}'::jsonb, now()) on conflict (id) do nothing;
insert into public.test_sections (id, test_version_id, section_type, title, instructions, display_order) values ('bank-s1', 'test-bank-reading-01@v1', 'reading', 'Practice bank', null, 1) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('pb-lighthouse', 'bank-s1', 'The Lamp-Keepers'' Logbooks', '[{"text":"Logbooks kept by lighthouse keepers on the north coast between 1880 and 1930 record far more than the weather. Keepers noted passing ships, repairs to the lamp and, surprisingly often, the birds that struck the glass on foggy nights. A recent project has digitised the entries so that ornithologists can compare them with modern migration records."}]'::jsonb, '{"kicker":"History"}'::jsonb) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('pb-bakery', 'bank-s1', 'The Overnight Bakery', '[{"text":"In many towns, bread is baked while most people sleep. Bakers begin at about midnight, when dough prepared the previous afternoon has finished a slow rise in cool rooms. Working before dawn means loaves reach shops still warm, and ovens, which take hours to heat, can be run at their most efficient when electricity demand is low."}]'::jsonb, '{"kicker":"Everyday systems"}'::jsonb) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('pb-library', 'bank-s1', 'The Library of Things', '[{"label":"A","text":"In several neighbourhoods, a library now lends objects as well as books: drills, sewing machines, tents and even telescopes. Members pay a small yearly fee and may borrow an item for up to a week."},{"label":"B","text":"Organisers say the idea reduces waste, because most households use a drill for only a few minutes in its whole life. Some residents worry that items will come back damaged, so each tool is inspected and repaired by volunteers after every loan."}]'::jsonb, '{"kicker":"Community"}'::jsonb) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('pb-ice', 'bank-s1', 'Reading the Ice', '[{"text":"Layers in glacier ice trap tiny bubbles of ancient air. Scientists drilling cores several kilometres deep can measure the gases in those bubbles to estimate past atmospheric conditions, although the oldest layers are thin and tightly compressed, which makes dating them difficult."}]'::jsonb, '{"kicker":"Climate science"}'::jsonb) on conflict (id) do nothing;
insert into public.passages (id, section_id, title, content, metadata) values ('pb-orchard', 'bank-s1', 'The Silent Orchard', '[{"text":"After the local bee population collapsed, the orchard''s owners began pollinating blossoms by hand with small brushes. The method works, but a single worker can treat only a few trees each day, and the apples now sell at nearly double the price."}]'::jsonb, '{"kicker":"Agriculture"}'::jsonb) on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q01', 'bank-s1', 'pb-lighthouse', 'true_false_not_given', 'The logbooks recorded only weather conditions.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 0, 1, ARRAY['identifying_writer_claims']::text[], ARRAY['history']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q02', 'bank-s1', 'pb-lighthouse', 'true_false_not_given', 'The keepers had been trained as ornithologists.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 0, 1, ARRAY['identifying_writer_claims']::text[], ARRAY['history']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q03', 'bank-s1', 'pb-lighthouse', 'sentence_completion', 'Birds were most often recorded striking the glass on ______ nights.', 'NO MORE THAN ONE WORD', null, 0, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['history']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q04', 'bank-s1', 'pb-bakery', 'multiple_choice', 'According to the passage, why does bread often reach shops still warm?', null, '[{"id":"A","label":"Shops keep their own ovens running all day."},{"id":"B","label":"The baking is finished just before dawn."},{"id":"C","label":"Dough is delivered to shops to be baked there."},{"id":"D","label":"Bakers use warmer flour at night."}]'::jsonb, 0, 1, ARRAY['paraphrase_recognition','inference']::text[], ARRAY['everyday-systems']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q05', 'bank-s1', 'pb-bakery', 'sentence_completion', 'Dough prepared the previous afternoon finishes a slow rise in ______ rooms.', 'NO MORE THAN ONE WORD', null, 0, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['everyday-systems']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q06', 'bank-s1', 'pb-bakery', 'true_false_not_given', 'Night baking takes advantage of lower electricity demand.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 0, 1, ARRAY['identifying_writer_claims','paraphrase_recognition']::text[], ARRAY['everyday-systems']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q07', 'bank-s1', 'pb-library', 'matching_information', 'a concern about the condition of returned items', null, '[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"}]'::jsonb, 0, 1, ARRAY['scanning_paragraphs']::text[], ARRAY['community']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q08', 'bank-s1', 'pb-library', 'matching_information', 'the length of time an item may be borrowed', null, '[{"id":"A","label":"Paragraph A"},{"id":"B","label":"Paragraph B"}]'::jsonb, 0, 1, ARRAY['scanning_paragraphs']::text[], ARRAY['community']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q09', 'bank-s1', 'pb-library', 'sentence_completion', 'After every loan, each tool is inspected and repaired by ______.', 'NO MORE THAN ONE WORD', null, 0, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['community']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q10', 'bank-s1', 'pb-ice', 'multiple_choice', 'What makes the oldest layers of ice difficult to date?', null, '[{"id":"A","label":"They contain no air bubbles."},{"id":"B","label":"They are thin and tightly compressed."},{"id":"C","label":"They lie beneath solid rock."},{"id":"D","label":"Drilling destroys them."}]'::jsonb, 0, 1, ARRAY['paraphrase_recognition','locating_detail']::text[], ARRAY['climate-science']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q11', 'bank-s1', 'pb-ice', 'true_false_not_given', 'Ice cores can be drilled to depths of several kilometres.', null, '[{"id":"TRUE","label":"True"},{"id":"FALSE","label":"False"},{"id":"NOT_GIVEN","label":"Not Given"}]'::jsonb, 0, 1, ARRAY['identifying_writer_claims','locating_detail']::text[], ARRAY['climate-science']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q12', 'bank-s1', 'pb-ice', 'multiple_choice', 'Which statement is best supported by the passage?', null, '[{"id":"A","label":"Ice cores give a perfect record of every single year."},{"id":"B","label":"Estimates drawn from the oldest layers are likely to be less precise."},{"id":"C","label":"Glaciers contain no modern air."},{"id":"D","label":"The trapped gases must be measured at the drilling site."}]'::jsonb, 0, 1, ARRAY['inference']::text[], ARRAY['climate-science']::text[], 3, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q13', 'bank-s1', 'pb-orchard', 'multiple_choice', 'What can be inferred about the hand-pollinated apples?', null, '[{"id":"A","label":"They are of lower quality than before."},{"id":"B","label":"Producing them takes far more labour than it used to."},{"id":"C","label":"They ripen earlier in the season."},{"id":"D","label":"Bees refuse to visit their blossoms."}]'::jsonb, 0, 1, ARRAY['inference']::text[], ARRAY['agriculture']::text[], 2, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.questions (id, section_id, passage_id, question_type, prompt, instructions, options, display_number, marks, skill_tags, topic_tags, difficulty_estimate, content_version, publication_status, review_status) values ('pb-q14', 'bank-s1', 'pb-orchard', 'sentence_completion', 'The owners pollinate blossoms by hand using small ______.', 'NO MORE THAN ONE WORD', null, 0, 1, ARRAY['vocabulary_precision','locating_detail']::text[], ARRAY['agriculture']::text[], 1, 1, 'published', 'approved') on conflict (id) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q01', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'B — to find out whether roofs could support pollinating insects', 'Paragraph A says the residents thought the plan was "decorative", but the officials had a practical aim: testing whether flat roofs could support insects that were vanishing from nearby streets. Option A is the residents'' assumption, not the officials'' purpose.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q02', 1, 1, '{"kind":"single","correct":"C"}'::jsonb, 'C — Insect activity is most consistent at that time.', 'Paragraph B gives the reason in a clause: activity is "most stable" between ten and noon. "Most stable" is paraphrased as "most consistent". Nothing in the paragraph mentions volunteers, sunlight or rain.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q03', 1, 1, '{"kind":"single","correct":"TRUE"}'::jsonb, 'True', 'Paragraph C states that wildflower roofs attracted about three times as many bee and hoverfly species as sedum roofs, so they attracted more.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q04', 1, 1, '{"kind":"single","correct":"FALSE"}'::jsonb, 'False', 'Paragraph C says the sedum roofs needed water "only in the driest weeks". That contradicts watering regularly throughout every summer.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q05', 1, 1, '{"kind":"single","correct":"NOT_GIVEN"}'::jsonb, 'Not Given', 'Paragraph B says volunteers did the counting, but the passage never says whether they were paid or unpaid. When a detail is simply absent, the answer is Not Given — not False.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q06', 1, 1, '{"kind":"text","accepted":["common"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'common', 'Paragraph C: the clover-and-grass roofs attracted "mainly common species" already abundant in the city''s parks.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q07', 1, 1, '{"kind":"text","accepted":["occasionally"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'occasionally', 'Paragraph D: isolated roofs, even those with ideal planting, were "visited only occasionally". The sentence stem paraphrases "isolated" as "no other planted site within roughly 300 metres".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q08', 1, 1, '{"kind":"text","accepted":["beds","bed"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'beds', 'Paragraph E: Halloran says "deeper planting beds should be built into new buildings from the outset". The stem already supplies the word "planting", so only "beds" fits the gap.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q09', 1, 2, '{"kind":"multi","correct":["A","C"],"partial":true}'::jsonb, 'A and C', 'Both limitations are in paragraph E: the eight-centimetre soil was too shallow for taller plants (A), and several wildflower species died out after three winters (C). Volunteers losing interest, wind and funding cuts are never mentioned. Marking: 1 mark per correct choice, no deduction for a wrong choice; selecting more than two choices scores zero.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q10', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'B — Rebuilding them could cost more than the land they protected was worth.', 'Paragraph A: the cost of rebuilding the walls "was beginning to exceed the value of the fields behind them". Option C reverses the text — the walls turned tidal flats into farmland.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q11', 1, 1, '{"kind":"single","correct":"FALSE"}'::jsonb, 'False', 'Paragraph A mentions the 1950s as the period when walls were failing. Paragraph B says managed realignment was tried in the 1990s.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q12', 1, 1, '{"kind":"single","correct":"TRUE"}'::jsonb, 'True', 'Paragraph B: once salt-tolerant plants colonised the breached land, their dense stems "began to slow the waves that crossed them".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q13', 1, 1, '{"kind":"single","correct":"NOT_GIVEN"}'::jsonb, 'Not Given', 'The passage compares marshes and walls on protection and maintenance, and says rebuilding old walls was costly, but it never compares the cost of creating a marsh with the cost of a new wall.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q14', 1, 1, '{"kind":"single","correct":"D"}'::jsonb, 'Paragraph D', 'Paragraph D describes slow-developing marshes on land that had sunk, and the fix: engineers deliver dredged mud to raise the ground before the wall is opened.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q15', 1, 1, '{"kind":"single","correct":"E"}'::jsonb, 'Paragraph E', 'In paragraph E, Reyes warns that "the most extreme surges can overtop" a marsh, which is why he suggests a second line of defence.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q16', 1, 1, '{"kind":"text","accepted":["half"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'half', 'Paragraph C: a hundred-metre marsh can reduce wave height by "more than half".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q17', 1, 1, '{"kind":"text","accepted":["sediment"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'sediment', 'Paragraph C: "Marshes also trap sediment, so in some places the land has been rising."') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q18', 1, 1, '{"kind":"text","accepted":["mud"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'mud', 'Paragraph D: engineers respond by "delivering dredged mud to raise the ground before the wall is opened".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q19', 1, 1, '{"kind":"text","accepted":["a smaller wall","smaller wall"],"maxWords":3,"ignorePunctuation":true}'::jsonb, 'a smaller wall', 'Paragraph E: Reyes recommends "a smaller wall retained behind" the marshes. The limit is three words, so "smaller wall" and "a smaller wall" both fit; "a smaller sea wall" would be four words and not accepted.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q01', 1, 1, '{"kind":"single","correct":"FALSE"}'::jsonb, 'False', 'The logbooks record "far more than the weather" — ships, lamp repairs and birds — so "only weather" contradicts the passage.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q02', 1, 1, '{"kind":"single","correct":"NOT_GIVEN"}'::jsonb, 'Not Given', 'Ornithologists are mentioned only as the people who now use the digitised entries. Nothing says the keepers themselves were trained in bird science.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q03', 1, 1, '{"kind":"text","accepted":["foggy"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'foggy', 'Birds struck the glass "on foggy nights".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q04', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'B — The baking is finished just before dawn.', 'The passage says working "before dawn" means loaves reach shops still warm. The warmth is linked to timing, not to shop ovens or special flour.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q05', 1, 1, '{"kind":"text","accepted":["cool"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'cool', 'The dough has finished "a slow rise in cool rooms".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q06', 1, 1, '{"kind":"single","correct":"TRUE"}'::jsonb, 'True', 'Ovens run "at their most efficient when electricity demand is low" — a paraphrase of taking advantage of lower demand.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q07', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'Paragraph B', 'Paragraph B reports residents who "worry that items will come back damaged".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q08', 1, 1, '{"kind":"single","correct":"A"}'::jsonb, 'Paragraph A', 'Paragraph A: members may borrow an item "for up to a week".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q09', 1, 1, '{"kind":"text","accepted":["volunteers"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'volunteers', 'Each tool is "inspected and repaired by volunteers after every loan".') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q10', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'B — They are thin and tightly compressed.', 'The final clause says the oldest layers are "thin and tightly compressed", which makes dating difficult.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q11', 1, 1, '{"kind":"single","correct":"TRUE"}'::jsonb, 'True', 'Cores "several kilometres deep" are mentioned directly.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q12', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'B — Estimates drawn from the oldest layers are likely to be less precise.', 'The passage says dating the oldest layers is difficult. It never claims a perfect record (A), and nothing supports C or D. This is an inference: difficulty dating implies less precise estimates.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q13', 1, 1, '{"kind":"single","correct":"B"}'::jsonb, 'B — Producing them takes far more labour than it used to.', 'One worker can treat only a few trees a day, and the price has nearly doubled: both point to much more labour per apple. Quality, ripening and bee behaviour are not discussed.') on conflict (question_id, version) do nothing;
insert into public.answer_keys (question_id, version, marks, rule, display, explanation) values ('pb-q14', 1, 1, '{"kind":"text","accepted":["brushes","brush"],"maxWords":1,"ignorePunctuation":true}'::jsonb, 'brushes', 'The owners pollinate blossoms "by hand with small brushes".') on conflict (question_id, version) do nothing;
commit;
