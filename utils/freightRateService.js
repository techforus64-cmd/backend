import FreightRate from '../model/freightRateModel.js';

export class FreightRateService {
  
  /**
   * Get vehicle and price based on weight and distance
   * @param {number} weight - Shipment weight in Kg
   * @param {number} distance - Distance in Km
   * @returns {Object} Result with vehicle details and pricing
   */
  static async getVehicleAndPrice(weight, distance) {
    try {
      // Find nearest weight match
      const weightMatches = await FreightRate.findNearestWeight(weight);
      
      if (!weightMatches || weightMatches.length === 0) {
        return {
          error: "No freight rate data found for the given weight",
          inputWeight: weight,
          inputDistance: distance
        };
      }
      
      const nearestWeightRow = weightMatches[0];
      const vehicle = nearestWeightRow.vehicle;
      const vehicleLength = nearestWeightRow.vehicleLength;
      const matchedWeight = nearestWeightRow.weight;
      
      // Get available distances from the matched row
      const availableDistances = Object.keys(nearestWeightRow.distancePricing)
        .map(d => parseInt(d))
        .sort((a, b) => a - b);
      
      if (availableDistances.length === 0) {
        return {
          error: "No distance pricing found for the matched weight",
          vehicle,
          vehicleLength,
          inputWeight: weight,
          matchedWeight,
          inputDistance: distance
        };
      }
      
      // Find nearest distance
      const nearestDistance = availableDistances.reduce((prev, curr) => {
        return Math.abs(curr - distance) < Math.abs(prev - distance) ? curr : prev;
      });
      
      // Get price for the nearest distance
      const price = nearestWeightRow.distancePricing[nearestDistance.toString()];
      
      if (price === undefined) {
        return {
          error: `Price not found for distance ${nearestDistance} km`,
          vehicle,
          vehicleLength,
          inputWeight: weight,
          matchedWeight,
          inputDistance: distance,
          matchedDistance: nearestDistance
        };
      }
      
      return {
        vehicle,
        vehicleLength,
        inputWeight: weight,
        matchedWeight,
        inputDistance: distance,
        matchedDistance: nearestDistance,
        price: price,
        availableDistances: availableDistances
      };
      
    } catch (error) {
      console.error('Error in getVehicleAndPrice:', error);
      return {
        error: `Failed to calculate freight rate: ${error.message}`,
        inputWeight: weight,
        inputDistance: distance
      };
    }
  }
  
  /**
   * Get all available vehicles and weights
   * @returns {Object} Available vehicles and weights
   */
  static async getAvailableOptions() {
    try {
      const vehicles = await FreightRate.distinct('vehicle');
      const weights = await FreightRate.distinct('weight');
      const sortedWeights = weights.sort((a, b) => a - b);
      
      // Get all available distances
      const distanceResult = await FreightRate.getAvailableDistances();
      const distances = distanceResult.length > 0 
        ? distanceResult[0].uniqueDistances.map(d => parseInt(d)).sort((a, b) => a - b)
        : [];
      
      return {
        vehicles,
        weights: sortedWeights,
        distances
      };
    } catch (error) {
      console.error('Error getting available options:', error);
      return {
        error: `Failed to get available options: ${error.message}`
      };
    }
  }
  
  /**
   * Get pricing for a specific vehicle and weight across all distances
   * @param {string} vehicle - Vehicle type
   * @param {number} weight - Weight in Kg
   * @returns {Object} Pricing data for all distances
   */
  static async getVehiclePricing(vehicle, weight) {
    try {
      const freightRate = await FreightRate.findOne({
        vehicle: vehicle,
        weight: weight
      });
      
      if (!freightRate) {
        return {
          error: `No pricing found for vehicle: ${vehicle}, weight: ${weight}`
        };
      }
      
      const pricing = {};
      for (const [distance, price] of Object.entries(freightRate.distancePricing)) {
        pricing[distance] = price;
      }
      
      return {
        vehicle: freightRate.vehicle,
        vehicleLength: freightRate.vehicleLength,
        weight: freightRate.weight,
        pricing
      };
    } catch (error) {
      console.error('Error getting vehicle pricing:', error);
      return {
        error: `Failed to get vehicle pricing: ${error.message}`
      };
    }
  }
  
  /**
   * Calculate freight rate for multiple shipments
   * @param {Array} shipments - Array of shipment objects with weight and distance
   * @returns {Array} Array of calculated freight rates
   */
  static async calculateMultipleShipments(shipments) {
    try {
      const results = [];
      
      for (const shipment of shipments) {
        const { weight, distance } = shipment;
        const result = await this.getVehicleAndPrice(weight, distance);
        results.push({
          ...shipment,
          ...result
        });
      }
      
      return results;
    } catch (error) {
      console.error('Error calculating multiple shipments:', error);
      return {
        error: `Failed to calculate multiple shipments: ${error.message}`
      };
    }
  }
}
