import { FreightRateService } from '../utils/freightRateService.js';
import FreightRate from '../model/freightRateModel.js';

export const freightRateController = {
  
  /**
   * Calculate freight rate for a single shipment
   */
  calculateFreightRate: async (req, res) => {
    try {
      const { weight, distance } = req.body;
      
      // Validate input
      if (!weight || !distance) {
        return res.status(400).json({
          success: false,
          message: 'Weight and distance are required'
        });
      }
      
      const weightNum = parseFloat(weight);
      const distanceNum = parseFloat(distance);
      
      if (isNaN(weightNum) || isNaN(distanceNum) || weightNum <= 0 || distanceNum <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Weight and distance must be positive numbers'
        });
      }
      
      const result = await FreightRateService.getVehicleAndPrice(weightNum, distanceNum);
      
      if (result.error) {
        return res.status(404).json({
          success: false,
          message: result.error,
          data: result
        });
      }
      
      res.json({
        success: true,
        message: 'Freight rate calculated successfully',
        data: result
      });
      
    } catch (error) {
      console.error('Error in calculateFreightRate:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },
  
  /**
   * Get available options (vehicles, weights, distances)
   */
  getAvailableOptions: async (req, res) => {
    try {
      const options = await FreightRateService.getAvailableOptions();
      
      if (options.error) {
        return res.status(500).json({
          success: false,
          message: options.error
        });
      }
      
      res.json({
        success: true,
        message: 'Available options retrieved successfully',
        data: options
      });
      
    } catch (error) {
      console.error('Error in getAvailableOptions:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },
  
  /**
   * Get pricing for a specific vehicle and weight
   */
  getVehiclePricing: async (req, res) => {
    try {
      const { vehicle, weight } = req.params;
      
      if (!vehicle || !weight) {
        return res.status(400).json({
          success: false,
          message: 'Vehicle and weight are required'
        });
      }
      
      const weightNum = parseFloat(weight);
      if (isNaN(weightNum) || weightNum <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Weight must be a positive number'
        });
      }
      
      const result = await FreightRateService.getVehiclePricing(vehicle, weightNum);
      
      if (result.error) {
        return res.status(404).json({
          success: false,
          message: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Vehicle pricing retrieved successfully',
        data: result
      });
      
    } catch (error) {
      console.error('Error in getVehiclePricing:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },
  
  /**
   * Calculate freight rates for multiple shipments
   */
  calculateMultipleShipments: async (req, res) => {
    try {
      const { shipments } = req.body;
      
      if (!Array.isArray(shipments) || shipments.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Shipments array is required and must not be empty'
        });
      }
      
      // Validate each shipment
      for (const shipment of shipments) {
        if (!shipment.weight || !shipment.distance) {
          return res.status(400).json({
            success: false,
            message: 'Each shipment must have weight and distance'
          });
        }
        
        const weightNum = parseFloat(shipment.weight);
        const distanceNum = parseFloat(shipment.distance);
        
        if (isNaN(weightNum) || isNaN(distanceNum) || weightNum <= 0 || distanceNum <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Weight and distance must be positive numbers'
          });
        }
      }
      
      const results = await FreightRateService.calculateMultipleShipments(shipments);
      
      if (results.error) {
        return res.status(500).json({
          success: false,
          message: results.error
        });
      }
      
      res.json({
        success: true,
        message: 'Multiple freight rates calculated successfully',
        data: results
      });
      
    } catch (error) {
      console.error('Error in calculateMultipleShipments:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },
  
  /**
   * Get freight rate statistics
   */
  getFreightRateStats: async (req, res) => {
    try {
      const totalRecords = await FreightRate.countDocuments();
      const vehicles = await FreightRate.distinct('vehicle');
      const weights = await FreightRate.distinct('weight');
      
      // Get distance range
      const distanceResult = await FreightRate.getAvailableDistances();
      const distances = distanceResult.length > 0 
        ? distanceResult[0].uniqueDistances.map(d => parseInt(d)).sort((a, b) => a - b)
        : [];
      
      const stats = {
        totalRecords,
        uniqueVehicles: vehicles.length,
        uniqueWeights: weights.length,
        distanceRange: distances.length > 0 ? {
          min: Math.min(...distances),
          max: Math.max(...distances)
        } : null,
        vehicles: vehicles,
        weightRange: weights.length > 0 ? {
          min: Math.min(...weights),
          max: Math.max(...weights)
        } : null
      };
      
      res.json({
        success: true,
        message: 'Freight rate statistics retrieved successfully',
        data: stats
      });
      
    } catch (error) {
      console.error('Error in getFreightRateStats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};

