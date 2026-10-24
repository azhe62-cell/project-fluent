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
