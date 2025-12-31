import db from "../config/db.js";
// import bcrypt from "bcrypt";

// db.serialize(async () => {
//   console.log("⚠️ Recreating users table (DATA WILL BE LOST)");

//   db.run("PRAGMA foreign_keys = OFF");

//   db.run("DROP TABLE IF EXISTS users");

//   db.run(`
//     CREATE TABLE users (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       company_id INTEGER, -- NULL allowed for super_admin accounts
//       username TEXT NOT NULL,
//       email TEXT,
//       password_hash TEXT NOT NULL,
//       is_active INTEGER NOT NULL DEFAULT 1,
//       created_at TEXT DEFAULT CURRENT_TIMESTAMP,

//       UNIQUE (company_id, username),
//       UNIQUE (company_id, email),

//       FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
//     )
//   `);

//   db.run("PRAGMA foreign_keys = ON");

//   console.log("✅ Users table recreated.");

//   // ----- seed admin -----
//   const company_id = 1;     // change if needed
//   const username = "admin";
//   const password = "123456";
//   const email = "admin@local";

//   const password_hash = await bcrypt.hash(password, 10);

//   db.run(
//     `INSERT INTO users (company_id, username, email, password_hash, is_active)
//      VALUES (?, ?, ?, ?, 1)`,
//     [company_id, username, email, password_hash],
//     function (err) {
//       if (err) {
//         console.error("❌ Insert admin error:", err.message);
//       } else {
//         console.log("✅ Admin user created:", username, "(id:", this.lastID + ")");
//       }
//       process.exit(0);
//     }
//   );
// });
db.run(`UPDATE work_entries
    SET fees_collected = COALESCE(customer_total, customer_rate * amount)
    WHERE fees_collected IS NULL;
    `,
  function (err) {
      if (err) {
        console.error("❌ Alter error:", err.message);
      } else {
        console.log("✅ alter success");
      }
      process.exit(0);
    }
)