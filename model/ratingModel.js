import mongoose from "mongoose";

const ratingSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'transporters',
        required: true
    },
    sum: {
        type: Number,
        default: 0
    },
    noofreviews: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 1
    }

}, {timestamps: true});

export default mongoose.model("ratings", ratingSchema);