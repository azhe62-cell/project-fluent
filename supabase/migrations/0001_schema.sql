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
