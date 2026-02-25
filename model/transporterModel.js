import mongoose from "mongoose";

const transporterSchema = new mongoose.Schema({
    companyName: { //done
        type: String,
        required: true,
        unique: true
    },
    phone: { //done
        type: Number,
        required: true
    },
    email: { //done
        type: String,
        required: true
    },
    password: { //done
        type: String,
        required: true
    },
    gstNo: { //done
        type: String,
        required: true
    },
    address: { //done
        type: String,
        required: true
    },
    state: { //done
        type: String,
        required: true
    },
    pincode: { //done
        type: Number,
        required: true
    },
    officeStart: { //done
        type: String,
        required: true
    },
    officeEnd: { //done
        type: String,
        required: true
    },
    deliveryMode: { //done
        type: String,
        default: ""
    },
    deliveryTat: {
        type: String,
        default: ""
    },
    trackingLink: {
        type: String,
        default: ""
    },
    websiteLink: {
        type: String,
        default: ""
    },
    experience: {
        type: Number,
        required: true,
        default: 0
    },

    maxLoading: {
        type: Number,
        default: 0
    },
    noOfTrucks: {
        type: Number,
        default: 0
    },
    annualTurnover: {
        type: Number,
        default: 0
    },
    customerNetwork: {
        type: String,
        default: ""
    },
    rating: {
        type: Number,
        default: 4,
        min: 0,
        max: 5
    },
    totalRatings: {
        type: Number,
        default: 0
    },
    vendorRatings: {
        priceSupport: { type: Number, default: 0, min: 0, max: 5 },
        deliveryTime: { type: Number, default: 0, min: 0, max: 5 },
        tracking: { type: Number, default: 0, min: 0, max: 5 },
        salesSupport: { type: Number, default: 0, min: 0, max: 5 },
        damageLoss: { type: Number, default: 0, min: 0, max: 5 }
    },
    servicableZones: [{
        type: String,
        required: true
    }],
    service: [{
        pincode: {
            type: Number,
            required: true
        },
        isOda: {
            type: Boolean,
            default: false
        },
        zone: {
            type: String,
            required: true
        }
    }],

    // APPROVAL: Whether vendor can appear in search results
    // Flow: pending → approved/rejected (by admin)
    approvalStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "approved",  // Existing transporters are pre-approved
    },
    // VERIFICATION: Manual trust indicator (separate from approval!)
    // Default is FALSE - admin must explicitly mark as verified
    // UI Logic: isVerified===true → green badge, else → yellow badge
    isVerified: {
        type: Boolean,
        default: false,
    },

    isAdmin: {
        type: Boolean,
        default: false,
        required: true
    },
    isTransporter: {
        type: Boolean,
        default: true,
        required: true
    }

}, { timestamps: true });

// Database indexes for query performance
// companyName index already created via `unique: true` in schema
transporterSchema.index({ isTransporter: 1 }); // Filter by transporter type

export default mongoose.model("transporters", transporterSchema);