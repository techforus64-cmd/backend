import express from 'express';
import TemporaryTransporter from '../model/temporaryTransporterModel.js';
import { validateInvoiceChargeSettings, generateExampleCalculation } from '../utils/invoiceChargeCalculator.js';

const router = express.Router();

/**
 * @route   PATCH /api/transporters/:transporterId/invoice-charges
 * @desc    Update invoice value charges for a specific transporter
 * @access  Private
 */
router.patch('/:transporterId/invoice-charges', async (req, res) => {
  try {
    const { transporterId } = req.params;
    const { enabled, percentage, minimumAmount, description } = req.body;

    // Parse and validate input
    const invoiceChargeSettings = {
      enabled: Boolean(enabled),
      percentage: parseFloat(percentage) || 0,
      minimumAmount: parseFloat(minimumAmount) || 0,
      description: description || 'Invoice Value Handling Charges',
    };

    // Validate settings
    const validation = validateInvoiceChargeSettings(invoiceChargeSettings);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice charge settings',
        errors: validation.errors,
      });
    }

    // Update transporter
    const transporter = await TemporaryTransporter.findByIdAndUpdate(
      transporterId,
      {
        'invoiceValueCharges.enabled': invoiceChargeSettings.enabled,
        'invoiceValueCharges.percentage': invoiceChargeSettings.percentage,
        'invoiceValueCharges.minimumAmount': invoiceChargeSettings.minimumAmount,
        'invoiceValueCharges.description': invoiceChargeSettings.description,
      },
      { new: true, runValidators: true }
    ).select('_id companyName vendorCode invoiceValueCharges');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    res.json({
      success: true,
      message: 'Invoice value charges updated successfully',
      data: {
        transporterId: transporter._id,
        companyName: transporter.companyName,
        vendorCode: transporter.vendorCode,
        invoiceCharges: transporter.invoiceValueCharges,
      },
    });
  } catch (error) {
    console.error('Error updating invoice charges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update invoice charges',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/transporters/:transporterId/invoice-charges
 * @desc    Get invoice value charges for a specific transporter
 * @access  Private
 */
router.get('/:transporterId/invoice-charges', async (req, res) => {
  try {
    const transporter = await TemporaryTransporter.findById(req.params.transporterId)
      .select('invoiceValueCharges companyName vendorCode');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    // Generate example calculation if enabled
    let exampleCalculation = null;
    if (transporter.invoiceValueCharges?.enabled) {
      exampleCalculation = generateExampleCalculation(transporter.invoiceValueCharges, 10000);
    }

    res.json({
      success: true,
      data: {
        transporterId: transporter._id,
        companyName: transporter.companyName,
        vendorCode: transporter.vendorCode,
        invoiceCharges: transporter.invoiceValueCharges,
        exampleCalculation: exampleCalculation,
      },
    });
  } catch (error) {
    console.error('Error fetching invoice charges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice charges',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/transporters/bulk-update-invoice-charges
 * @desc    Bulk update invoice charges for multiple transporters
 * @access  Private
 */
router.post('/bulk-update-invoice-charges', async (req, res) => {
  try {
    const { transporterIds, invoiceCharges } = req.body;

    // Validate input
    if (!Array.isArray(transporterIds) || transporterIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transporterIds must be a non-empty array',
      });
    }

    // Parse and validate settings
    const invoiceChargeSettings = {
      enabled: Boolean(invoiceCharges?.enabled),
      percentage: parseFloat(invoiceCharges?.percentage) || 0,
      minimumAmount: parseFloat(invoiceCharges?.minimumAmount) || 0,
      description: invoiceCharges?.description || 'Invoice Value Handling Charges',
    };

    const validation = validateInvoiceChargeSettings(invoiceChargeSettings);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice charge settings',
        errors: validation.errors,
      });
    }

    // Update all specified transporters
    const result = await TemporaryTransporter.updateMany(
      { _id: { $in: transporterIds } },
      {
        $set: {
          'invoiceValueCharges.enabled': invoiceChargeSettings.enabled,
          'invoiceValueCharges.percentage': invoiceChargeSettings.percentage,
          'invoiceValueCharges.minimumAmount': invoiceChargeSettings.minimumAmount,
          'invoiceValueCharges.description': invoiceChargeSettings.description,
        },
      }
    );

    res.json({
      success: true,
      message: `Invoice charges updated for ${result.modifiedCount} transporter(s)`,
      data: {
        totalUpdated: result.modifiedCount,
        totalMatched: result.matchedCount,
        invoiceCharges: invoiceChargeSettings,
      },
    });
  } catch (error) {
    console.error('Error bulk updating invoice charges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update invoice charges',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/transporters/invoice-charges/summary
 * @desc    Get summary of all transporters with invoice charges enabled
 * @access  Private
 */
router.get('/invoice-charges/summary', async (req, res) => {
  try {
    const transporters = await TemporaryTransporter.find({
      'invoiceValueCharges.enabled': true,
    }).select('_id companyName vendorCode invoiceValueCharges');

    const summary = transporters.map(t => ({
      transporterId: t._id,
      companyName: t.companyName,
      vendorCode: t.vendorCode,
      percentage: t.invoiceValueCharges.percentage,
      minimumAmount: t.invoiceValueCharges.minimumAmount,
      description: t.invoiceValueCharges.description,
    }));

    res.json({
      success: true,
      data: {
        totalWithInvoiceCharges: summary.length,
        transporters: summary,
      },
    });
  } catch (error) {
    console.error('Error fetching invoice charges summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice charges summary',
      error: error.message,
    });
  }
});

/**
 * @route   DELETE /api/transporters/:transporterId/invoice-charges
 * @desc    Disable invoice charges for a transporter
 * @access  Private
 */
router.delete('/:transporterId/invoice-charges', async (req, res) => {
  try {
    const { transporterId } = req.params;

    const transporter = await TemporaryTransporter.findByIdAndUpdate(
      transporterId,
      {
        'invoiceValueCharges.enabled': false,
      },
      { new: true }
    ).select('_id companyName vendorCode invoiceValueCharges');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    res.json({
      success: true,
      message: 'Invoice charges disabled successfully',
      data: {
        transporterId: transporter._id,
        companyName: transporter.companyName,
        invoiceCharges: transporter.invoiceValueCharges,
      },
    });
  } catch (error) {
    console.error('Error disabling invoice charges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable invoice charges',
      error: error.message,
    });
  }
});

export default router;