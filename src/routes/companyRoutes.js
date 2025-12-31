// src/routes/companyRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

// GET all companies
router.get("/", (req, res) => {
  db.all(
    `SELECT id, name, short_code, address, phone, created_at
       FROM companies
      ORDER BY short_code ASC, name ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error("GET /api/companies error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// CREATE company
router.post("/", (req, res) => {
  const { name, short_code, address, phone } = req.body;

  if (!name) {
    return res.status(400).json({ error: "name is required." });
  }

  db.run(
    `INSERT INTO companies (
       name,
       short_code,
       address,
       phone
     ) VALUES (?, ?, ?, ?)`,
    [name, short_code || null, address || "", phone || ""],
    function (err) {
      if (err) {
        console.error("POST /api/companies error:", err.message);

        if (err.message.includes("UNIQUE constraint failed: companies.short_code")) {
          return res.status(409).json({ error: "short_code must be unique." });
        }

        return res.status(500).json({ error: "Database error" });
      }

      res.status(201).json({
        id: this.lastID,
        name,
        short_code: short_code || null,
        address: address || "",
        phone: phone || "",
      });
    }
  );
});

// UPDATE company
router.put("/:id", (req, res) => {
  const { name, short_code, address, phone } = req.body;

  if (!name) {
    return res.status(400).json({ error: "name is required." });
  }

  db.run(
    `UPDATE companies
        SET name       = ?,
            short_code = ?,
            address    = ?,
            phone      = ?
      WHERE id = ?`,
    [name, short_code || null, address || "", phone || "", req.params.id],
    function (err) {
      if (err) {
        console.error("PUT /api/companies error:", err.message);

        if (err.message.includes("UNIQUE constraint failed: companies.short_code")) {
          return res.status(409).json({ error: "short_code must be unique." });
        }

        return res.status(500).json({ error: "Database error" });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: "Company not found." });
      }

      res.json({ message: "Company updated", changes: this.changes });
    }
  );
});

// DELETE company
router.delete("/:id", (req, res) => {
  db.run(
    "DELETE FROM companies WHERE id = ?",
    [req.params.id],
    function (err) {
      if (err) {
        console.error("DELETE /api/companies error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: "Company not found." });
      }

      res.json({ message: "Company deleted", changes: this.changes });
    }
  );
});

export default router;
