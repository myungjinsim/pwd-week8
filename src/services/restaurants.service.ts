import {
  getSupabase,
  getUserSupabase,
  throwDatabaseError,
} from "../config/supabase";
import Restaurant from "../models/restaurant.model";
import type { RestaurantInsert, RestaurantRow } from "../types/database.types";
import HttpError from "../utils/httpError";
import { menuField, numericId, objectBody, textField } from "../utils/input";

function restaurantInput(
  value: unknown,
  partial = false,
): Partial<RestaurantInsert> {
  const input = objectBody(value);
  const row: Partial<RestaurantInsert> = {};
  for (const field of ["name", "category", "location"] as const) {
    if (!partial || input[field] !== undefined)
      row[field] = textField(input[field], field, true, 300);
  }
  for (const [external, column] of [
    ["priceRange", "price_range"],
    ["description", "description"],
    ["image", "image"],
  ] as const) {
    if (input[external] !== undefined)
      row[column] = textField(input[external], external);
  }
  if (input.rating !== undefined) {
    if (
      !["string", "number"].includes(typeof input.rating) ||
      input.rating === ""
    )
      throw new HttpError(400, "평점은 0~5 사이의 숫자여야 합니다.");
    const rating = Number(input.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5)
      throw new HttpError(400, "평점은 0~5 사이의 숫자여야 합니다.");
    row.rating = rating;
  }
  if (input.recommendedMenu !== undefined)
    row.recommended_menu = menuField(input.recommendedMenu);
  if (partial && !Object.keys(row).length)
    throw new HttpError(400, "수정할 값을 입력하세요.");
  return row;
}
// 화면에 등록자 이름을 보여주기 위해 profiles에서 이름만 읽습니다(서버 전용 테이블).
export async function withCreatorNames(rows: RestaurantRow[]) {
  const ids = [...new Set(rows.map((row) => row.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("id,name")
      .in("id", ids);
    if (error) throwDatabaseError(error);
    for (const profile of data ?? []) names.set(profile.id, profile.name);
  }
  return rows.map((row) =>
    Restaurant.fromDatabase(row, row.created_by ? (names.get(row.created_by) ?? null) : null),
  );
}
export async function getAllRestaurants() {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .order("id");
  if (error) throwDatabaseError(error);
  return withCreatorNames(data ?? []);
}
export async function getRestaurantById(id: string) {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .eq("id", numericId(id))
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(404, "Restaurant not found");
  return (await withCreatorNames([data]))[0];
}
export async function getPopularRestaurants(limit: unknown = "5") {
  if (
    typeof limit !== "string" ||
    !/^\d+$/.test(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 50
  )
    throw new HttpError(400, "limit은 1~50 사이의 정수여야 합니다.");
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .order("rating", { ascending: false })
    .order("id")
    .limit(Number(limit));
  if (error) throwDatabaseError(error);
  return withCreatorNames(data ?? []);
}
// ---------------------------------------------------------------------------
// [과제: RLS] 아래 쓰기 함수는 서버 Secret key가 아닌 "요청자 토큰" 클라이언트로 실행합니다.
// 등록자 확인·관리자 확인을 Express 코드에서 하지 않고 Supabase 정책이 판단합니다.
// RLS가 막은 UPDATE·DELETE는 오류 대신 0행을 반환하므로, 행이 존재하는데 0행이면 403입니다.
// ---------------------------------------------------------------------------
async function assertExists(id: number) {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(404, "Restaurant not found");
}
const FORBIDDEN_MESSAGE =
  "본인이 등록한 맛집만 수정·삭제할 수 있습니다. (관리자는 모든 맛집 가능)";

export async function createRestaurant(
  value: unknown,
  userId: string,
  accessToken: string,
) {
  const row = {
    ...(restaurantInput(value) as RestaurantInsert),
    created_by: userId,
  };
  const { data, error } = await getUserSupabase(accessToken)
    .from("restaurants")
    .insert(row)
    .select("*")
    .single();
  if (error) throwDatabaseError(error);
  return (await withCreatorNames([data!]))[0];
}
export async function updateRestaurant(
  id: string,
  value: unknown,
  accessToken: string,
) {
  const restaurantId = numericId(id);
  const input = restaurantInput(value, true);
  await assertExists(restaurantId);
  const { data, error } = await getUserSupabase(accessToken)
    .from("restaurants")
    .update(input)
    .eq("id", restaurantId)
    .select("*")
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(403, FORBIDDEN_MESSAGE);
  return (await withCreatorNames([data]))[0];
}
export async function deleteRestaurant(id: string, accessToken: string) {
  const restaurantId = numericId(id);
  await assertExists(restaurantId);
  const { data, error } = await getUserSupabase(accessToken)
    .from("restaurants")
    .delete()
    .eq("id", restaurantId)
    .select("id")
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(403, FORBIDDEN_MESSAGE);
}
