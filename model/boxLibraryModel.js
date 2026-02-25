import mongoose from 'mongoose';

// Embedded subdocument schema for individual boxes within a library
const boxItemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    weight: {
        type: Number,
        required: true,
        min: 0
    },
    length: {
        type: Number,
        min: 0
    },
    width: {
        type: Number,
        min: 0
    },
    height: {
        type: Number,
        min: 0
    },
    quantity: {
        type: Number,
        default: 1,
        min: 1
    }
}, { _id: true }); // Enable _id for individual box items

// Main library schema
const boxLibrarySchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'customers',
        required: true,
        index: true // Index for fast lookups by customer
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    category: {
        type: String,
        default: 'general',
        enum: ['electronics', 'textiles', 'documents', 'perishables', 'machinery', 'fragile', 'general', 'custom']
    },
    boxes: {
        type: [boxItemSchema],
        default: []
    }
}, { timestamps: true });

// Compound index for efficient queries: find all libraries for a customer, sorted by creation
boxLibrarySchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('boxLibrary', boxLibrarySchema);
