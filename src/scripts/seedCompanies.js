import db from "../config/db.js";

const companies = [
  {
    id: 1,
    name: "Twin Reflexology",
    code: "TRX",
    address: "N/A",
    phone: "",
  },
  {
    id: 2,
    name: "Miri City Spa",
    code: "MCS",
    address: "N/A",
    phone: "",
  },
  // You can add more companies here later
  // { id: 2, name: "Company B", short_code: "COMPB", address: "...", phone: "..." }
];

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_code TEXT UNIQUE,
      address TEXT,
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO companies (id, name, short_code, address, phone)
    VALUES (?, ?, ?, ?, ?)
  `);

  companies.forEach(c => {
    stmt.run(c.id, c.name, c.short_code, c.address, c.phone);
  });

  stmt.finalize();
  console.log("✅ Companies table seeded.");
});
