import { Router } from "express";
import { isAuthenticated } from "../middleware/auth.middleware";
import * as controller from "../controllers/restaurants.controller";
const router = Router();
router.get("/", controller.list);
router.get("/popular", controller.popular);
router.get("/:id", controller.get);
// [과제: 권한] Express는 로그인(토큰 검증)만 확인합니다.
// 누가 어떤 맛집을 수정·삭제할 수 있는지는 Supabase RLS 정책이 판단합니다.
//   회원: 등록 + 본인 맛집 수정·삭제 / 관리자: 모든 맛집 수정·삭제
router.post("/", isAuthenticated, controller.create);
router.put("/:id", isAuthenticated, controller.update);
router.delete("/:id", isAuthenticated, controller.remove);
export default router;
