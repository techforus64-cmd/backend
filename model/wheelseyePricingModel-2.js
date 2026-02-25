import mongoose from 'mongoose';

const wheelseyePricingSchema = new mongoose.Schema({
  vehicleType: {
    type: String,
    required: true,
                   enum: [
        'Tata Ace',
        'Pickup', 
        '10 ft Truck',
        'Eicher 14 ft',
        'Eicher 19 ft',
        'Eicher 20 ft',
        'Container 32 ft MXL'
      ]
  },
  weightRange: {
    min: { type: Number, required: true },
    max: { type: Number, required: true }
  },
  distanceRange: {
    min: { type: Number, required: true },
    max: { type: Number, required: true }
  },
  vehicleLength: {
    type: Number,
    required: true
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

// Update the updatedAt field before saving
wheelseyePricingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find pricing by weight and distance
wheelseyePricingSchema.statics.findPricing = async function(weight, distance) {
  try {
    // For weights over 18,000kg, use 2-vehicle formula
    if (weight > 18000) {
      console.log(`📦 Weight ${weight}kg exceeds 18000kg, using 2-vehicle formula`);
      
      // First vehicle: Container 32 ft MXL (18000kg capacity)
      const containerVehicle = await this.findOne({
        vehicleType: 'Container 32 ft MXL'
      });

      if (!containerVehicle) {
        throw new Error('Container 32 ft MXL vehicle not found in database');
      }

      // Find Container 32 ft MXL pricing for distance
      const containerPricing = containerVehicle.pricing.find(p => 
        p.distanceRange.min <= distance && p.distanceRange.max >= distance
      );

      if (!containerPricing) {
        throw new Error(`No Container 32 ft MXL pricing found for distance ${distance}km`);
      }

      // Calculate remaining weight for second vehicle
      const remainingWeight = weight - 18000;
      console.log(`🚛 Container 32 ft MXL: 18000kg, Remaining: ${remainingWeight}kg`);

      // Find second vehicle based on remaining weight AND distance constraints
      let secondVehicle;
      let vehicleFound = false;
      
      // Try to find a vehicle that can handle both weight and distance
      const vehicleOptions = [
        { type: 'Tata Ace', maxWeight: 1000, maxDistance: 1000 },
        { type: 'Pickup', maxWeight: 1500, maxDistance: 1000 },
        { type: '10 ft Truck', maxWeight: 2000, maxDistance: 1000 },
        { type: 'Eicher 14 ft', maxWeight: 4000, maxDistance: 2700 },
        { type: 'Eicher 19 ft', maxWeight: 7000, maxDistance: 2700 },
        { type: 'Eicher 20 ft', maxWeight: 10000, maxDistance: 2700 },
        { type: 'Container 32 ft MXL', maxWeight: 18000, maxDistance: 2700 }
      ];
      
      for (const option of vehicleOptions) {
        if (remainingWeight <= option.maxWeight && distance <= option.maxDistance) {
          secondVehicle = await this.findOne({
            vehicleType: option.type
          });
          console.log(`🚛 Second vehicle: ${option.type} for ${remainingWeight}kg at ${distance}km`);
          vehicleFound = true;
          break;
        }
      }
      
      // If no vehicle found that can handle both weight and distance, use Container 32 ft MXL
      if (!vehicleFound) {
        secondVehicle = containerVehicle;
        console.log(`🚛 Second vehicle: Container 32 ft MXL (fallback) for ${remainingWeight}kg at ${distance}km`);
      }

      if (!secondVehicle) {
        throw new Error('Second vehicle not found in database');
      }

      // Find second vehicle pricing for distance
      const secondPricing = secondVehicle.pricing.find(p => 
        p.distanceRange.min <= distance && p.distanceRange.max >= distance
      );

      if (!secondPricing) {
        throw new Error(`No second vehicle pricing found for distance ${distance}km`);
      }

      // Calculate total price based on remaining weight
      let totalPrice;
      let actualSecondVehicleWeight = remainingWeight;
      
      if (remainingWeight > 18000) {
        // For remaining weight over 18000kg, calculate multiple Container 32 ft MXL vehicles
        const additionalVehicles = Math.ceil(remainingWeight / 18000);
        totalPrice = containerPricing.price + (secondPricing.price * additionalVehicles);
        actualSecondVehicleWeight = remainingWeight; // Keep the actual remaining weight
        console.log(`💰 Multi-vehicle pricing: Container ₹${containerPricing.price} + ${additionalVehicles}×${secondVehicle.vehicleType} ₹${secondPricing.price} = ₹${totalPrice}`);
      } else {
        // Normal 2-vehicle pricing
        totalPrice = containerPricing.price + secondPricing.price;
        console.log(`💰 2-vehicle pricing: Container ₹${containerPricing.price} + ${secondVehicle.vehicleType} ₹${secondPricing.price} = ₹${totalPrice}`);
      }

      return {
        vehicle: `${containerVehicle.vehicleType} + ${secondVehicle.vehicleType}`,
        vehicleLength: `${containerVehicle.vehicleLength} + ${secondVehicle.vehicleLength}`,
        matchedWeight: weight,
        matchedDistance: Math.max(containerPricing.distanceRange.max, secondPricing.distanceRange.max),
        price: totalPrice,
        loadSplit: {
          vehiclesNeeded: remainingWeight > 18000 ? Math.ceil(remainingWeight / 18000) + 1 : 2,
          firstVehicle: {
            vehicle: containerVehicle.vehicleType,
            weight: 18000,
            price: containerPricing.price,
            vehicleLength: containerVehicle.vehicleLength
          },
          secondVehicle: {
            vehicle: secondVehicle.vehicleType,
            weight: actualSecondVehicleWeight,
            price: remainingWeight > 18000 ? secondPricing.price * Math.ceil(remainingWeight / 18000) : secondPricing.price,
            vehicleLength: secondVehicle.vehicleLength
          },
          totalPrice: totalPrice
        }
      };
    }

    // For weights 18,000kg and below, use single vehicle
    console.log(`📦 Weight ${weight}kg within single vehicle capacity`);

    // Find the appropriate vehicle based on weight range
    const vehicle = await this.findOne({
      'weightRange.min': { $lte: weight },
      'weightRange.max': { $gte: weight }
    });

    if (!vehicle) {
      throw new Error(`No vehicle found for weight ${weight}kg`);
    }

    // Find the appropriate pricing based on distance
    const pricing = vehicle.pricing.find(p => 
      p.distanceRange.min <= distance && p.distanceRange.max >= distance
    );

    if (!pricing) {
      throw new Error(`No pricing found for distance ${distance}km`);
    }

    return {
      vehicle: vehicle.vehicleType,
      vehicleLength: vehicle.vehicleLength,
      matchedWeight: weight,
      matchedDistance: pricing.distanceRange.max,
      price: pricing.price
    };
  } catch (error) {
    throw error;
  }
};

// Static method to get all vehicle types
wheelseyePricingSchema.statics.getAllVehicles = async function() {
  try {
    return await this.find({}, { vehicleType: 1, weightRange: 1, distanceRange: 1, vehicleLength: 1 });
  } catch (error) {
    throw error;
  }
};

export default mongoose.model('WheelseyePricing', wheelseyePricingSchema);
