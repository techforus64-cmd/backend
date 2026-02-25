import WheelseyePricing from '../model/wheelseyePricingModel.js';

// Get Wheelseye pricing by weight and distance
const getWheelseyePricing = async (req, res) => {
  try {
    const { weight, distance } = req.query;

    if (!weight || !distance) {
      return res.status(400).json({
        success: false,
        message: 'Weight and distance are required parameters'
      });
    }

    const weightNum = parseFloat(weight);
    const distanceNum = parseFloat(distance);

    if (isNaN(weightNum) || isNaN(distanceNum)) {
      return res.status(400).json({
        success: false,
        message: 'Weight and distance must be valid numbers'
      });
    }

    if (weightNum <= 0 || distanceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Weight and distance must be greater than 0'
      });
    }

    const pricing = await WheelseyePricing.findPricing(weightNum, distanceNum);

    res.json({
      success: true,
      data: pricing
    });

  } catch (error) {
    console.error('Error getting Wheelseye pricing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Get all Wheelseye vehicle types
const getAllWheelseyeVehicles = async (req, res) => {
  try {
    const vehicles = await WheelseyePricing.getAllVehicles();

    res.json({
      success: true,
      data: vehicles
    });

  } catch (error) {
    console.error('Error getting Wheelseye vehicles:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Get detailed pricing for a specific vehicle type
const getVehiclePricing = async (req, res) => {
  try {
    const { vehicleType } = req.params;

    if (!vehicleType) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle type is required'
      });
    }

    const vehicle = await WheelseyePricing.findOne({ vehicleType });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: `Vehicle type '${vehicleType}' not found`
      });
    }

    res.json({
      success: true,
      data: vehicle
    });

  } catch (error) {
    console.error('Error getting vehicle pricing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Get all Wheelseye pricing data (admin endpoint)
const getAllWheelseyePricing = async (req, res) => {
  try {
    const pricing = await WheelseyePricing.find({}).sort({ vehicleType: 1, 'weightRange.min': 1 });

    res.json({
      success: true,
      data: pricing,
      count: pricing.length
    });

  } catch (error) {
    console.error('Error getting all Wheelseye pricing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Update Wheelseye pricing (admin endpoint)
const updateWheelseyePricing = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const pricing = await WheelseyePricing.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!pricing) {
      return res.status(404).json({
        success: false,
        message: 'Wheelseye pricing record not found'
      });
    }

    res.json({
      success: true,
      data: pricing,
      message: 'Wheelseye pricing updated successfully'
    });

  } catch (error) {
    console.error('Error updating Wheelseye pricing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Delete Wheelseye pricing (admin endpoint)
const deleteWheelseyePricing = async (req, res) => {
  try {
    const { id } = req.params;

    const pricing = await WheelseyePricing.findByIdAndDelete(id);

    if (!pricing) {
      return res.status(404).json({
        success: false,
        message: 'Wheelseye pricing record not found'
      });
    }

    res.json({
      success: true,
      message: 'Wheelseye pricing deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting Wheelseye pricing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

export {
  getWheelseyePricing,
  getAllWheelseyeVehicles,
  getVehiclePricing,
  getAllWheelseyePricing,
  updateWheelseyePricing,
  deleteWheelseyePricing
};

