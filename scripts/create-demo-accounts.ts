import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { getSupabase } from "../src/config/supabase";

// 채점·시연용 데모 계정(관리자·회원A·회원B)을 만들고 비밀번호를 .env.demo-accounts.local(git 제외)에 저장합니다.
async function main() {
const db = getSupabase();
const accounts = [
  { key: "ADMIN", email: "foodmap.admin@example.com", name: "데모 관리자", role: "admin" },
  { key: "MEMBER_A", email: "foodmap.member.a@example.com", name: "데모 회원A", role: "user" },
  { key: "MEMBER_B", email: "foodmap.member.b@example.com", name: "데모 회원B", role: "user" },
];
  const lines: string[] = ["# 데모 계정 (git 제외). 과제 제출 시 채점용으로 안내"];
for (const a of accounts) {
  const password = `Ajou!${randomBytes(6).toString("base64url")}`;
  const created = await db.auth.admin.createUser({ email: a.email, password, email_confirm: true, user_metadata: { name: a.name } });
  if (created.error) throw created.error;
  if (a.role === "admin") {
    const r = await db.rpc("set_foodmap_user_type", { p_user_id: created.data.user.id, p_user_type: "admin" });
    if (r.error) throw r.error;
  }
  lines.push(`${a.key}_EMAIL=${a.email}`, `${a.key}_PASSWORD=${password}`);
}
writeFileSync(".env.demo-accounts.local", lines.join("\n") + "\n");
const { data } = await db.from("profiles").select("email,name,user_type").in("email", accounts.map((a) => a.email));
console.log(data);
}
main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
