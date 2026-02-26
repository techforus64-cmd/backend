import IndiaPostPricing from '../model/indiaPostPricingModel.js';

// Get IndiaPost pricing by weight and distance
const getIndiaPostPricing = async (req, res) => {
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

        const pricing = await IndiaPostPricing.findPricing(weightNum, distanceNum);

        res.json({
            success: true,
            data: pricing
        });

    } catch (error) {
        console.error('Error getting IndiaPost pricing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
};

// Get all IndiaPost pricing data (admin endpoint)
const getAllIndiaPostPricing = async (req, res) => {
    try {
        const pricing = await IndiaPostPricing.find({}).sort({ 'weightRange.min': 1 });

        res.json({
            success: true,
            data: pricing,
            count: pricing.length
        });

    } catch (error) {
        console.error('Error getting all IndiaPost pricing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
};

// Add new IndiaPost pricing (admin endpoint)
const addIndiaPostPricing = async (req, res) => {
    try {
        const newData = req.body;
        const pricing = new IndiaPostPricing(newData);
        await pricing.save();

        res.status(201).json({
            success: true,
            data: pricing,
            message: 'IndiaPost pricing added successfully'
        });
    } catch (error) {
        console.error('Error adding IndiaPost pricing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
};

// Update IndiaPost pricing (admin endpoint)
const updateIndiaPostPricing = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const pricing = await IndiaPostPricing.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!pricing) {
            return res.status(404).json({
                success: false,
                message: 'IndiaPost pricing record not found'
            });
        }

        res.json({
            success: true,
            data: pricing,
            message: 'IndiaPost pricing updated successfully'
        });

    } catch (error) {
        console.error('Error updating IndiaPost pricing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
};

// Delete IndiaPost pricing (admin endpoint)
const deleteIndiaPostPricing = async (req, res) => {
    try {
        const { id } = req.params;

        const pricing = await IndiaPostPricing.findByIdAndDelete(id);

        if (!pricing) {
            return res.status(404).json({
                success: false,
                message: 'IndiaPost pricing record not found'
            });
        }

        res.json({
            success: true,
            message: 'IndiaPost pricing deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting IndiaPost pricing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
};

export {
    getIndiaPostPricing,
    getAllIndiaPostPricing,
    addIndiaPostPricing,
    updateIndiaPostPricing,
    deleteIndiaPostPricing
};
