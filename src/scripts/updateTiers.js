import db from "../config/db.js";

const COMPANY_ID = 1;

/**
 * nationality -> tier_code
 */
function tierCodeFromNationality(natRaw) {
  const nat = (natRaw || "").trim().toLowerCase();

  if (nat === "china1") return "T1";
  if (nat === "china2") return "T2";
  if (nat === "china3") return "T3";
  if (nat === "china4") return "T4";

  if (nat === "my" || nat === "malaysia" || nat === "malaysian") {
    return "MY";
  }

  return null; // do NOT update if unknown
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function main() {
  try {
    await run("BEGIN TRANSACTION");

    // 1️⃣ Load tier_code -> tier_id map
    const tiers = await all(
      `SELECT id, tier_code FROM wage_tiers WHERE company_id = ?`,
      [COMPANY_ID]
    );

    const tierIdByCode = {};
    tiers.forEach(t => {
      tierIdByCode[t.tier_code] = t.id;
    });

    console.log("Tier map:", tierIdByCode);

    // 2️⃣ Get workers missing wage tier
    const workers = await all(
      `SELECT id, worker_code, worker_name, nationality
       FROM workers
       WHERE company_id = ?
         AND (wage_tier_id IS NULL OR wage_tier_id = '')`,
      [COMPANY_ID]
    );

    let updated = 0;
    let skipped = 0;

    for (const w of workers) {
      const tierCode = tierCodeFromNationality(w.nationality);
      if (!tierCode) {
        skipped++;
        continue;
      }

      const tierId = tierIdByCode[tierCode];
      if (!tierId) {
        console.warn(`⚠️ Tier ${tierCode} not found for worker ${w.worker_code}`);
        skipped++;
        continue;
      }

      await run(
        `UPDATE workers
         SET wage_tier_id = ?
         WHERE id = ? AND company_id = ?`,
        [tierId, w.id, COMPANY_ID]
      );

      updated++;
    }

    await run("COMMIT");

    console.log(`✅ Wage tier assignment complete`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
  } catch (err) {
    await run("ROLLBACK").catch(() => {});
    console.error("❌ Failed:", err.message);
  } finally {
    db.close?.();
  }
}

main();
