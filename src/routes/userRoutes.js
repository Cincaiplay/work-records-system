import { Router } from "express";
import { getUsers, createUserController } from "../controllers/userController.js"; 

const router = Router();

// GET /api/users
router.get("/", getUsers);

// POST /api/users
router.post("/", createUserController);

export default router;
