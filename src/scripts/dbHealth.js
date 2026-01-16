// src/scripts/dbHealth.js
import "dotenv/config";
import { db } from "../config/dbAdapter.js";

async function main() {
  console.log("DB_DIALECT =", db.dialect);

  if (db.dialect === "postgres") {
    const r = await db.query("SELECT NOW() AS now");
    console.log("Postgres OK:", r.rows[0]);
    return;
  }

  // sqlite
  const row = await db.get("SELECT datetime('now') AS now");
  console.log("SQLite OK:", row);
}

main().catch((err) => {
  console.error("Health check failed:", err);
  process.exit(1);
});
