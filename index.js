import "dotenv/config"; 
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import pgSession from "connect-pg-simple";
import db from "./src/config/db.js";

import { requirePermission, hasPermission } from "./src/middleware/permission.js";
import userRoutes from "./src/routes/userRoutes.js";
import jobRoutes from "./src/routes/jobRoutes.js";
import workerRoutes from "./src/routes/workerRoutes.js";
import workEntryRoutes from "./src/routes/workEntryRoutes.js";
import companyRoutes from "./src/routes/companyRoutes.js";
import rulesRoutes from "./src/routes/rulesRoute.js";
import reportRoutes from "./src/routes/reportRoutes.js";
import wageTierRoutes from "./src/routes/wageTierRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";
import { requireAuth } from "./src/middleware/auth.js";
import managementRoutes from "./src/routes/managementRoutes.js";
import companyContextRoutes from "./src/routes/companyContextRoutes.js";

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PgSession = pgSession(session);

// --- fail fast on missing env ---
if (!process.env.SESSION_SECRET) {
  console.error("❌ SESSION_SECRET is not set. Refusing to start.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set. Refusing to start.");
  process.exit(1);
}

// --- basic middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Behind nginx / load balancer (HTTPS termination)
app.set("trust proxy", 1);

// --- sessions ---
app.use(
  session({
    store: new PgSession({
      pool: db.pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// --- locals ---
app.use((req, res, next) => {
  const user = req.session?.user || null;

  res.locals.user = user;
  res.locals.isAdmin = Number(user?.is_admin) === 1;
  res.locals.permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const permSet = new Set(res.locals.permissions.map((p) => String(p || "").toLowerCase()));
  res.locals.can = (perm) =>
    res.locals.isAdmin || permSet.has(String(perm || "").toLowerCase());

  if (user?.id) {
    if (!res.locals.isAdmin) {
      req.session.activeCompanyId = user.company_id;
    } else {
      req.session.activeCompanyId = req.session.activeCompanyId ?? user.company_id ?? null;
    }
  }

  res.locals.activeCompanyId = req.session.activeCompanyId || null;
  next();
});

// --- view engine / static ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// --- routes ---
app.use(authRoutes);
app.use(managementRoutes);
app.use(companyContextRoutes);

app.get("/", requireAuth, (req, res) => res.redirect("/dashboard"));

app.get(
  "/dashboard",
  requireAuth,
  requirePermission("PAGE_DASHBOARD"),
  async (req, res) => {
    const user = req.session?.user;

    let canSeeRates = false;
    let canUseBatch = false;

    try {
      if (Number(user?.is_admin) === 1) {
        canSeeRates = true;
        canUseBatch = true;
      } else {
        canSeeRates = await hasPermission(Number(user?.id), "WORK_ENTRY_EDIT_RATES");
        canUseBatch = await hasPermission(Number(user?.id), "BATCH_ENTRY");
      }
    } catch (err) {
      console.error("permission check failed:", err);
    }

    res.render("dashboard", {
      title: "Dashboard",
      user,
      isAdmin: Number(user?.is_admin) === 1,
      canSeeRates,
      canUseBatch,
    });
  }
);

app.get("/workers", requireAuth, requirePermission("PAGE_WORKERS"), (req, res) =>
  res.render("workers", { title: "Workers" })
);

app.get("/jobs", requireAuth, requirePermission("PAGE_JOBS"), (req, res) =>
  res.render("jobs", { title: "Jobs" })
);

app.get("/companies", requireAuth, requirePermission("PAGE_COMPANIES"), (req, res) =>
  res.render("companies", { title: "Companies" })
);

app.get("/records", requireAuth, requirePermission("PAGE_RECORDS"), (req, res) =>
  res.render("records", { title: "Work Entries Records", active: "records" })
);

app.get("/reports", requireAuth, requirePermission("PAGE_REPORTS"), async (req, res) => {
  const user = req.session?.user;
  const userId = Number(user?.id);

  let canFilterPayType = false;
  try {
    canFilterPayType =
      Number(user?.is_admin) === 1 ? true : await hasPermission(userId, "REPORT_FILTER_PAYTYPE");
  } catch (err) {
    console.error("permission check failed:", err);
  }

  res.render("reports", { title: "Reports", canFilterPayType });
});

app.get("/403", (req, res) => {
  res.status(403).render("403", {
    title: "Access denied",
    active: null,
    missingPermission: req.query.perm || null,
    message: req.query.msg || null,
    path: req.query.path || req.originalUrl,
    method: req.query.method || "GET",
  });
});

// --- API routes ---
app.use("/api/users", userRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/workers", workerRoutes);
app.use("/api/work-entries", workEntryRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api", rulesRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/wage-tiers", wageTierRoutes);

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});
