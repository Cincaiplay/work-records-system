// src/config/dbAdapter.js
import "dotenv/config";

const dialect = (process.env.DB_DIALECT || "sqlite").toLowerCase();

let sqliteDb = null;
let pg = null;

/**
 * SQLite lazy import (keeps current system working)
 * - Your existing SQLite module is probably src/config/db.js
 */
async function getSqliteDb() {
  if (sqliteDb) return sqliteDb;
  const mod = await import("./db.js"); // <-- your existing sqlite db module
  sqliteDb = mod.default || mod.db || mod;
  return sqliteDb;
}

/**
 * Postgres lazy import
 */
async function getPg() {
  if (pg) return pg;
  const mod = await import("./pg.js");
  pg = mod;
  return pg;
}

export const db = {
  dialect,

  // -------------------------
  // Postgres-style API
  // -------------------------
  async query(text, params = []) {
    if (dialect !== "postgres") {
      throw new Error("db.query is only available in postgres mode.");
    }
    const { query } = await getPg();
    return query(text, params);
  },

  async tx(fn) {
    if (dialect !== "postgres") {
      throw new Error("db.tx is only available in postgres mode.");
    }
    const { tx } = await getPg();
    return tx(fn);
  },

  // -------------------------
  // SQLite-style API (temporary bridge)
  // -------------------------
  async run(sql, params = []) {
    if (dialect !== "sqlite") {
      throw new Error("db.run is only available in sqlite mode.");
    }
    const sdb = await getSqliteDb();
    return new Promise((resolve, reject) => {
      sdb.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  async get(sql, params = []) {
    if (dialect !== "sqlite") {
      throw new Error("db.get is only available in sqlite mode.");
    }
    const sdb = await getSqliteDb();
    return new Promise((resolve, reject) => {
      sdb.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  },

  async all(sql, params = []) {
    if (dialect !== "sqlite") {
      throw new Error("db.all is only available in sqlite mode.");
    }
    const sdb = await getSqliteDb();
    return new Promise((resolve, reject) => {
      sdb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  async exec(sql) {
    if (dialect !== "sqlite") {
      throw new Error("db.exec is only available in sqlite mode.");
    }
    const sdb = await getSqliteDb();
    return new Promise((resolve, reject) => {
      sdb.exec(sql, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },
};
