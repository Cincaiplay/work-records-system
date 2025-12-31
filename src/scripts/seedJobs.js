// scripts/seed_jobs_new_system.js
// Run: node scripts/seed_jobs_new_system.js
//
// What it does (per company):
// 1) Ensures wage tiers exist (T1/T2/T3/T4/MY)
// 2) Inserts jobs into jobs table (job_code, job_type, normal_price, is_active)
// 3) Upserts job_wages rows for every tier (default 0)
// 4) Safe to re-run (uses UPSERT + UNIQUE constraints)

import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ adjust if your data.sqlite path is different
const dbPath = path.join(__dirname, "../../data.sqlite");
const db = new sqlite3.Database(dbPath);

// ----------------------------
// CONFIG
// ----------------------------
const COMPANY_ID = 1; // change to seed other company

const TIERS = [
  { tier_code: "T1", tier_name: "Wage Tier 1 (1yr)", sort_order: 1 },
  { tier_code: "T2", tier_name: "Wage Tier 2 (2yr)", sort_order: 2 },
  { tier_code: "T3", tier_name: "Wage Tier 3 (3yr)", sort_order: 3 },
  { tier_code: "T4", tier_name: "Wage Tier 4 (4yr)", sort_order: 4 },
  { tier_code: "MY", tier_name: "Malaysian", sort_order: 99 },
];

