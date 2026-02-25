import FormConfig, { DEFAULT_ADD_VENDOR_FIELDS } from "../model/formConfigModel.js";

/**
 * Merge existing config with default fields
 * Adds any missing default fields while preserving existing customizations
 */
const mergeWithDefaults = async (config, defaults) => {
    const existingFieldIds = new Set(config.fields.map(f => f.fieldId));
    const missingFields = defaults.filter(d => !existingFieldIds.has(d.fieldId));

    if (missingFields.length > 0) {
        // Add missing fields
        config.fields.push(...missingFields);

        // Save to database
        await FormConfig.updateOne(
            { pageId: config.pageId },
            {
                $push: { fields: { $each: missingFields } },
                $set: { lastModifiedAt: new Date() }
            }
        );

        console.log(`[FormConfig] Auto-merged ${missingFields.length} new default fields into ${config.pageId}:`,
            missingFields.map(f => f.fieldId).join(', '));
    }

    return config;
};

/**
 * Get form configuration for a page
 * Auto-seeds default config if not found
 * Auto-merges missing default fields if config exists
 */
export const getFormConfig = async (req, res) => {
    try {
        const { pageId } = req.params;

        if (!pageId) {
            return res.status(400).json({ success: false, message: "pageId is required" });
        }

        let config = await FormConfig.findOne({ pageId }).lean();

        // Auto-seed Add Vendor config if not exists
        if (!config && pageId === "add-vendor") {
            config = await FormConfig.create({
                pageId: "add-vendor",
                pageName: "Add Vendor",
                description: "Vendor registration form",
                fields: DEFAULT_ADD_VENDOR_FIELDS,
                changeHistory: [],
            });
            console.log("[FormConfig] Seeded default config for add-vendor");
        }

        if (!config) {
            return res.status(404).json({ success: false, message: "Form config not found" });
        }

        // Auto-merge missing default fields (schema evolution)
        if (pageId === "add-vendor") {
            config = await mergeWithDefaults(config, DEFAULT_ADD_VENDOR_FIELDS);
        }

        // Filter out deleted fields for client
        const visibleFields = config.fields
            .filter((f) => f.visible !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        return res.status(200).json({
            success: true,
            data: {
                pageId: config.pageId,
                pageName: config.pageName,
                description: config.description,
                fields: visibleFields,
                lastModifiedAt: config.lastModifiedAt,
            },
        });
    } catch (error) {
        console.error("[FormConfig] getFormConfig error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * Get full form configuration including hidden fields and change history (admin only)
 */
export const getFullFormConfig = async (req, res) => {
    try {
        const { pageId } = req.params;

        if (!pageId) {
            return res.status(400).json({ success: false, message: "pageId is required" });
        }

        let config = await FormConfig.findOne({ pageId }).lean();

        // Auto-seed if not exists
        if (!config && pageId === "add-vendor") {
            config = await FormConfig.create({
                pageId: "add-vendor",
                pageName: "Add Vendor",
                description: "Vendor registration form",
                fields: DEFAULT_ADD_VENDOR_FIELDS,
                changeHistory: [],
            });
        }

        if (!config) {
            return res.status(404).json({ success: false, message: "Form config not found" });
        }

        // Auto-merge missing default fields (schema evolution)
        if (pageId === "add-vendor") {
            config = await mergeWithDefaults(config, DEFAULT_ADD_VENDOR_FIELDS);
        }

        // Return all fields sorted by order
        const sortedFields = [...config.fields].sort((a, b) => (a.order || 0) - (b.order || 0));

        return res.status(200).json({
            success: true,
            data: {
                ...config,
                fields: sortedFields,
            },
        });
    } catch (error) {
        console.error("[FormConfig] getFullFormConfig error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * Update a specific field in a form config
 */
export const updateField = async (req, res) => {
    try {
        const { pageId, fieldId } = req.params;
        const updates = req.body;
        const userId = req.user?.customer?._id || req.user?._id;
        const userName = req.user?.customer?.firstName
            ? `${req.user.customer.firstName} ${req.user.customer.lastName || ""}`.trim()
            : "Unknown";

        if (!pageId || !fieldId) {
            return res.status(400).json({ success: false, message: "pageId and fieldId are required" });
        }

        const config = await FormConfig.findOne({ pageId });
        if (!config) {
            return res.status(404).json({ success: false, message: "Form config not found" });
        }

        const fieldIndex = config.fields.findIndex((f) => f.fieldId === fieldId);
        if (fieldIndex === -1) {
            return res.status(404).json({ success: false, message: "Field not found" });
        }

        // Capture before state
        const beforeState = JSON.parse(JSON.stringify(config.fields[fieldIndex]));

        // Apply updates (merge with existing)
        const field = config.fields[fieldIndex];

        // Update simple fields
        if (updates.label !== undefined) field.label = updates.label;
        if (updates.placeholder !== undefined) field.placeholder = updates.placeholder;
        if (updates.type !== undefined) field.type = updates.type;
        if (updates.required !== undefined) field.required = updates.required;
        if (updates.visible !== undefined) field.visible = updates.visible;
        if (updates.gridSpan !== undefined) field.gridSpan = updates.gridSpan;
        if (updates.order !== undefined) field.order = updates.order;
        if (updates.inputMode !== undefined) field.inputMode = updates.inputMode;
        if (updates.autoCapitalize !== undefined) field.autoCapitalize = updates.autoCapitalize;
        if (updates.options !== undefined) field.options = updates.options;

        // Update constraints (merge)
        if (updates.constraints) {
            field.constraints = {
                ...field.constraints,
                ...updates.constraints,
            };
        }

        // Log change
        config.changeHistory.push({
            timestamp: new Date(),
            userId,
            userName,
            action: "edit",
            fieldId,
            before: beforeState,
            after: JSON.parse(JSON.stringify(field)),
        });

        config.lastModifiedBy = userId;
        config.lastModifiedAt = new Date();

        await config.save();

        console.log(`[FormConfig] Field "${fieldId}" updated by ${userName}`);

        return res.status(200).json({
            success: true,
            message: "Field updated successfully",
            data: field,
        });
    } catch (error) {
        console.error("[FormConfig] updateField error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * Delete (soft) a field from form config
 */
export const deleteField = async (req, res) => {
    try {
        const { pageId, fieldId } = req.params;
        const userId = req.user?.customer?._id || req.user?._id;
        const userName = req.user?.customer?.firstName
            ? `${req.user.customer.firstName} ${req.user.customer.lastName || ""}`.trim()
            : "Unknown";

        if (!pageId || !fieldId) {
            return res.status(400).json({ success: false, message: "pageId and fieldId are required" });
        }

        const config = await FormConfig.findOne({ pageId });
        if (!config) {
            return res.status(404).json({ success: false, message: "Form config not found" });
        }

        const fieldIndex = config.fields.findIndex((f) => f.fieldId === fieldId);
        if (fieldIndex === -1) {
            return res.status(404).json({ success: false, message: "Field not found" });
        }

        // Capture before state
        const beforeState = JSON.parse(JSON.stringify(config.fields[fieldIndex]));

        // Soft delete
        config.fields[fieldIndex].visible = false;

        // Log change
        config.changeHistory.push({
            timestamp: new Date(),
            userId,
            userName,
            action: "delete",
            fieldId,
            before: beforeState,
            after: { visible: false },
        });

        config.lastModifiedBy = userId;
        config.lastModifiedAt = new Date();

        await config.save();

        console.log(`[FormConfig] Field "${fieldId}" deleted by ${userName}`);

        return res.status(200).json({
            success: true,
            message: "Field deleted successfully",
        });
    } catch (error) {
        console.error("[FormConfig] deleteField error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * Restore a deleted field
 */
export const restoreField = async (req, res) => {
    try {
        const { pageId, fieldId } = req.params;
        const userId = req.user?.customer?._id || req.user?._id;
        const userName = req.user?.customer?.firstName
            ? `${req.user.customer.firstName} ${req.user.customer.lastName || ""}`.trim()
            : "Unknown";

        if (!pageId || !fieldId) {
            return res.status(400).json({ success: false, message: "pageId and fieldId are required" });
        }

        const config = await FormConfig.findOne({ pageId });
        if (!config) {
            return res.status(404).json({ success: false, message: "Form config not found" });
        }

        const fieldIndex = config.fields.findIndex((f) => f.fieldId === fieldId);
        if (fieldIndex === -1) {
            return res.status(404).json({ success: false, message: "Field not found" });
        }

        // Restore field
        config.fields[fieldIndex].visible = true;

        // Log change
        config.changeHistory.push({
            timestamp: new Date(),
            userId,
            userName,
            action: "restore",
            fieldId,
            before: { visible: false },
            after: { visible: true },
        });

        config.lastModifiedBy = userId;
        config.lastModifiedAt = new Date();

        await config.save();

        console.log(`[FormConfig] Field "${fieldId}" restored by ${userName}`);

        return res.status(200).json({
            success: true,
            message: "Field restored successfully",
        });
    } catch (error) {
        console.error("[FormConfig] restoreField error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * Get change history for a form config
 */
export const getChangeHistory = async (req, res) => {
    try {
        const { pageId } = req.params;
        const limit = parseInt(req.query.limit) || 50;

        if (!pageId) {
            return res.status(400).json({ success: false, message: "pageId is required" });
        }

        const config = await FormConfig.findOne({ pageId }).select("changeHistory").lean();
        if (!config) {
            return res.status(404).json({ success: false, message: "Form config not found" });
        }

        // Return most recent changes first
        const history = (config.changeHistory || [])
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);

        return res.status(200).json({
            success: true,
            data: history,
        });
    } catch (error) {
        console.error("[FormConfig] getChangeHistory error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
