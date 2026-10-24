-- =============================================================================
-- LIVE RLS / PRIVILEGE CHECKS — paste into the Supabase SQL editor of YOUR project and run.
--
-- SAFE BY DESIGN: it changes nothing. Every "should be denied" statement is executed inside a
-- sub-transaction that is rolled back even if it unexpectedly succeeds. It creates only a temp table.
-- Prerequisites (do these in the running app first): at least TWO registered learners; one learner has
-- an attempt with at least one SAVED ANSWER; and at least one attempt has been SUBMITTED (a report exists).
-- Checks that would pass vacuously on an empty table are reported as FAILED ("NO DATA") instead.
-- Result: a table of checks with passed = true/false. ANY false means do not launch.
-- =============================================================================
drop table if exists pg_temp.fluent_rls_results;
create temp table fluent_rls_results (n serial, check_name text, passed boolean, detail text);

create or replace function pg_temp.record(p_name text, p_ok boolean, p_detail text) returns void language sql as
$$ insert into fluent_rls_results (check_name, passed, detail) values (p_name, p_ok, p_detail) $$;

-- Run a statement as a role/user and PASS only if it is denied (SQLSTATE 42501) — or, when p_zero_ok, returns zero rows.
create or replace function pg_temp.expect_denied(p_name text, p_role text, p_uid uuid, p_stmt text, p_zero_ok boolean default false) returns void language plpgsql as $$
declare ok boolean := false; detail text := 'statement unexpectedly SUCCEEDED'; n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute 'set local role ' || quote_ident(p_role);
  begin
    if p_zero_ok then
      execute 'select count(*) from (' || p_stmt || ') s' into n;
      ok := (n = 0); detail := 'returned ' || n || ' row(s)';
    else
      execute p_stmt;
    end if;
    raise exception 'FLUENT_ROLLBACK_PROBE';
  exception when others then
    if sqlerrm <> 'FLUENT_ROLLBACK_PROBE' then
      if sqlstate = '42501' then ok := true; detail := 'denied (' || sqlerrm || ')';
      else ok := p_zero_ok and false; detail := 'unexpected error ' || sqlstate || ': ' || sqlerrm; end if;
    end if;
  end;
  reset role;
  perform pg_temp.record(p_name, ok, detail);
end $$;

create or replace function pg_temp.expect_scalar(p_name text, p_role text, p_uid uuid, p_stmt text, p_expected text) returns void language plpgsql as $$
declare got text; ok boolean := false; detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute 'set local role ' || quote_ident(p_role);
  begin execute p_stmt into got; ok := got is not distinct from p_expected; detail := 'got ' || coalesce(got, 'NULL') || ', expected ' || coalesce(p_expected, 'NULL');
  exception when others then detail := 'error ' || sqlstate || ': ' || sqlerrm; end;
  reset role;
  perform pg_temp.record(p_name, ok, detail);
end $$;

create or replace function pg_temp.expect_error(p_name text, p_role text, p_uid uuid, p_stmt text, p_state text) returns void language plpgsql as $$
declare ok boolean := false; detail text := 'no error raised';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute 'set local role ' || quote_ident(p_role);
  begin execute p_stmt; raise exception 'FLUENT_ROLLBACK_PROBE';
  exception when others then
    if sqlerrm <> 'FLUENT_ROLLBACK_PROBE' then ok := (sqlstate = p_state); detail := 'raised ' || sqlstate || ' (' || sqlerrm || ')'; end if;
  end;
  reset role;
  perform pg_temp.record(p_name, ok, detail);
end $$;