// ✅ Paste your legacy jobs here (your current array is fine)
const JOBS = [
  {
    "job_code": "JC01",
    "job_type": "按脚-68",
    "normal_price": 68,
    "vip_price": 27.2,
    "promo_price": 27.2,
    "wage_rate_1yr": 27.2,
    "wage_rate_2yr": 27.2,
    "wage_rate_3yr": 28,
    "wage_rate_4yr": 28,
    "wage_rate_malaysian": 34
  },
  {
    "job_code": "JC01-1",
    "job_type": "按脚-102 (1.5 小时）",
    "normal_price": 102,
    "vip_price": 40.8,
    "promo_price": 40.8,
    "wage_rate_1yr": 40.8,
    "wage_rate_2yr": 40.8,
    "wage_rate_3yr": 43,
    "wage_rate_4yr": 43,
    "wage_rate_malaysian": 51
  },
  {
    "job_code": "JC01-2",
    "job_type": "按脚-136 (2 小时）",
    "normal_price": 136,
    "vip_price": 54.4,
    "promo_price": 54.4,
    "wage_rate_1yr": 54.4,
    "wage_rate_2yr": 54.4,
    "wage_rate_3yr": 57,
    "wage_rate_4yr": 57,
    "wage_rate_malaysian": 68
  },
  {
    "job_code": "JC02",
    "job_type": "按脚(精油)-70",
    "normal_price": 70,
    "vip_price": 28,
    "promo_price": 28,
    "wage_rate_1yr": 28,
    "wage_rate_2yr": 28,
    "wage_rate_3yr": 29,
    "wage_rate_4yr": 29,
    "wage_rate_malaysian": 35
  },
  {
    "job_code": "JC02-1",
    "job_type": "按脚(精油)-105 (1.5 小时）",
    "normal_price": 105,
    "vip_price": 42,
    "promo_price": 42,
    "wage_rate_1yr": 42,
    "wage_rate_2yr": 42,
    "wage_rate_3yr": 44,
    "wage_rate_4yr": 44,
    "wage_rate_malaysian": 52.5
  },
  {
    "job_code": "JC02-2",
    "job_type": "按脚(精油)-140 (2 小时）",
    "normal_price": 140,
    "vip_price": 56,
    "promo_price": 56,
    "wage_rate_1yr": 56,
    "wage_rate_2yr": 56,
    "wage_rate_3yr": 59,
    "wage_rate_4yr": 59,
    "wage_rate_malaysian": 70
  },
  {
    "job_code": "JC03",
    "job_type": "按身(中式)-78",
    "normal_price": 78,
    "vip_price": 31.2,
    "promo_price": 31.2,
    "wage_rate_1yr": 31.2,
    "wage_rate_2yr": 31.2,
    "wage_rate_3yr": 33,
    "wage_rate_4yr": 33,
    "wage_rate_malaysian": 39
  },

  {
    "job_code": "JC03-1",
    "job_type": "按身-117 (1.5 小时）",
    "normal_price": 117,
    "vip_price": 46.8,
    "promo_price": 46.8,
    "wage_rate_1yr": 46.8,
    "wage_rate_2yr": 46.8,
    "wage_rate_3yr": 49,
    "wage_rate_4yr": 49,
    "wage_rate_malaysian": 58.5
  },
  {
    "job_code": "JC03-2",
    "job_type": "按身-156 (2 小时）",
    "normal_price": 156,
    "vip_price": 62.4,
    "promo_price": 62.4,
    "wage_rate_1yr": 62.4,
    "wage_rate_2yr": 62.4,
    "wage_rate_3yr": 66,
    "wage_rate_4yr": 66,
    "wage_rate_malaysian": 78
  },
  {
    "job_code": "JC04",
    "job_type": "按身(精油)-82",
    "normal_price": 82,
    "vip_price": 32.8,
    "promo_price": 32.8,
    "wage_rate_1yr": 32.8,
    "wage_rate_2yr": 32.8,
    "wage_rate_3yr": 34,
    "wage_rate_4yr": 34,
    "wage_rate_malaysian": 41
  },
  {
    "job_code": "JC04-1",
    "job_type": "按身(精油)-123 (1.5 小时）",
    "normal_price": 123,
    "vip_price": 49.2,
    "promo_price": 49.2,
    "wage_rate_1yr": 49.2,
    "wage_rate_2yr": 49.2,
    "wage_rate_3yr": 52,
    "wage_rate_4yr": 52,
    "wage_rate_malaysian": 61.5
  },
  {
    "job_code": "JC04-2",
    "job_type": "按身(精油)-164 (2 小时）",
    "normal_price": 164,
    "vip_price": 65.6,
    "promo_price": 65.6,
    "wage_rate_1yr": 65.6,
    "wage_rate_2yr": 65.6,
    "wage_rate_3yr": 64,
    "wage_rate_4yr": 64,
    "wage_rate_malaysian": 82
  },

  {
    "job_code": "JC05",
    "job_type": "身体(SPA)-88",
    "normal_price": 88,
    "vip_price": 35.2,
    "promo_price": 35.2,
    "wage_rate_1yr": 35.2,
    "wage_rate_2yr": 35.2,
    "wage_rate_3yr": 37,
    "wage_rate_4yr": 37,
    "wage_rate_malaysian": 44
  },
  {
    "job_code": "JC05-1",
    "job_type": "身体(SPA)-132  (1.5 小时）",
    "normal_price": 132,
    "vip_price": 52.8,
    "promo_price": 52.8,
    "wage_rate_1yr": 52.8,
    "wage_rate_2yr": 52.8,
    "wage_rate_3yr": 55,
    "wage_rate_4yr": 55,
    "wage_rate_malaysian": 66
  },

  {
    "job_code": "JC06",
    "job_type": "按身(泰式)-138",
    "normal_price": 138,
    "vip_price": 55.2,
    "promo_price": 55.2,
    "wage_rate_1yr": 55.2,
    "wage_rate_2yr": 55.2,
    "wage_rate_3yr": 58,
    "wage_rate_4yr": 58,
    "wage_rate_malaysian": 69
  },

  {
    "job_code": "JC07",
    "job_type": "局部(耳/脚/刮/拔)-40",
    "normal_price": 40,
    "vip_price": 16,
    "promo_price": 16,
    "wage_rate_1yr": 16,
    "wage_rate_2yr": 20,
    "wage_rate_3yr": 20,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 20
  },

  {
    "job_code": "JC08",
    "job_type": "洗脸-70",
    "normal_price": 70,
    "vip_price": 28,
    "promo_price": 28,
    "wage_rate_1yr": 28,
    "wage_rate_2yr": 28,
    "wage_rate_3yr": 30,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 35
  },

  {
    "job_code": "JC09",
    "job_type": "其他 - 10",
    "normal_price": 10,
    "vip_price": 5,
    "promo_price": 5,
    "wage_rate_1yr": 5,
    "wage_rate_2yr": 5,
    "wage_rate_3yr": 5,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 5
  },

  {
    "job_code": "JC10",
    "job_type": "出钟 - 60",
    "normal_price": 60,
    "vip_price": 30,
    "promo_price": 30,
    "wage_rate_1yr": 30,
    "wage_rate_2yr": 30,
    "wage_rate_3yr": 30,
    "wage_rate_4yr": 30,
    "wage_rate_malaysian": 30
  },

  {
    "job_code": "JC11",
    "job_type": "出钟 - 75",
    "normal_price": 75,
    "vip_price": 75,
    "promo_price": 75,
    "wage_rate_1yr": 37.5,
    "wage_rate_2yr": 37.5,
    "wage_rate_3yr": 37.5,
    "wage_rate_4yr": 37.5,
    "wage_rate_malaysian": 37.5
  },

  {
    "job_code": "JC12",
    "job_type": "出钟 - 80",
    "normal_price": 80,
    "vip_price": 40,
    "promo_price": 40,
    "wage_rate_1yr": 40,
    "wage_rate_2yr": 40,
    "wage_rate_3yr": 40,
    "wage_rate_4yr": 40,
    "wage_rate_malaysian": 40
  },

  {
    "job_code": "JC13",
    "job_type": "出钟 - 90",
    "normal_price": 90,
    "vip_price": 45,
    "promo_price": 45,
    "wage_rate_1yr": 45,
    "wage_rate_2yr": 45,
    "wage_rate_3yr": 45,
    "wage_rate_4yr": 45,
    "wage_rate_malaysian": 45
  },

  {
    "job_code": "JC14",
    "job_type": "半天 - 380",
    "normal_price": 380,
    "vip_price": 190,
    "promo_price": 190,
    "wage_rate_1yr": 190,
    "wage_rate_2yr": 190,
    "wage_rate_3yr": 190,
    "wage_rate_4yr": 190,
    "wage_rate_malaysian": 190
  },

  {
    "job_code": "JC15",
    "job_type": "全天 - 700",
    "normal_price": 700,
    "vip_price": 350,
    "promo_price": 350,
    "wage_rate_1yr": 350,
    "wage_rate_2yr": 350,
    "wage_rate_3yr": 350,
    "wage_rate_4yr": 350,
    "wage_rate_malaysian": 350
  },

  {
    "job_code": "JC16",
    "job_type": "夜钟 - 300",
    "normal_price": 300,
    "vip_price": 150,
    "promo_price": 150,
    "wage_rate_1yr": 150,
    "wage_rate_2yr": 150,
    "wage_rate_3yr": 150,
    "wage_rate_4yr": 150,
    "wage_rate_malaysian": 150
  },

  {
    "job_code": "JC17",
    "job_type": "夜钟 - 100",
    "normal_price": 100,
    "vip_price": 50,
    "promo_price": 50,
    "wage_rate_1yr": 50,
    "wage_rate_2yr": 50,
    "wage_rate_3yr": 50,
    "wage_rate_4yr": 50,
    "wage_rate_malaysian": 50
  },

  {
    "job_code": "JC18",
    "job_type": "腹疗-90",
    "normal_price": 90,
    "vip_price": 90,
    "promo_price": 90,
    "wage_rate_1yr": 36,
    "wage_rate_2yr": 36,
    "wage_rate_3yr": 36,
    "wage_rate_4yr": 36,
    "wage_rate_malaysian": 45
  },

  {
    "job_code": "ZZ92",
    "job_type": "管理薪金1",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 2400
  },

  {
    "job_code": "ZZ93",
    "job_type": "管理薪金2",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 1600
  },

  {
    "job_code": "ZZ94",
    "job_type": "卫生费",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 1500
  },

  {
    "job_code": "ZZ95",
    "job_type": "前台",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 1500
  },

  {
    "job_code": "ZZ96",
    "job_type": "晚班",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 0
  },

  {
    "job_code": "ZZ97",
    "job_type": "早班",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 1200
  },

  {
    "job_code": "ZZ98",
    "job_type": "账目处理",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 500
  },

  {
    "job_code": "ZZ99",
    "job_type": "保安服务",
    "normal_price": 0,
    "vip_price": 0,
    "promo_price": 0,
    "wage_rate_1yr": 0,
    "wage_rate_2yr": 0,
    "wage_rate_3yr": 0,
    "wage_rate_4yr": 0,
    "wage_rate_malaysian": 0
  }
]
;

