import mongoose from 'mongoose';

const packingSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'customers'
    },
    name: {
        type: String,
        required: true
    },
    modeoftransport: {
        type: String,
        required: true
    },
    originPincode: {
        type: Number,
        required: true
    },
    destinationPincode: {
        type: Number,
        required: true
    },
    noofboxes: {
        type: Number,
        required: true
    },
    length: {
        type: Number,
        required: true
    },
    width: {
        type: Number,
        required: true
    },
    height: {
        type: Number,
        required: true
    },
    weight: {
        type: Number,
        required: true
    }
}, {timestamps: true});

export default mongoose.model('packing', packingSchema);