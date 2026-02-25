/**
 * Rating Controller
 *
 * Handles vendor rating submission and retrieval.
 * Updates vendor's aggregated ratings after each new rating.
 *
 * Supports three vendor types:
 * - 'regular': Normal transporters from Transporter collection
 * - 'temporary': Tied-up vendors from TemporaryTransporter collection
 * - 'special': Wheelseye FTL and LOCAL FTL (client-side injected, no DB document)
 */

import mongoose from "mongoose";
import VendorRating, { isSpecialVendorId, SPECIAL_VENDOR_IDS } from "../model/vendorRatingModel.js";
import TemporaryTransporter from "../model/temporaryTransporterModel.js";
import Transporter from "../model/transporterModel.js";

/**
 * Submit a new rating for a vendor
 *
 * POST /api/ratings/submit
 *
 * Body:
 * {
 *   vendorId: string (ObjectId or special vendor string ID),
 *   vendorType?: 'regular' | 'temporary' | 'special',
 *   isTemporaryVendor?: boolean (deprecated, use vendorType),
 *   ratings: {
 *     priceSupport: number (1-5),
 *     deliveryTime: number (1-5),
 *     tracking: number (1-5),
 *     salesSupport: number (1-5),
 *     damageLoss: number (1-5)
 *   },
 *   comment?: string,
 *   overallRating: number (1-5)
 * }
 */
export const submitRating = async (req, res) => {
  try {
    const { vendorId, vendorType, isTemporaryVendor, ratings, comment, overallRating } = req.body;

    // Validate required fields
    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: "Vendor ID is required",
      });
    }

    if (!ratings) {
      return res.status(400).json({
        success: false,
        message: "Ratings are required",
      });
    }

    // Validate all rating parameters are present and valid
    const requiredParams = ["priceSupport", "deliveryTime", "tracking", "salesSupport", "damageLoss"];
    for (const param of requiredParams) {
      const value = ratings[param];
      if (typeof value !== "number" || value < 1 || value > 5) {
        return res.status(400).json({
          success: false,
          message: `Invalid rating for ${param}. Must be a number between 1 and 5.`,
        });
      }
    }

    // Check if this is a special vendor (Wheelseye FTL or LOCAL FTL)
    const isSpecialVendor = isSpecialVendorId(vendorId);

    // Determine vendor type (new vendorType field takes precedence over deprecated isTemporaryVendor)
    let resolvedVendorType = "regular";
    if (vendorType) {
      // Use explicitly provided vendorType
      if (!["regular", "temporary", "special"].includes(vendorType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid vendorType. Must be 'regular', 'temporary', or 'special'.",
        });
      }
      resolvedVendorType = vendorType;
    } else if (isSpecialVendor) {
      // Auto-detect special vendors by their ID
      resolvedVendorType = "special";
    } else if (isTemporaryVendor) {
      // Fallback to deprecated isTemporaryVendor for backward compatibility
      resolvedVendorType = "temporary";
    }

    // Validate vendorId format based on vendor type
    // Special vendors use string IDs, regular/temporary use ObjectIds
    if (!isSpecialVendor && !mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID format",
      });
    }

    // DEBUG: Check which collection actually has this vendor
    if (!isSpecialVendor) {
      const [tempExists, regularExists] = await Promise.all([
        TemporaryTransporter.exists({ _id: vendorId }),
        Transporter.exists({ _id: vendorId })
      ]);
      console.log(`[Rating DEBUG] vendorId=${vendorId}, resolvedVendorType=${resolvedVendorType}, existsInTemp=${!!tempExists}, existsInRegular=${!!regularExists}`);

      // Auto-correct vendorType if it's wrong
      if (resolvedVendorType === "temporary" && !tempExists && regularExists) {
        console.log(`[Rating DEBUG] CORRECTING vendorType from 'temporary' to 'regular' because vendor exists in transporters collection`);
        resolvedVendorType = "regular";
      } else if (resolvedVendorType === "regular" && !regularExists && tempExists) {
        console.log(`[Rating DEBUG] CORRECTING vendorType from 'regular' to 'temporary' because vendor exists in temporaryTransporters collection`);
        resolvedVendorType = "temporary";
      }
    }

    // Calculate overall rating if not provided
    const calculatedOverall =
      overallRating ||
      (ratings.priceSupport +
        ratings.deliveryTime +
        ratings.tracking +
        ratings.salesSupport +
        ratings.damageLoss) /
      5;

    // Create new rating document
    // For special vendors, store the string ID directly
    // For regular/temporary, convert to ObjectId
    const newRating = new VendorRating({
      vendorId: isSpecialVendor ? vendorId : new mongoose.Types.ObjectId(vendorId),
      vendorType: resolvedVendorType,
      isTemporaryVendor: resolvedVendorType === "temporary" || resolvedVendorType === "special",
      ratings: {
        priceSupport: ratings.priceSupport,
        deliveryTime: ratings.deliveryTime,
        tracking: ratings.tracking,
        salesSupport: ratings.salesSupport,
        damageLoss: ratings.damageLoss,
      },
      overallRating: Math.round(calculatedOverall * 10) / 10,
      comment: comment || null,
      // TODO: Add userId when authentication is required
      // userId: req.user?._id || null,
    });

    await newRating.save();

    // Update vendor's aggregated ratings
    // For special vendors, this only calculates the new rating (no DB update)
    const newOverallRating = await updateVendorAggregatedRatings(
      vendorId,
      resolvedVendorType
    );

    console.log(
      `[Rating] New rating submitted for vendor ${vendorId} (type: ${resolvedVendorType}). New overall: ${newOverallRating}`
    );

    return res.status(201).json({
      success: true,
      message: "Rating submitted successfully",
      newOverallRating,
      ratingId: newRating._id,
    });
  } catch (error) {
    console.error("[Rating] Error submitting rating:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit rating. Please try again.",
      error: error.message,
    });
  }
};

