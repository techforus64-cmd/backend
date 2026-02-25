import mongoose from "mongoose";

const biddingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
  },
  weightOfBox: {
    type: Number,
    required: true,
  },
  noofboxes: {
    type: Number,
    required: true,
  },
  length: {
    type: Number,
    required: true,
  },
  width: {
    type: Number,
    required: true,
  },
  height: {
    type: Number,
    required: true,
  },
  origin: {
    type: Number,
    required: true,
  },
  destination: {
    type: Number,
    required: true,
  },
  bidAmount: {
    type: Number,
    required: true,
  },
  bidEndTime: {
    type: Date,
    required: true,
  },
  pickupDate: {
    type: Date,
    required: true,
  },
  pickupTime: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected"],
    default: "pending",
  },
  bidders: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transporter",
    },
  ],
  bids: [
    {
      transporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transporter",
        required: true
      },
      amount: {
        type: Number,
        required: true
      },
      bidTime: {
        type: Date,
        default: Date.now
      }
    }
  ],
  bidType: {
    type: String,
    enum: ["limited", "semi-limited", "open"],
    required: true,
  },
  transporterIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transporter'
  }],
  transporterRating: {
    type: Number
  }
}, {
  timestamps: true});

const Bidding = mongoose.model("Bidding", biddingSchema);

export default Bidding;
