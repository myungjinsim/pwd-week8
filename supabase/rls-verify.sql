-- ============================================================================
-- [과제: 권한 검증] Supabase SQL Editor에서 RLS 정책을 확인하는 스크립트
-- schema.sql을 실행한 뒤 이 파일 전체를 실행합니다.
-- 임시 계정 3개(회원A·회원B·관리자)와 맛집 1개를 만들어 검사하고,
-- 검사가 끝나면 모두 되돌립니다(실제 데이터는 바뀌지 않음).
-- 결과 표의 pass 열이 모두 true여야 합니다.
-- ============================================================================
create temp table if not exists rls_check(
  step int, actor text, action text, expected text, actual text, pass boolean
);
truncate rls_check;

do $$
declare
  member_a uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  rid bigint;
  n int;
  results jsonb := '[]'::jsonb;
  step int := 0;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
      (member_a,'rls-a@example.test','{"name":"RLS 회원A"}','{"provider":"email"}'),
      (member_b,'rls-b@example.test','{"name":"RLS 회원B"}','{"provider":"google"}'),
      (admin_id,'rls-admin@example.test','{"name":"RLS 관리자"}','{"provider":"custom:naver"}');
    update public.profiles set user_type='admin' where id=admin_id;

    -- 1) 비회원(anon): 조회 허용, 등록 차단
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select count(*) into n from public.restaurants;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','비회원','action','맛집 조회','expected','허용','actual','허용 ('||n||'건)','pass',true);
    begin
      insert into public.restaurants(name,category,location) values ('비회원 등록','한식','캠퍼스');
      step:=step+1; results:=results||jsonb_build_object('step',step,'actor','비회원','action','맛집 등록','expected','차단','actual','허용됨','pass',false);
    exception when insufficient_privilege then
      step:=step+1; results:=results||jsonb_build_object('step',step,'actor','비회원','action','맛집 등록','expected','차단','actual','차단 (42501)','pass',true);
    end;

    -- 2) 회원A: 등록 → 등록자=A
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub',member_a,'role','authenticated')::text, true);
    insert into public.restaurants(name,category,location) values ('RLS 검증 맛집','한식','캠퍼스') returning id into rid;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','회원A','action','맛집 등록 (id='||rid||')','expected','허용','actual','허용','pass',true);

    -- 3) 회원B: A의 맛집 수정·삭제 → 0행
    perform set_config('request.jwt.claims', json_build_object('sub',member_b,'role','authenticated')::text, true);
    update public.restaurants set name='B가 수정' where id=rid; get diagnostics n = row_count;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','회원B','action','A의 맛집 수정','expected','차단 (0행)','actual',n||'행 수정','pass',n=0);
    delete from public.restaurants where id=rid; get diagnostics n = row_count;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','회원B','action','A의 맛집 삭제','expected','차단 (0행)','actual',n||'행 삭제','pass',n=0);
    begin
      insert into public.restaurants(name,category,location,created_by) values ('사칭','한식','캠퍼스',member_a);
      step:=step+1; results:=results||jsonb_build_object('step',step,'actor','회원B','action','A 명의로 등록','expected','차단','actual','허용됨','pass',false);
    exception when insufficient_privilege then
      step:=step+1; results:=results||jsonb_build_object('step',step,'actor','회원B','action','A 명의로 등록','expected','차단','actual','차단 (42501)','pass',true);
    end;

    -- 4) 회원A: 본인 맛집 수정 → 1행
    perform set_config('request.jwt.claims', json_build_object('sub',member_a,'role','authenticated')::text, true);
    update public.restaurants set rating=4.5 where id=rid; get diagnostics n = row_count;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','회원A','action','본인 맛집 수정','expected','허용 (1행)','actual',n||'행 수정','pass',n=1);

    -- 5) 관리자: 다른 회원 맛집 수정·삭제 → 1행
    perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
    update public.restaurants set name='관리자 수정' where id=rid; get diagnostics n = row_count;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','관리자','action','A의 맛집 수정','expected','허용 (1행)','actual',n||'행 수정','pass',n=1);
    delete from public.restaurants where id=rid; get diagnostics n = row_count;
    step:=step+1; results:=results||jsonb_build_object('step',step,'actor','관리자','action','A의 맛집 삭제','expected','허용 (1행)','actual',n||'행 삭제','pass',n=1);

    -- 검사용 계정·맛집을 모두 되돌립니다.
    raise exception using errcode='P0001', message='RLS_VERIFY_ROLLBACK';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'RLS_VERIFY_ROLLBACK' then raise; end if;
  end;
  insert into rls_check(step,actor,action,expected,actual,pass)
  select (r->>'step')::int, r->>'actor', r->>'action', r->>'expected', r->>'actual', (r->>'pass')::boolean
  from jsonb_array_elements(results) r;
end $$;

select step, actor, action, expected, actual, pass from rls_check order by step;
