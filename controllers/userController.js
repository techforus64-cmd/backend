// controllers/customerController.js
// Returns the logged-in customer's public profile

export const getMe = async (req, res) => {
  try {
    // protect middleware has already put the DB customer into req.customer
    const customer = req.customer;

    if (!customer) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    // Format response for frontend
    const output = {
      _id: customer._id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      email: customer.email,
      phone: customer.phone,
      whatsappNumber: customer.whatsappNumber,
      companyName: customer.companyName,
      gstNumber: customer.gstNumber,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      businessType: customer.businessType,
      monthlyOrder: customer.monthlyOrder,
      typeOfLoad: customer.typeOfLoad,
      isSubscribed: customer.isSubscribed,
      isTransporter: customer.isTransporter,
      isAdmin: customer.isAdmin,
      tokenAvailable: customer.tokenAvailable,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    };

    return res.json(output);
  } catch (error) {
    console.error("getMe error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