/**
 * Get all ratings for a vendor (paginated)
 *
 * GET /api/ratings/vendor/:vendorId?vendorType=special&page=1&limit=10
 * Legacy: GET /api/ratings/vendor/:vendorId?isTemporary=true&page=1&limit=10
 */
export const getVendorRatings = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { vendorType, isTemporary = "false", page = "1", limit = "10" } = req.query;

    // Check if this is a special vendor
    const isSpecialVendor = isSpecialVendorId(vendorId);

    // Determine vendor type for query
    let resolvedVendorType = "regular";
    if (vendorType) {
      resolvedVendorType = vendorType;
    } else if (isSpecialVendor) {
      resolvedVendorType = "special";
    } else if (isTemporary === "true") {
      resolvedVendorType = "temporary";
    }

    // Validate vendorId format for non-special vendors
    if (!isSpecialVendor && !mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID format",
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Build query - use vendorType if available, fallback to isTemporaryVendor for backward compatibility
    const query = {
      vendorId: isSpecialVendor ? vendorId : new mongoose.Types.ObjectId(vendorId),
    };

    // Add vendorType or isTemporaryVendor to query
    if (resolvedVendorType === "special") {
      query.vendorType = "special";
    } else {
      // For backward compatibility, check both vendorType and isTemporaryVendor
      query.$or = [
        { vendorType: resolvedVendorType },
        { vendorType: { $exists: false }, isTemporaryVendor: resolvedVendorType === "temporary" }
      ];
    }

    const [ratings, total] = await Promise.all([
      VendorRating.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VendorRating.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      ratings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("[Rating] Error fetching ratings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch ratings",
      error: error.message,
    });
  }
};

/**
 * Get rating summary for a vendor (aggregated averages)
 *
 * GET /api/ratings/summary/:vendorId?vendorType=special
 * Legacy: GET /api/ratings/summary/:vendorId?isTemporary=true
 */
export const getVendorRatingSummary = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { vendorType, isTemporary = "false" } = req.query;

    // Check if this is a special vendor
    const isSpecialVendor = isSpecialVendorId(vendorId);

    // Determine vendor type for query
    let resolvedVendorType = "regular";
    if (vendorType) {
      resolvedVendorType = vendorType;
    } else if (isSpecialVendor) {
      resolvedVendorType = "special";
    } else if (isTemporary === "true") {
      resolvedVendorType = "temporary";
    }

    // Validate vendorId format for non-special vendors
    if (!isSpecialVendor && !mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID format",
      });
    }

    // Build match query
    const matchQuery = {
      vendorId: isSpecialVendor ? vendorId : new mongoose.Types.ObjectId(vendorId),
    };

    // Add vendorType or isTemporaryVendor to query
    if (resolvedVendorType === "special") {
      matchQuery.vendorType = "special";
    } else {
      // For backward compatibility, check both vendorType and isTemporaryVendor
      matchQuery.$or = [
        { vendorType: resolvedVendorType },
        { vendorType: { $exists: false }, isTemporaryVendor: resolvedVendorType === "temporary" }
      ];
    }

    const aggregation = await VendorRating.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalRatings: { $sum: 1 },
          avgOverall: { $avg: "$overallRating" },
          avgPriceSupport: { $avg: "$ratings.priceSupport" },
          avgDeliveryTime: { $avg: "$ratings.deliveryTime" },
          avgTracking: { $avg: "$ratings.tracking" },
          avgSalesSupport: { $avg: "$ratings.salesSupport" },
          avgDamageLoss: { $avg: "$ratings.damageLoss" },
        },
      },
    ]);

    if (!aggregation.length) {
      return res.status(200).json({
        success: true,
        summary: {
          totalRatings: 0,
          overallRating: 0,
          parameters: {
            priceSupport: { average: 0, count: 0 },
            deliveryTime: { average: 0, count: 0 },
            tracking: { average: 0, count: 0 },
            salesSupport: { average: 0, count: 0 },
            damageLoss: { average: 0, count: 0 },
          },
        },
      });
    }

    const data = aggregation[0];

    return res.status(200).json({
      success: true,
      summary: {
        totalRatings: data.totalRatings,
        overallRating: Math.round(data.avgOverall * 10) / 10,
        parameters: {
          priceSupport: {
            average: Math.round(data.avgPriceSupport * 10) / 10,
            count: data.totalRatings,
          },
          deliveryTime: {
            average: Math.round(data.avgDeliveryTime * 10) / 10,
            count: data.totalRatings,
          },
          tracking: {
            average: Math.round(data.avgTracking * 10) / 10,
            count: data.totalRatings,
          },
          salesSupport: {
            average: Math.round(data.avgSalesSupport * 10) / 10,
            count: data.totalRatings,
          },
          damageLoss: {
            average: Math.round(data.avgDamageLoss * 10) / 10,
            count: data.totalRatings,
          },
        },
      },
    });
  } catch (error) {
    console.error("[Rating] Error fetching rating summary:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch rating summary",
      error: error.message,
    });
  }
};

