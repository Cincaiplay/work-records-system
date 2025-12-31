import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Admin sets active company in SESSION
router.post("/context/company", requireAuth, (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ ok: false });

  // only super admin can switch
  if (Number(user.is_admin) !== 1) {
    req.session.activeCompanyId = user.company_id;
    return res.status(403).json({ ok: false, error: "Not admin" });
  }

  const companyId = Number(req.body.company_id);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid company_id" });
  }

  req.session.activeCompanyId = companyId;
  return res.json({ ok: true, activeCompanyId: companyId });
});

export default router;
