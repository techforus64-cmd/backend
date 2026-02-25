import mongoose from 'mongoose';
import SearchHistory from '../model/searchHistoryModel.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOP_QUOTES = 5;
const PAGE_LIMIT_MAX = 50; // hard ceiling per page

/**
 * POST /api/search-history
 * Save a freight calculation result to the user's history.
 * Called fire-and-forget from the frontend after every successful calculation.
 */
export const saveHistory = async (req, res) => {
    try {
        const customerId = req.customer._id;
        const {
            fromPincode, fromCity, fromState,
            toPincode, originalToPincode, toCity, toState,
            modeOfTransport, distanceKm,
            boxes, totalBoxes, totalWeight,
            invoiceValue, topQuotes
        } = req.body;

        if (!fromPincode || !toPincode || !modeOfTransport) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: fromPincode, toPincode, modeOfTransport'
            });
        }

        // Normalize and cap top quotes to 5, cheapest first
        const sanitizedQuotes = Array.isArray(topQuotes)
            ? topQuotes
                .filter(q => q && typeof q.companyName === 'string' && Number.isFinite(q.totalCharges))
                .sort((a, b) => a.totalCharges - b.totalCharges)
                .slice(0, MAX_TOP_QUOTES)
                .map(q => ({
                    companyName: String(q.companyName).trim(),
                    totalCharges: Number(q.totalCharges),
                    estimatedTime: Number(q.estimatedTime) || 0,
                    chargeableWeight: Number(q.chargeableWeight) || 0,
                    isTiedUp: Boolean(q.isTiedUp)
                }))
            : [];

        const entry = await SearchHistory.create({
            customerId,
            fromPincode: String(fromPincode).trim(),
            fromCity: String(fromCity || '').trim(),
            fromState: String(fromState || '').trim(),
            toPincode: String(toPincode).trim(),
            originalToPincode: originalToPincode ? String(originalToPincode).trim() : '',
            toCity: String(toCity || '').trim(),
            toState: String(toState || '').trim(),
            modeOfTransport,
            distanceKm: Math.max(0, Number(distanceKm) || 0),
            boxes: Array.isArray(boxes) ? boxes.slice(0, 100) : [],
            totalBoxes: Math.max(0, Number(totalBoxes) || 0),
            totalWeight: Math.max(0, Number(totalWeight) || 0),
            invoiceValue: Math.max(0, Number(invoiceValue) || 0),
            topQuotes: sanitizedQuotes,
        });

        return res.status(201).json({ success: true, data: entry });
    } catch (err) {
        console.error('[SearchHistory] saveHistory error:', err);
        return res.status(500).json({ success: false, message: 'Failed to save search history' });
    }
};

/**
 * GET /api/search-history?page=1&limit=15
 * Return the authenticated user's search history from the last 7 days, paginated.
 * Defaults: page=1, limit=15. Max limit=50.
 */
export const getHistory = async (req, res) => {
    try {
        const customerId = req.customer._id;
        const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

        const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
        const limit = Math.min(PAGE_LIMIT_MAX, Math.max(1, parseInt(req.query.limit, 10) || 15));
        const skip  = (page - 1) * limit;

        const query = { customerId, createdAt: { $gte: sevenDaysAgo } };

        // Run fetch + count in parallel — single round-trip to MongoDB
        const [entries, total] = await Promise.all([
            SearchHistory.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            SearchHistory.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            data: entries,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('[SearchHistory] getHistory error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch search history' });
    }
};

/**
 * DELETE /api/search-history/clear
 * Remove all history entries for the authenticated user.
 */
export const clearHistory = async (req, res) => {
    try {
        const customerId = req.customer._id;
        await SearchHistory.deleteMany({ customerId });
        return res.status(200).json({ success: true, message: 'Search history cleared' });
    } catch (err) {
        console.error('[SearchHistory] clearHistory error:', err);
        return res.status(500).json({ success: false, message: 'Failed to clear search history' });
    }
};

/**
 * DELETE /api/search-history/:id
 * Remove a single history entry — only if it belongs to the authenticated user.
 */
export const deleteEntry = async (req, res) => {
    try {
        const customerId = req.customer._id;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid entry ID' });
        }

        const result = await SearchHistory.deleteOne({ _id: id, customerId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Entry not found or not authorized' });
        }

        return res.status(200).json({ success: true, message: 'Entry deleted' });
    } catch (err) {
        console.error('[SearchHistory] deleteEntry error:', err);
        return res.status(500).json({ success: false, message: 'Failed to delete entry' });
    }
};