// ----------------------------
// Helpers
// ----------------------------
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function toNumber(v, fallback = 0) {
  if (v === "" || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ✅ Convert your legacy job wage fields -> tier_code wage_rates object
function buildWageRatesByTierCode(job) {
  return {
    T1: toNumber(job.wage_rate_1yr, 0),
    T2: toNumber(job.wage_rate_2yr, 0),
    T3: toNumber(job.wage_rate_3yr, 0),
    T4: toNumber(job.wage_rate_4yr, 0),
    MY: toNumber(job.wage_rate_malaysian, 0),
  };
}

// ----------------------------
// Seed Steps
// ----------------------------
async function ensureTiers(companyId) {
  for (const t of TIERS) {
    await run(
      `
      INSERT INTO wage_tiers (company_id, tier_code, tier_name, is_active, sort_order)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(company_id, tier_code) DO NOTHING
      `,
      [companyId, t.tier_code, t.tier_name, t.sort_order]
    );
  }

  const rows = await all(
    `
    SELECT id, tier_code, tier_name, sort_order, is_active
    FROM wage_tiers
    WHERE company_id = ?
    ORDER BY sort_order ASC, id ASC
    `,
    [companyId]
  );

  return new Map(rows.map(r => [r.tier_code, r.id])); // tier_code -> tier_id
}

async function upsertJob(companyId, job) {
  const job_code = String(job.job_code || "").trim();
  const job_type = String(job.job_type || "").trim();

  if (!job_code || !job_type) {
    throw new Error(`Invalid job (missing job_code/job_type): ${JSON.stringify(job)}`);
  }

  const normal_price = toNumber(job.normal_price, 0);
  const is_active = job.is_active != null ? Number(job.is_active) : 1;

  await run(
    `
    INSERT INTO jobs (company_id, job_code, job_type, normal_price, is_active)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id, job_code) DO UPDATE SET
      job_type = excluded.job_type,
      normal_price = excluded.normal_price,
      is_active = excluded.is_active
    `,
    [companyId, job_code, job_type, normal_price, is_active]
  );

  const [row] = await all(
    `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
    [companyId, job_code]
  );

  if (!row) throw new Error(`Failed to fetch inserted job id for ${job_code}`);
  return row.id;
}

async function upsertJobWages(companyId, jobId, tierCodeToId, wageRatesByTierCode) {
  const rates = wageRatesByTierCode && typeof wageRatesByTierCode === "object"
    ? wageRatesByTierCode
    : {};

  // Ensure we write a row for every tier (default 0)
  for (const [tier_code, tier_id] of tierCodeToId.entries()) {
    const wage_rate = toNumber(rates[tier_code], 0);

    await run(
      `
      INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(job_id, tier_id) DO UPDATE SET
        wage_rate = excluded.wage_rate
      `,
      [companyId, jobId, tier_id, wage_rate]
    );
  }
}

async function main() {
  console.log("DB:", dbPath);

  await run("PRAGMA foreign_keys = ON");

  const tierCodeToId = await ensureTiers(COMPANY_ID);
  console.log("Tier map:", Object.fromEntries(tierCodeToId));

  if (!Array.isArray(JOBS) || JOBS.length === 0) {
    console.log("⚠️ JOBS array is empty. Paste your jobs into JOBS and rerun.");
    return;
  }

  await run("BEGIN TRANSACTION");
  try {
    for (const job of JOBS) {
      const jobId = await upsertJob(COMPANY_ID, job);

      // ✅ key fix: convert legacy fields to tier_code wage map
      const wageRatesByTierCode = buildWageRatesByTierCode(job);

      await upsertJobWages(COMPANY_ID, jobId, tierCodeToId, wageRatesByTierCode);

      console.log(`✅ Seeded: ${job.job_code} (job_id=${jobId})`);
    }

    await run("COMMIT");
    console.log("🎉 Done seeding jobs + job_wages.");
  } catch (err) {
    await run("ROLLBACK");
    console.error("❌ Seed failed:", err.message);
    throw err;
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
