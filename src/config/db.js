// src/config/db.js (PostgreSQL)
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// small helper for transactions
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const db = {
  pool,
  query: (text, params = []) => pool.query(text, params),
  tx,
};

export default db;
