import mongoose from 'mongoose';

// Subdocument: one box in the shipment
const boxSchema = new mongoose.Schema({
    count: { type: Number, default: 1, min: 1 },
    length: { type: Number, default: 0, min: 0 },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
    weight: { type: Number, default: 0, min: 0 },
    description: { type: String, default: '', trim: true }
}, { _id: false });

// Subdocument: one vendor quote snapshot
const topQuoteSchema = new mongoose.Schema({
    companyName: { type: String, required: true, trim: true },
    totalCharges: { type: Number, required: true },
    estimatedTime: { type: Number, default: 0 },
    chargeableWeight: { type: Number, default: 0 },
    isTiedUp: { type: Boolean, default: false }
}, { _id: false });

const searchHistorySchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'customers',
        required: true
    },
    fromPincode: { type: String, required: true, trim: true },
    fromCity: { type: String, default: '', trim: true },
    fromState: { type: String, default: '', trim: true },
    toPincode: { type: String, required: true, trim: true },   // effective pincode used (may be nearest serviceable)
    originalToPincode: { type: String, default: '', trim: true }, // what the user originally typed (if nearest was substituted)
    toCity: { type: String, default: '', trim: true },
    toState: { type: String, default: '', trim: true },
    modeOfTransport: {
        type: String,
        required: true,
        enum: ['Road', 'Rail', 'Air', 'Ship']
    },
    distanceKm: { type: Number, default: 0, min: 0 },
    boxes: { type: [boxSchema], default: [] },
    totalBoxes: { type: Number, default: 0, min: 0 },
    totalWeight: { type: Number, default: 0, min: 0 },
    invoiceValue: { type: Number, default: 0, min: 0 },
    // Up to 5 vendor quotes, sorted by price (cheapest first)
    topQuotes: {
        type: [topQuoteSchema],
        default: []
    },
    isBooked: { type: Boolean, default: false },
    bookedQuote: {
        companyName: { type: String },
        totalCharges: { type: Number },
        estimatedTime: { type: Number }
    }
}, { timestamps: true });

// TTL: MongoDB automatically removes documents older than 7 days
searchHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

// Compound index: fast lookup of a user's recent searches
searchHistorySchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('searchHistory', searchHistorySchema);