do $$
declare a uuid; att uuid; b uuid; ra uuid; ratt uuid; rb uuid; sa uuid; satt uuid; sb uuid;
begin
  select a2.user_id, a2.id into a, att from public.test_attempts a2 order by a2.created_at limit 1;
  select p.id into b from public.profiles p where p.id <> a limit 1;
  if a is null or b is null then raise exception 'PREREQUISITE: register two learners and start one attempt in the app first.'; end if;

  -- an attempt that has saved answers (needed to make the responses check meaningful)
  select a2.user_id, a2.id into ra, ratt from public.test_attempts a2 where exists (select 1 from public.responses r where r.attempt_id = a2.id) limit 1;
  -- an attempt that has a stored report
  select a2.user_id, a2.id into sa, satt from public.test_attempts a2 where exists (select 1 from public.results r where r.attempt_id = a2.id) limit 1;
  if ra is null then perform pg_temp.record('NO DATA: attempt with saved answers', false, 'Save at least one answer in the app, then re-run'); end if;
  if sa is null then perform pg_temp.record('NO DATA: submitted attempt with a report', false, 'Submit an attempt in the app, then re-run'); end if;
  select p.id into rb from public.profiles p where p.id <> coalesce(ra, a) limit 1;
  select p.id into sb from public.profiles p where p.id <> coalesce(sa, a) limit 1;

  -- positive control: the owner CAN see their own attempt (otherwise the "cannot see" checks below prove nothing)
  perform pg_temp.expect_scalar('A can read their own attempt (control)', 'authenticated', a, format('select count(*)::text from public.test_attempts where id = %L', att), '1');

  -- anonymous visitors
  perform pg_temp.expect_denied('anon cannot read test_attempts', 'anon', null, 'select * from public.test_attempts');
  perform pg_temp.expect_denied('anon cannot read responses', 'anon', null, 'select * from public.responses');
  perform pg_temp.expect_denied('anon cannot read results', 'anon', null, 'select * from public.results');
  perform pg_temp.expect_denied('anon cannot read mistake_items', 'anon', null, 'select * from public.mistake_items');
  perform pg_temp.expect_denied('anon cannot read answer_keys', 'anon', null, 'select * from public.answer_keys');
  perform pg_temp.expect_denied('anon cannot read profiles', 'anon', null, 'select * from public.profiles');
  perform pg_temp.expect_denied('anon cannot start an attempt', 'anon', null, 'select public.start_or_resume_attempt(''test-reading-mini-01'')');
  perform pg_temp.expect_scalar('anon catalogue works and exposes no answers', 'anon', null,
    'select (public.list_catalogue()::text !~ ''"accepted"|"explanation"|"rule"'')::text', 'true');

  -- another learner (B) versus A's data
  perform pg_temp.expect_denied('B sees none of A''s attempts', 'authenticated', b, format('select * from public.test_attempts where id = %L', att), true);
  if ra is not null then
    perform pg_temp.expect_scalar('owner can read their own saved answers (control)', 'authenticated', ra, format('select (count(*) > 0)::text from public.responses where attempt_id = %L', ratt), 'true');
    perform pg_temp.expect_denied('B sees none of A''s responses', 'authenticated', rb, format('select * from public.responses where attempt_id = %L', ratt), true);
    perform pg_temp.expect_scalar('B cannot read A''s answers via get_attempt', 'authenticated', rb, format('select (public.get_attempt(%L) is null)::text', ratt), 'true');
  end if;
  if sa is not null then
    perform pg_temp.expect_scalar('owner can read their own report (control)', 'authenticated', sa, format('select (count(*) > 0)::text from public.results where attempt_id = %L', satt), 'true');
    perform pg_temp.expect_denied('B sees none of A''s results', 'authenticated', sb, format('select * from public.results where attempt_id = %L', satt), true);
    perform pg_temp.expect_scalar('B cannot read A''s report via get_result', 'authenticated', sb, format('select (public.get_result(%L) is null)::text', satt), 'true');
    perform pg_temp.expect_scalar('B cannot read A''s report via list_my_results', 'authenticated', sb, format('select (public.list_my_results()::text not like %L)::text', '%' || satt::text || '%'), 'true');
  end if;
  perform pg_temp.expect_scalar('B get_attempt(A''s attempt) returns null', 'authenticated', b, format('select (public.get_attempt(%L) is null)::text', att), 'true');
  perform pg_temp.expect_error('B cannot save into A''s attempt', 'authenticated', b, format('select public.save_responses(%L, ''[]''::jsonb)', att), 'P0002');
  perform pg_temp.expect_error('B cannot add A''s attempt to their vault', 'authenticated', b, format('select public.add_to_vault(%L, null)', att), 'P0002');

  -- learners versus secrets and privileged operations
  perform pg_temp.expect_denied('learner cannot read answer_keys', 'authenticated', a, 'select * from public.answer_keys', true);
  perform pg_temp.expect_denied('learner cannot read questions', 'authenticated', a, 'select * from public.questions', true);
  perform pg_temp.expect_denied('learner cannot read rate_limits', 'authenticated', a, 'select * from public.rate_limits');
  perform pg_temp.expect_denied('learner cannot make themselves admin', 'authenticated', a, format('update public.profiles set role = ''admin'' where id = %L', a));
  perform pg_temp.expect_denied('learner cannot write results directly', 'authenticated', a,
    format('insert into public.results (attempt_id, raw_score, max_score, section_scores, scoring_version, result_view) values (%L, 20, 20, ''[]'', ''x'', ''{}'')', att));
  perform pg_temp.expect_denied('learner cannot insert attempts directly', 'authenticated', a,
    format('insert into public.test_attempts (user_id, test_id, test_version_id, status) values (%L, ''test-reading-mini-01'', ''test-reading-mini-01@v1'', ''scored'')', a));
  perform pg_temp.expect_denied('learner cannot alter their attempt deadline/status', 'authenticated', a, format('update public.test_attempts set status = ''scored'', deadline_at = now() + interval ''1 year'' where id = %L', att));
  perform pg_temp.expect_denied('learner cannot write activity events', 'authenticated', a, format('insert into public.activity_events (user_id, event_type, questions) values (%L, ''attempt_completed'', 99)', a));
  perform pg_temp.expect_denied('learner cannot call finalize_attempt', 'authenticated', a, format('select public.finalize_attempt(%L, %L, ''learner_submitted'')', att, a));
  perform pg_temp.expect_denied('learner cannot call store_result', 'authenticated', a, format('select public.store_result(%L, ''{}''::jsonb, 0)', att));
  perform pg_temp.expect_denied('learner cannot call get_answer_keys', 'authenticated', a, 'select public.get_answer_keys(array[''rd01-q01''])');
  perform pg_temp.expect_denied('learner cannot call get_scoring_inputs', 'authenticated', a, format('select public.get_scoring_inputs(%L)', att));
end $$;

select n, check_name, passed, detail from fluent_rls_results order by n;
-- Summary line (read it!):
select case when bool_and(passed) then 'ALL ' || count(*) || ' CHECKS PASSED' else count(*) filter (where not passed) || ' CHECK(S) FAILED — DO NOT LAUNCH' end as summary from fluent_rls_results;
