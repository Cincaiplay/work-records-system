import "dotenv/config";
import db from "../config/db.js";

const r = await db.query("SELECT NOW() AS now");
console.log("Postgres OK:", r.rows[0]);
process.exit(0);
