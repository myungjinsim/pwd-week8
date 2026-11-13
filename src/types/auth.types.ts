import type { ProfileRow } from "./database.types";

export function profileResponse(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    provider: row.provider,
    userType: row.user_type,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export type AppUser = ReturnType<typeof profileResponse>;
declare global {
  namespace Express {
    interface Request {
      auth?: AppUser;
      // RLS를 적용할 사용자 범위 DB 요청에 그대로 전달하는 검증된 액세스 토큰
      accessToken?: string;
    }
  }
}