/**
 * Update vendor's aggregated ratings after a new rating is submitted
 *
 * Calculates new averages for each parameter and updates the vendor document.
 * For special vendors (Wheelseye FTL, LOCAL FTL), only calculates - no DB update.
 *
 * @param {string} vendorId - The vendor's ObjectId or special vendor string ID
 * @param {string} vendorType - The type of vendor: 'regular', 'temporary', or 'special'
 * @returns {number} The new overall rating
 */
async function updateVendorAggregatedRatings(vendorId, vendorType) {
  try {
    // Check if this is a special vendor
    const isSpecialVendor = vendorType === "special" || isSpecialVendorId(vendorId);

    // Build match query based on vendor type
    const matchQuery = {
      vendorId: isSpecialVendor ? vendorId : new mongoose.Types.ObjectId(vendorId),
    };

    // Add vendorType to query
    if (isSpecialVendor) {
      matchQuery.vendorType = "special";
    } else {
      // For backward compatibility with existing data
      matchQuery.$or = [
        { vendorType: vendorType },
        { vendorType: { $exists: false }, isTemporaryVendor: vendorType === "temporary" }
      ];
    }

    // Aggregate all ratings for this vendor
    const aggregation = await VendorRating.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalRatings: { $sum: 1 },
          avgOverall: { $avg: "$overallRating" },
          avgPriceSupport: { $avg: "$ratings.priceSupport" },
          avgDeliveryTime: { $avg: "$ratings.deliveryTime" },
          avgTracking: { $avg: "$ratings.tracking" },
          avgSalesSupport: { $avg: "$ratings.salesSupport" },
          avgDamageLoss: { $avg: "$ratings.damageLoss" },
        },
      },
    ]);

    if (!aggregation.length) {
      return 0;
    }

    const data = aggregation[0];
    const newOverallRating = Math.round(data.avgOverall * 10) / 10;

    // For special vendors, skip DB update (they don't exist in any collection)
    // Only return the calculated rating
    if (isSpecialVendor) {
      console.log(
        `[Rating] Special vendor ${vendorId} ratings calculated: overall=${newOverallRating}, total=${data.totalRatings}`
      );
      return newOverallRating;
    }

    // Update the appropriate vendor collection for regular/temporary vendors
    const updateData = {
      rating: newOverallRating,
      vendorRatings: {
        priceSupport: Math.round(data.avgPriceSupport * 10) / 10,
        deliveryTime: Math.round(data.avgDeliveryTime * 10) / 10,
        tracking: Math.round(data.avgTracking * 10) / 10,
        salesSupport: Math.round(data.avgSalesSupport * 10) / 10,
        damageLoss: Math.round(data.avgDamageLoss * 10) / 10,
      },
      totalRatings: data.totalRatings,
    };

    if (vendorType === "temporary") {
      await TemporaryTransporter.findByIdAndUpdate(vendorId, updateData);
    } else {
      // Update regular transporters with all rating data
      await Transporter.findByIdAndUpdate(vendorId, updateData);
    }

    console.log(
      `[Rating] Updated vendor ${vendorId} ratings: overall=${newOverallRating}, total=${data.totalRatings}`
    );

    return newOverallRating;
  } catch (error) {
    console.error("[Rating] Error updating vendor aggregated ratings:", error);
    throw error;
  }
}
