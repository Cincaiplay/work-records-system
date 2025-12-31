import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import { requirePermission, hasPermission } from "./src/middleware/permission.js";

import "./src/config/db.js";
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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ✅ session FIRST
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
  })
);

// ✅ locals AFTER session (single middleware)
app.use((req, res, next) => {
  const user = req.session?.user || null;

  // expose to EJS
  res.locals.user = user;
  res.locals.isAdmin = Number(user?.is_admin) === 1;
  res.locals.permissions = Array.isArray(user?.permissions) ? user.permissions : [];

  // optional helper: can("PERM_CODE")
  res.locals.can = (perm) => res.locals.isAdmin || res.locals.permissions.includes(perm);

  // company context
  if (user?.id) {
    if (!res.locals.isAdmin) {
      req.session.activeCompanyId = user.company_id; // force non-admin
    } else {
      req.session.activeCompanyId = req.session.activeCompanyId ?? user.company_id ?? null;
    }
  }
  res.locals.activeCompanyId = req.session.activeCompanyId || null;

  next();
});


// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

// routes that render views
app.use(authRoutes);
app.use(managementRoutes);
app.use(companyContextRoutes);

// page routes
app.get("/", requireAuth, (req, res) => {
  res.redirect("/dashboard");
});


app.get(
  "/dashboard",
  requireAuth,
  requirePermission("PAGE_DASHBOARD"),
  async (req, res) => {
    const user = req.session?.user;

    let canSeeRates = false;
    try {
      if (Number(user?.is_admin) === 1) {
        canSeeRates = true;
      } else {
        canSeeRates = await hasPermission(Number(user?.id), "WORK_ENTRY_EDIT_RATES");
      }
    } catch (err) {
      console.error("canSeeRates check failed:", err);
    }

    res.render("dashboard", {
      title: "Dashboard",
      user,
      isAdmin: Number(user?.is_admin) === 1,
      canSeeRates
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

app.get("/reports", requireAuth, requirePermission("PAGE_Reports"), async (req, res) => {
  const user = req.session?.user;
  const userId = Number(user?.id);

  const canFilterPayType =
    Number(user?.is_admin) === 1
      ? true
      : await hasPermission(userId, "REPORT_FILTER_PAYTYPE");

  res.render("reports", {
    title: "Reports",
    canFilterPayType, // ✅ now defined in reports.ejs
  });
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

// API routes
app.use("/api/users", userRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/workers", workerRoutes);
app.use("/api/work-entries", workEntryRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api", rulesRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/wage-tiers", wageTierRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
