import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { hasFormBuilderPermission } from "../middleware/isAdminMiddleware.js";
import {
    getFormConfig,
    getFullFormConfig,
    updateField,
    deleteField,
    restoreField,
    getChangeHistory,
} from "../controllers/formConfigController.js";

const router = express.Router();

// Public route - Get form config (for Add Vendor page)
// Returns only visible fields
router.get("/:pageId", getFormConfig);

// Admin routes - require authentication + form builder permission
// Super admin always has access, regular admins need formBuilder permission
router.get("/:pageId/full", protect, hasFormBuilderPermission, getFullFormConfig);
router.get("/:pageId/history", protect, hasFormBuilderPermission, getChangeHistory);
router.put("/:pageId/field/:fieldId", protect, hasFormBuilderPermission, updateField);
router.delete("/:pageId/field/:fieldId", protect, hasFormBuilderPermission, deleteField);
router.post("/:pageId/field/:fieldId/restore", protect, hasFormBuilderPermission, restoreField);

export default router;

