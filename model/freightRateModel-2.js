import mongoose from 'mongoose';

const freightRateSchema = new mongoose.Schema({
  vehicle: {
    type: String,
    required: true,
    index: true
  },
  vehicleLength: {
    type: Number,
    required: true
  },
  weight: {
    type: Number,
    required: true,
    index: true
  },
  // Dynamic distance-based pricing
  distancePricing: {
    type: Map,
    of: Number,
    default: new Map()
  },
  // Store the original CSV row for reference
  originalData: {
    type: Object,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient weight and distance queries
freightRateSchema.index({ weight: 1, vehicle: 1 });

// Method to find nearest weight match
freightRateSchema.statics.findNearestWeight = function(targetWeight) {
  return this.aggregate([
    {
      $addFields: {
        weightDifference: { $abs: { $subtract: ["$weight", targetWeight] } }
      }
    },
    {
      $sort: { weightDifference: 1 }
    },
    {
      $limit: 1
    }
  ]);
};

// Method to get available distances
freightRateSchema.statics.getAvailableDistances = function() {
  return this.aggregate([
    {
      $project: {
        distances: { $objectToArray: "$distancePricing" }
      }
    },
    {
      $unwind: "$distances"
    },
    {
      $group: {
        _id: null,
        uniqueDistances: { $addToSet: "$distances.k" }
      }
    }
  ]);
};

const FreightRate = mongoose.model('FreightRate', freightRateSchema);

export default FreightRate;
