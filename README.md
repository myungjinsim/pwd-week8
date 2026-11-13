# Ajou FoodMap API — 인증·로그인과 권한(RLS)

TypeScript·Express 서버입니다. Supabase Auth로 이메일·Google·네이버 로그인을 처리하고, 맛집 쓰기 권한은 Supabase **행 수준 보안(RLS)** 정책이 판단합니다.

- 클라이언트 저장소: https://github.com/myungjinsim/pwd-week8-client
- 서비스 주소(Vercel): _배포 후 기입_
- API 주소(Render): _배포 후 기입_

## 권한 표

| 기능 | 비회원 | 회원 | 관리자 |
| --- | :-: | :-: | :-: |
| 맛집 목록·상세·인기 조회 | O | O | O |
| 맛집 등록 | X | O (등록자 = 본인) | O |
| 맛집 수정·삭제 | X | **본인이 등록한 맛집만** | **모든 맛집** |
| 맛집 제보 | X | O | O |
| 제보 승인·거절, 사용자 역할 변경 | X | X | O |

이메일·Google·네이버 중 어느 방식으로 로그인해도 같은 `auth.users` UUID → `public.profiles` 행으로 연결되므로 권한(`user_type`)이 똑같이 적용됩니다.

## RLS 설계

`supabase/schema.sql`에 모두 들어 있습니다.

1. `restaurants.created_by uuid` 열을 추가했습니다. 기본값은 `auth.uid()`입니다. 제보를 승인해 만든 맛집은 제보한 회원이 등록자가 됩니다.
2. 정책은 다음과 같습니다.

   | 정책 | 대상 | 조건 |
   | --- | --- | --- |
   | `foodmap_restaurants_select` | anon, authenticated | 항상 허용 |
   | `foodmap_restaurants_insert` | authenticated | 활성 회원 **그리고** `created_by = auth.uid()` |
   | `foodmap_restaurants_update` | authenticated | 활성 회원 **그리고** (`created_by = auth.uid()` **또는** 관리자) |
   | `foodmap_restaurants_delete` | authenticated | 활성 회원 **그리고** (`created_by = auth.uid()` **또는** 관리자) |

3. 관리자 여부는 `foodmap_is_admin()`(security definer)로 `profiles`를 확인합니다. `profiles`는 브라우저 역할에 공개하지 않습니다.
4. 열 단위 GRANT를 적용해 회원이 `created_by`·`likes`·`source_submission_id`를 바꿔 소유권을 가져가지 못하게 했습니다.

**Express가 RLS를 우회하지 않도록** 맛집 등록·수정·삭제는 서버 Secret key(service_role)가 아니라 **요청자의 액세스 토큰**으로 Supabase에 보냅니다(`getUserSupabase()`, `src/services/restaurants.service.ts`). Express는 로그인 여부만 확인합니다. 누구의 맛집인지, 관리자인지는 DB 정책이 판단합니다. RLS가 막은 UPDATE·DELETE는 0행이 되고, 서버는 이를 `403`으로 응답합니다.

## 권한 검증 방법

| 방법 | 명령·파일 | 확인 내용 |
| --- | --- | --- |
| SQL Editor | `supabase/rls-verify.sql` 실행 | 비회원 등록 차단, 회원B의 A 맛집 수정·삭제 0행, A 본인 수정 1행, 관리자 수정·삭제 1행. 실행 후 데이터는 롤백됩니다. `pass` 열이 모두 `true`여야 합니다. |
| 실제 Supabase | `npm run rls:check` | 임시 계정 3개로 Data API 직접 요청과 Express API(`403`/`200`)를 함께 확인합니다. 끝나면 임시 데이터를 정리합니다. |
| 로컬 Postgres | `npm test` | Jest 단위 검사와 PGlite 실제 SQL 검사(RLS 6건 포함)를 실행합니다. |
| 화면 | 클라이언트 **내 맛집 → 권한 검증 모드** | 다른 회원의 맛집에 "수정 시도"를 누르면 `차단됨 (403)` 알림이 뜹니다. 관리자 페이지에서는 같은 맛집이 수정됩니다. |

## 실행

```bash
cp .env.example .env   # SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY 입력
npm ci
npm test
npm run dev            # http://localhost:3000
```

### Supabase 준비

1. SQL Editor에서 `supabase/schema.sql`을 실행한 뒤 `supabase/seed.sql`을 실행합니다.
2. Authentication → URL Configuration
   - Site URL: 배포한 Vercel 주소
   - Redirect URLs: `https://<vercel-주소>/auth/callback`, `http://127.0.0.1:5173/auth/callback`
3. Google: Google Cloud에서 웹 OAuth 클라이언트를 만듭니다. redirect URI는 `https://<project-ref>.supabase.co/auth/v1/callback`입니다. 만든 클라이언트를 Supabase → Providers → Google에 등록합니다.
4. 네이버: NAVER Developers 앱을 만듭니다. Callback URL은 위와 같은 Supabase 주소입니다. `.env`에 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`을 넣고 `npm run auth:setup-naver`를 실행합니다.
5. 첫 관리자는 가입 후 `npm run change-user-type -- <이메일> admin`으로 지정합니다. 이후에는 관리자 페이지에서 역할을 바꿀 수 있습니다.

### Render 배포

| 항목 | 값 |
| --- | --- |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| 환경변수 | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `CLIENT_URL`(Vercel origin), `NODE_ENV=production` |

## API

| 메서드·경로 | 권한 |
| --- | --- |
| `GET /api/restaurants`, `/popular`, `/:id` | 공개 |
| `POST /api/restaurants` | 로그인 (RLS: 등록자=본인) |
| `PUT·DELETE /api/restaurants/:id` | 로그인 (RLS: 본인 또는 관리자) |
| `GET /api/auth/me`, `GET /api/auth/providers` | 로그인 / 공개 |
| `POST /api/submissions` | 로그인 |
| `GET·PUT·DELETE /api/submissions…`, `POST …/approve` | 관리자 |
| `GET /api/users/all`, `PUT /api/users/:id/type` | 관리자 |

수업 원본 실습서는 [ajou-hyunseok-oh/pwd-week8-server](https://github.com/ajou-hyunseok-oh/pwd-week8-server)에 있습니다. 이 저장소는 원본의 "관리자만 맛집 쓰기"를 과제 요구사항인 "회원은 본인 맛집, 관리자는 전체 + RLS"로 바꿨습니다.
