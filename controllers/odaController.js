import odaConfigModel from "../model/odaConfigModel.js";
import temporaryTransporterModel from "../model/temporaryTransporterModel.js";
import {
  validateDistanceWeightMatrix,
  validateODAEntries,
} from "../utils/validators.js";

/**
 * Upload ODA configuration (distance-weight matrix and ODA entries)
 * POST /api/oda/upload
 */
export const uploadODA = async (req, res) => {
  try {
    const { vendorId, matrix, odaEntries, weightRanges, distanceRanges } =
      req.body;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Validate matrix structure
    if (matrix) {
      const matrixValidation = validateDistanceWeightMatrix(matrix);
      if (!matrixValidation.valid) {
        return res.status(400).json({
          success: false,
          message: "Invalid distance-weight matrix structure",
          errors: matrixValidation.errors,
        });
      }
    }

    // Validate ODA entries
    if (odaEntries && odaEntries.length > 0) {
      const odaValidation = validateODAEntries(odaEntries);
      if (!odaValidation.valid) {
        return res.status(400).json({
          success: false,
          message: "Invalid ODA entries",
          errors: odaValidation.errors,
        });
      }
    }

    // If vendorId provided, verify it belongs to the customer
    if (vendorId) {
      const vendor = await temporaryTransporterModel.findOne({
        _id: vendorId,
        customerID: customerID,
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor not found or access denied",
        });
      }
    }

    // Check if ODA config already exists for this vendor
    const existingConfig = vendorId
      ? await odaConfigModel.findOne({
          customerID,
          vendorId,
        })
      : await odaConfigModel.findOne({
          customerID,
          vendorId: null,
        });

    let odaConfig;

    if (existingConfig) {
      // Update existing config
      existingConfig.distanceWeightMatrix = matrix || existingConfig.distanceWeightMatrix;
      existingConfig.odaEntries = odaEntries || existingConfig.odaEntries;
      existingConfig.weightRanges = weightRanges || existingConfig.weightRanges;
      existingConfig.distanceRanges = distanceRanges || existingConfig.distanceRanges;
      
      odaConfig = await existingConfig.save();
    } else {
      // Create new config
      odaConfig = await odaConfigModel.create({
        customerID,
        vendorId: vendorId || null,
        distanceWeightMatrix: matrix || [],
        odaEntries: odaEntries || [],
        weightRanges: weightRanges || [],
        distanceRanges: distanceRanges || [],
      });
    }

    return res.status(201).json({
      success: true,
      message: "ODA configuration saved successfully",
      data: odaConfig,
    });
  } catch (error) {
    console.error("Error uploading ODA configuration:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while saving ODA configuration",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get ODA configuration for a vendor or customer
 * GET /api/oda/get (customer-level)
 * GET /api/oda/get/:vendorId (vendor-specific)
 */
export const getODA = async (req, res) => {
  try {
    const { vendorId } = req.params || {}; // Handle case when no vendorId in params
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    let odaConfig;

    if (vendorId) {
      // Get vendor-specific ODA config
      const vendor = await temporaryTransporterModel.findOne({
        _id: vendorId,
        customerID: customerID,
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor not found or access denied",
        });
      }

      odaConfig = await odaConfigModel.findOne({
        customerID,
        vendorId,
      });
    } else {
      // Get customer-level ODA config (no vendorId)
      odaConfig = await odaConfigModel.findOne({
        customerID,
        vendorId: null,
      });
    }

    if (!odaConfig) {
      return res.status(404).json({
        success: false,
        message: "ODA configuration not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "ODA configuration retrieved successfully",
      data: odaConfig,
    });
  } catch (error) {
    console.error("Error retrieving ODA configuration:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while retrieving ODA configuration",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get all ODA configurations for a customer
 * GET /api/oda/get-all
 */
export const getAllODA = async (req, res) => {
  try {
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const odaConfigs = await odaConfigModel.find({
      customerID,
    }).populate("vendorId", "companyName vendorCode");

    return res.status(200).json({
      success: true,
      message: "ODA configurations retrieved successfully",
      data: odaConfigs,
    });
  } catch (error) {
    console.error("Error retrieving ODA configurations:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while retrieving ODA configurations",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete ODA configuration
 * DELETE /api/oda/delete/:id
 */
export const deleteODA = async (req, res) => {
  try {
    const { id } = req.params;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const odaConfig = await odaConfigModel.findOne({
      _id: id,
      customerID,
    });

    if (!odaConfig) {
      return res.status(404).json({
        success: false,
        message: "ODA configuration not found or access denied",
      });
    }

    await odaConfig.deleteOne();

    return res.status(200).json({
      success: true,
      message: "ODA configuration deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting ODA configuration:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting ODA configuration",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

