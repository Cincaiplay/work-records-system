// src/routes/companyRoutes.js (PostgreSQL)
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

// GET all companies
router.get("/", async (req, res) => {
  try {
    const r = await db.query(
      `
      SELECT id, name, short_code, address, phone, created_at
        FROM companies
       ORDER BY short_code ASC, name ASC
      `
    );
    return res.json(r.rows || []);
  } catch (err) {
    console.error("GET /api/companies error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// GET company details
router.get("/:id", async (req, res) => {
  const companyId = Number(req.params.id);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "Invalid company id" });
  }

  try {
    const r = await db.query(
      `
      SELECT id, name, short_code, address, phone, created_at
        FROM companies
       WHERE id = $1
       LIMIT 1
      `,
      [companyId]
    );

    const row = r.rows[0] || null;
    if (!row) return res.status(404).json({ error: "Company not found" });

    return res.json(row);
  } catch (err) {
    console.error("GET /api/companies/:id error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// CREATE company
router.post("/", async (req, res) => {
  const { name, short_code, address, phone } = req.body;

  if (!name) {
    return res.status(400).json({ error: "name is required." });
  }

  try {
    const r = await db.query(
      `
      INSERT INTO companies (name, short_code, address, phone)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, short_code, address, phone
      `,
      [name, short_code || null, address || "", phone || ""]
    );

    const row = r.rows[0];
    return res.status(201).json(row);
  } catch (err) {
    // unique_violation
    if (err?.code === "23505") {
      // Most likely companies_short_code_key
      return res.status(409).json({ error: "short_code must be unique." });
    }

    console.error("POST /api/companies error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// UPDATE company
router.put("/:id", async (req, res) => {
  const companyId = Number(req.params.id);
  const { name, short_code, address, phone } = req.body;

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "Invalid company id" });
  }

  if (!name) {
    return res.status(400).json({ error: "name is required." });
  }

  try {
    const r = await db.query(
      `
      UPDATE companies
         SET name       = $1,
             short_code = $2,
             address    = $3,
             phone      = $4
       WHERE id = $5
      `,
      [name, short_code || null, address || "", phone || "", companyId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Company not found." });
    }

    return res.json({ message: "Company updated", changes: r.rowCount });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "short_code must be unique." });
    }

    console.error("PUT /api/companies error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// DELETE company
router.delete("/:id", async (req, res) => {
  const companyId = Number(req.params.id);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "Invalid company id" });
  }

  try {
    const r = await db.query(`DELETE FROM companies WHERE id = $1`, [companyId]);

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Company not found." });
    }

    return res.json({ message: "Company deleted", changes: r.rowCount });
  } catch (err) {
    console.error("DELETE /api/companies error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
