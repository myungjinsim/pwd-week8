import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import createApp from "../src/app";
import { getSupabase, throwDatabaseError } from "../src/config/supabase";

// [과제: 권한 검증] 실제 Supabase 프로젝트에서 RLS 정책을 확인합니다.
//   1) 브라우저처럼 Data API에 직접 요청해도 RLS가 막는지
//   2) Express API를 거칠 때도 같은 결과(403/200)가 나오는지
// 이 실행에서 만든 임시 계정·맛집만 만들고 끝에서 정리합니다.
async function main() {
  const url = process.env.SUPABASE_URL!;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!publishable)
    throw new Error("서버 .env에 SUPABASE_PUBLISHABLE_KEY가 필요합니다.");
  const service = getSupabase();
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  const run = `rls-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const password = `R1s!${randomBytes(18).toString("base64url")}`;
  const roles = ["memberA", "memberB", "admin"] as const;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const clients: Record<string, SupabaseClient> = {};
  const restaurantIds: number[] = [];
  const rows: [string, string, string][] = [];
  const check = (who: string, action: string, result: string) => {
    rows.push([who, action, result]);
    console.log(`  ✔ ${who.padEnd(10)} ${action.padEnd(36)} → ${result}`);
  };

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function api(path: string, token: string, method: string, body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    for (const role of roles) {
      const email = `${run}-${role.toLowerCase()}@example.com`;
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `RLS ${role}` },
      });
      if (created.error) throw created.error;
      ids[role] = created.data.user.id;
      clients[role] = createClient(url, publishable, options);
      const signIn = await clients[role].auth.signInWithPassword({ email, password });
      if (signIn.error) throw signIn.error;
      tokens[role] = signIn.data.session.access_token;
    }
    const promote = await service.rpc("set_foodmap_user_type", {
      p_user_id: ids.admin,
      p_user_type: "admin",
    });
    if (promote.error) throwDatabaseError(promote.error);
    console.log("\n[1] Data API 직접 요청 — RLS 정책만으로 판단");

    const anonymous = createClient(url, publishable, options);
    const anonList = await anonymous.from("restaurants").select("id").limit(1);
    assert.ifError(anonList.error);
    check("비회원", "맛집 목록 조회", "허용");
    const anonInsert = await anonymous
      .from("restaurants")
      .insert({ name: `${run} 비회원`, category: "한식", location: "캠퍼스" });
    assert.ok(anonInsert.error, "비회원 등록은 거절되어야 합니다.");
    check("비회원", "맛집 등록", `차단 (${anonInsert.error.code})`);

    const inserted = await clients.memberA
      .from("restaurants")
      .insert({ name: `${run} A의 맛집`, category: "한식", location: "캠퍼스", created_by: ids.memberA })
      .select("id,created_by")
      .single();
    assert.ifError(inserted.error);
    const id = inserted.data!.id as number;
    restaurantIds.push(id);
    assert.equal(inserted.data!.created_by, ids.memberA);
    check("회원A", `맛집 등록 (id=${id})`, "허용, 등록자=A");

    const spoof = await clients.memberB
      .from("restaurants")
      .insert({ name: `${run} 사칭`, category: "한식", location: "캠퍼스", created_by: ids.memberA });
    assert.ok(spoof.error, "다른 사람 명의 등록은 거절되어야 합니다.");
    check("회원B", "A 명의로 맛집 등록", `차단 (${spoof.error.code})`);

    const otherUpdate = await clients.memberB
      .from("restaurants")
      .update({ name: `${run} B가 수정` })
      .eq("id", id)
      .select("id");
    assert.ifError(otherUpdate.error);
    assert.equal(otherUpdate.data!.length, 0, "다른 회원의 수정은 0행이어야 합니다.");
    check("회원B", "A의 맛집 수정", "차단 (0행 갱신)");

    const otherDelete = await clients.memberB.from("restaurants").delete().eq("id", id).select("id");
    assert.ifError(otherDelete.error);
    assert.equal(otherDelete.data!.length, 0);
    check("회원B", "A의 맛집 삭제", "차단 (0행 삭제)");

    const ownUpdate = await clients.memberA
      .from("restaurants")
      .update({ name: `${run} A가 수정` })
      .eq("id", id)
      .select("id");
    assert.ifError(ownUpdate.error);
    assert.equal(ownUpdate.data!.length, 1);
    check("회원A", "본인 맛집 수정", "허용 (1행)");

    const adminUpdate = await clients.admin
      .from("restaurants")
      .update({ name: `${run} 관리자 수정` })
      .eq("id", id)
      .select("id");
    assert.ifError(adminUpdate.error);
    assert.equal(adminUpdate.data!.length, 1);
    check("관리자", "A의 맛집 수정", "허용 (1행)");

    console.log("\n[2] Express API 요청 — 서버도 사용자 토큰으로 RLS를 거침");
    const b = await api(`/api/restaurants/${id}`, tokens.memberB, "PUT", { name: `${run} B API` });
    assert.equal(b.status, 403, JSON.stringify(b.body));
    check("회원B", `PUT /api/restaurants/${id}`, "403 Forbidden");
    const bDel = await api(`/api/restaurants/${id}`, tokens.memberB, "DELETE");
    assert.equal(bDel.status, 403);
    check("회원B", `DELETE /api/restaurants/${id}`, "403 Forbidden");
    const a = await api(`/api/restaurants/${id}`, tokens.memberA, "PUT", { rating: 4.5 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    check("회원A", `PUT /api/restaurants/${id}`, "200 OK");
    const admin = await api(`/api/restaurants/${id}`, tokens.admin, "PUT", { name: `${run} 관리자 API` });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    check("관리자", `PUT /api/restaurants/${id}`, "200 OK");
    const adminDel = await api(`/api/restaurants/${id}`, tokens.admin, "DELETE");
    assert.equal(adminDel.status, 204);
    check("관리자", `DELETE /api/restaurants/${id}`, "204 No Content");
    restaurantIds.length = 0;

    console.log(`\nRLS 검증 통과: ${rows.length}개 항목`);
  } finally {
    server.close();
    for (const id of restaurantIds) await service.from("restaurants").delete().eq("id", id);
    for (const userId of Object.values(ids)) await service.auth.admin.deleteUser(userId);
    console.log("임시 계정·맛집 정리 완료");
  }
}

main().catch((error) => {
  console.error("\nRLS 검증 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
