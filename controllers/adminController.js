import priceModel from "../model/priceModel.js";

export const addPincodeController = async (req, res) => {
  try {
    const { pincode, city, state, zone } = req.body;

    // Manual input validation
    if (
      !pincode ||
      isNaN(pincode) ||
      !city ||
      typeof city !== "string" ||
      city.trim() === "" ||
      !state ||
      typeof state !== "string" ||
      state.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid input. Please provide all required fields with valid data.",
      });
    }

    const data = await new pincodeModel({
      pincode: Number(pincode),
      city: city.trim(),
      state: state.trim()
     
    }).save();

    return res.status(201).json({
      success: true,
      message: "Pincode data saved successfully",
    });
  } catch (error) {
    console.error("Error saving Pincode data:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const transporterPriceController = async (req, res) => {
  try {
    const data = req.body;
    console.log("Received data:", data);
    const savedData = await new priceModel(data).save();
    if(!savedData) {
      return res.status(400).json({
        success: false,
        message: "Failed to save transporter price data"
      });
    }
    return res.status(200).json({
      success: true,
      message: "Data received successfully",
      data: data
    });
  } catch (error) {
    console.error("Error fetching price:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getPricesController = async (req, res) => {
  try {
    const prices = await priceModel.find({});
    if (!prices || prices.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No prices found",
      });
    }
    return res.status(200).json({
      success: true,
      data: prices,
      message: "Prices fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching prices:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    }); 
  }
};
