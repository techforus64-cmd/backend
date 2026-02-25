import biddingModel from '../model/biddingModel.js';
import mongoose from 'mongoose';
import usertransporterrelationshipModel from '../model/usertransporterrelationshipModel.js';
import transporterModel from '../model/transporterModel.js';
import dotenv from 'dotenv';
import customerModel from '../model/customerModel.js';
import priceModel from '../model/priceModel.js';
import ratingModel from '../model/ratingModel.js';
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';

dotenv.config();

const calculate = async (
  customerID,
  modeoftransport,
  fromPincode,
  toPincode,
  noofboxes,
  length,
  width,
  height,
  weight
) => {
  // 1) basic validation
  if (
    !customerID ||
    !modeoftransport ||
    !fromPincode ||
    !toPincode ||
    !noofboxes ||
    !length ||
    !width ||
    !height ||
    !weight
  ) {
    throw new Error('Missing required parameters');
  }

  // 2) get distance & ETA
  const { estTime, distance } =
    await calculateDistanceBetweenPincode(fromPincode, toPincode);

  const actualWeight = weight * noofboxes;
  const quotes = [];

  // helper to compute one quote
  const buildQuote = (unitPrice, rateCfg, isOda) => {
    const volW =
      ((length * width * height) /
        (modeoftransport === 'Road' ? 4500 : 4750)) *
      rateCfg.divisor;
    const chargeable = Math.max(volW, actualWeight);
    const baseFreight = unitPrice * chargeable;

    // Enforce minimum charge as floor (not additive fee)
    const effectiveFreight = Math.max(baseFreight, rateCfg.minCharges || 0);

    const extras = [
      rateCfg.docketCharges,
      // rateCfg.minCharges removed - minimum is enforced as floor above
      rateCfg.greenTax,
      rateCfg.daccCharges,
      rateCfg.miscellanousCharges,
      (rateCfg.fuel / 100) * effectiveFreight,
      Math.max((rateCfg.rovCharges.variable / 100) * effectiveFreight, rateCfg.rovCharges.fixed),
      Math.max((rateCfg.insuaranceCharges.variable / 100) * effectiveFreight, rateCfg.insuaranceCharges.fixed),
      rateCfg.handlingCharges.fixed + chargeable * (rateCfg.handlingCharges.variable / 100),
      Math.max((rateCfg.fmCharges.variable / 100) * effectiveFreight, rateCfg.fmCharges.fixed),
      Math.max((rateCfg.appointmentCharges.variable / 100) * effectiveFreight, rateCfg.appointmentCharges.fixed),
      ...(isOda
        ? [
            rateCfg.odaCharges.fixed +
              chargeable * (rateCfg.odaCharges.variable / 100)
          ]
        : [])
    ];

    const totalCharges = extras.reduce((sum, x) => sum + x, effectiveFreight);
    return { chargeableWeight: chargeable, baseFreight: effectiveFreight, totalCharges };
  };

  // 3) tied‑up transporters
  const rels = await usertransporterrelationshipModel.find({ customerID });
  for (const r of rels) {
    const zoneMap = r.prices.priceChart[fromPincode];
    if (!zoneMap) continue;
    const t = await transporterModel.findById(r.transporterId);
    const svcTo = t?.service.find(e => e.pincode === Number(toPincode));
    if (!svcTo) continue;

    const unitPrice = zoneMap[svcTo.zone];
    if (!unitPrice) continue;

    const { chargeableWeight, baseFreight, totalCharges } =
      buildQuote(unitPrice, r.prices.priceRate, svcTo.isOda);

    quotes.push({
      companyId: t._id,
      companyName: t.companyName,
      originPincode: fromPincode,
      destinationPincode: toPincode,
      estimatedTime: estTime,
      distance,
      chargeableWeight,
      unitPrice,
      baseFreight,
      totalCharges,
      isHidden: false
    });
  }

  // 4) public transporters
  const customer = await customerModel.findById(customerID);
  // Filter out test/dummy transporters
  const allTrans = await transporterModel.find({
    companyName: {
      $not: {
        $regex: /test|tester|dummy|vellore/i
      }
    }
  });
  for (const t of allTrans) {
    const svcFrom = t.service.find(e => e.pincode === Number(fromPincode));
    const svcTo   = t.service.find(e => e.pincode === Number(toPincode));
    if (!svcFrom || !svcTo) continue;

    const priceDoc = await priceModel.findOne({ companyId: t._id });
    const unitPrice = priceDoc.zoneRates.get(svcFrom.zone)?.[svcTo.zone];
    if (!unitPrice) continue;

    const { chargeableWeight, baseFreight, totalCharges } =
      buildQuote(unitPrice, priceDoc.priceRate, svcTo.isOda);

    quotes.push({
      companyId: t._id,
      companyName: t.companyName,
      originPincode: fromPincode,
      destinationPincode: toPincode,
      estimatedTime: estTime,
      distance,
      chargeableWeight,
      unitPrice,
      baseFreight,
      totalCharges,
      isHidden: !customer?.isSubscribed
    });
  }

  if (quotes.length === 0) {
    throw new Error('No valid quotes found');
  }

  // 5) pick lowest
  const lowest = quotes.reduce((best, q) =>
    q.totalCharges < best.totalCharges ? q : best
  , quotes[0]);

  return { quotes, lowest };
};

