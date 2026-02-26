import mongoose from 'mongoose';

const indiaPostPricingSchema = new mongoose.Schema({
  weightRange: {
    min: { type: Number, required: true },
    max: { type: Number, required: true }
  },
  pricing: [{
    distanceRange: {
      min: { type: Number, required: true },
      max: { type: Number, required: true }
    },
    price: { type: Number, required: true }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

indiaPostPricingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find pricing by weight and distance
indiaPostPricingSchema.statics.findPricing = async function(weight, distance) {
  try {
    // 1. Find the weight slab
    // We sort by max weight to get the smallest slab that can contain the weight
    const weightSlabs = await this.find({
      'weightRange.max': { $gte: weight }
    }).sort({ 'weightRange.max': 1 }); // Sort ascending by max weight

    if (!weightSlabs || weightSlabs.length === 0) {
      throw new Error(`No IndiaPost pricing found for weight ${weight}kg`);
    }

    // Usually the first one is the closest match
    // we also ensure weight >= min, but if they define slabs 0-2, 2.1-5, etc, it helps
    const slab = weightSlabs.find(s => s.weightRange.min <= weight && s.weightRange.max >= weight) || weightSlabs[0];

    // 2. Find the distance pricing
    const pricing = slab.pricing.find(p => 
      p.distanceRange.min <= distance && p.distanceRange.max >= distance
    );

    if (!pricing) {
        // Find the fallback max distance range if distance exceeds maximum defined bracket
        const maxDistancePricing = slab.pricing.reduce((prev, current) => 
            (prev && prev.distanceRange.max > current.distanceRange.max) ? prev : current
        , null);
        
        if (maxDistancePricing && distance > maxDistancePricing.distanceRange.max) {
             console.log(`IndiaPost: distance ${distance} exceeds max defined. Using max distance bracket.`);
             return {
                matchedWeight: weight,
                matchedDistance: maxDistancePricing.distanceRange.max,
                price: maxDistancePricing.price,
                isMaxDistanceFallback: true
             };
        }
        throw new Error(`No IndiaPost pricing found for distance ${distance}km in weight slab ${slab.weightRange.min}-${slab.weightRange.max}kg`);
    }

    return {
      matchedWeight: weight,
      matchedDistance: distance,
      price: pricing.price,
      slab: {
        weightRange: slab.weightRange,
        distanceRange: pricing.distanceRange
      }
    };
  } catch (error) {
    throw error;
  }
};

export default mongoose.model('IndiaPostPricing', indiaPostPricingSchema);