export const createBidding = async (req, res) => {
  try {
    const {
      userId,
      weightOfBox,
      noofboxes,
      length,
      width,
      height,
      origin,        // 6‑digit pincode
      destination,   // 6‑digit pincode
      bidEndTime,
      pickupDate,
      pickupTime,
      bidType,
      transporterIds,
      transporterRating
    } = req.body;

    // 1) bidType must be valid
    const ALLOWED = ['limited', 'semi-limited', 'open'];
    if (!ALLOWED.includes(bidType)) {
      return res.status(400).json({
        message: `bidType must be one of ${ALLOWED.join(', ')}`
      });
    }

    // 2) origin & destination must be 6‑digit pincodes
    const pinRegex = /^\d{6}$/;
    if (!pinRegex.test(origin) || !pinRegex.test(destination)) {
      return res.status(400).json({
        message: 'origin and destination must each be a valid 6‑digit pincode'
      });
    }

    // 3) semi‑limited: require at least transporterRating or transporterIds
    let saveTransporterIds = [];
    let saveTransporterRating;

    if (bidType === 'limited') {
      const rels = await usertransporterrelationshipModel
        .find({ customerID: userId }, 'transporterId')
        .lean();
      saveTransporterIds = rels.map(r => r.transporterId);
    }
    else if (bidType === 'semi-limited') {
      const hasIds    = Array.isArray(transporterIds) && transporterIds.length > 0;
      const hasRating = typeof transporterRating === 'number';

      if (!hasRating && !hasIds) {
        return res.status(400).json({
          message: 'For semi-limited bids you must provide at least transporterRating or transporterIds'
        });
      }

      // validate any provided transporterIds
      if (hasIds) {
        const invalid = transporterIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalid.length) {
          return res.status(400).json({
            message: `Invalid transporterIds: ${invalid.join(', ')}`
          });
        }
        saveTransporterIds = transporterIds;
      }

      if (hasRating) {
        saveTransporterRating = transporterRating;
      }
    }

    // 4) pickupDate at least 2 days out
    const now       = new Date();
    const minPickup = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const requested = new Date(pickupDate);
    if (requested < minPickup) {
      return res.status(400).json({
        message: 'pickupDate must be at least 2 days from today',
        allowedFrom: minPickup.toISOString().split('T')[0]
      });
    }

    // 5) calculate charges
    const amount = await calculate(
      userId,
      'Road',
      origin,
      destination,
      noofboxes,
      length,
      width,
      height,
      weightOfBox
    );

    // 6) build & save the bidding
    const newBidding = new biddingModel({
      userId,
      weightOfBox,
      noofboxes,
      length,
      width,
      height,
      origin,
      destination,
      bidAmount:        amount.lowest.totalCharges,
      bidEndTime:       new Date(bidEndTime),
      pickupDate:       requested,
      pickupTime,
      bidType,
      transporterIds:   saveTransporterIds,
      transporterRating 
    });

    const saved = await newBidding.save();

    return res.status(201).json({
      success: true,
      message: 'Bidding created successfully',
      data: saved
    });

  } catch (error) {
    console.error('Error creating bidding:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
};

export const getAvailableBiddings = async (req, res) => {
  try {
    const { tid } = req.body

    // 1) Open bids (everyone sees these)
    const openBids = await biddingModel
      .find({ bidType: 'open' })
      .populate({
        path: 'userId',
        model: 'customers',
        select: 'firstName lastName companyName',
      })

    // 2) Limited bids (only if transporter is in transporterIds)
    const limitedBids = await biddingModel
      .find({
        bidType: 'limited',
        transporterIds: { $in: [tid] },
      })
      .populate({
        path: 'userId',
        model: 'customers',
        select: 'firstName lastName companyName',
      })

    // 3) Semi‑limited bids (same filter)
    const semiLimitedBids = await biddingModel
      .find({
        bidType: 'semi-limited',
        transporterIds: { $in: [tid] },
      })
      .populate({
        path: 'userId',
        model: 'customers',
        select: 'firstName lastName companyName',
      })

    return res.status(200).json({
      success: true,
      message: 'Available bids fetched successfully',
      data: { openBids, limitedBids, semiLimitedBids },
    })
  } catch (error) {
    console.error('Error fetching available bids:', error)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}


export const placeBid = async (req, res) => {
  try {
    const { biddingId } = req.params;
    const { transporterId, bidAmount } = req.body;

    // 1) validate IDs
    if (!mongoose.Types.ObjectId.isValid(biddingId)) {
      return res.status(400).json({ message: "Invalid biddingId" });
    }
    if (!mongoose.Types.ObjectId.isValid(transporterId)) {
      return res.status(400).json({ message: "Invalid transporterId" });
    }
    if (typeof bidAmount !== "number") {
      return res.status(400).json({ message: "You must provide a numeric bidAmount" });
    }

    // 2) fetch the bidding
    const bidDoc = await biddingModel.findById(biddingId);
    if (!bidDoc) {
      return res.status(404).json({ message: "Bidding not found" });
    }

    // 3) ensure bidding is still open
    if (new Date() > bidDoc.bidEndTime) {
      return res.status(400).json({ message: "Bidding has already closed" });
    }

    // 4) enforce that new bid is lower than current bidAmount
    if (bidAmount >= bidDoc.bidAmount) {
      return res.status(400).json({
        message: `Your bid (${bidAmount}) must be lower than the current bid amount (${bidDoc.bidAmount})`
      });
    }

    // 5) enforce maximum of 3 bids per transporter
    const existingCount = bidDoc.bids.filter(b => b.transporter.equals(transporterId)).length;
    if (existingCount >= 3) {
      return res.status(400).json({
        message: "You have already placed the maximum of 3 bids for this auction."
      });
    }

    // 6) record the transporter’s bid (avoid duplicate bidder entries)
    if (!bidDoc.bidders.some(id => id.equals(transporterId))) {
      bidDoc.bidders.push(transporterId);
    }
    bidDoc.bids.push({
      transporter: transporterId,
      amount:      bidAmount
    });

    // 7) update the current lowest bid
    bidDoc.bidAmount = bidAmount;

    await bidDoc.save();

    return res.status(200).json({
      success: true,
      message: "Bid placed successfully",
      data: bidDoc
    });
  } catch (error) {
    console.error("Error placing bid:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

export const getBiddingDetails = async (req, res) => {
  try {
    const { biddingId } = req.params
    console.log('Fetching details for biddingId:', biddingId)

    // 1) validate ID
    if (!mongoose.Types.ObjectId.isValid(biddingId)) {
      return res.status(400).json({ success: false, message: 'Invalid biddingId' })
    }

    // 2) fetch + populate
    const bidDoc = await biddingModel
      .findById(biddingId)
      .populate({
        path: 'userId',           // the field on biddingModel
        model: 'customers',       // your actual customer model name
        select: 'firstName lastName email companyName', 
      })
      .populate({
        path: 'bids.transporter',
        model: 'transporters',
        select: 'companyName rating',
      })
      .populate({
        path: 'bidders',
        model: 'transporters',
        select: 'companyName rating',
      })
      .lean()

    if (!bidDoc) {
      return res.status(404).json({ success: false, message: 'Bidding not found' })
    }

    return res.status(200).json({
      success: true,
      message: 'Bidding details fetched successfully',
      data: bidDoc,
    })
  } catch (error) {
    console.error('Error fetching bidding details:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    })
  }
}

export const getBiddingByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1) validate userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    // 2) fetch biddings for the user
    const biddings = await biddingModel.find({ userId: userId });

    if (biddings.length === 0) {
      return res.status(404).json({ message: "No biddings found for this user" });
    }

    return res.status(200).json({
      success: true,
      message: "Biddings fetched successfully",
      data: biddings
    });
  } catch (error) {
    console.error("Error fetching biddings by user:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};
