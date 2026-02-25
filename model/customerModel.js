import mongoose from "mongoose";

const customerSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  phone: {
    type: Number,
    required: true,
    unique: true  // ✅ Phone should be unique (primary contact)
  },
  whatsappNumber: {
    type: Number,
    // Removed unique: true - multiple users may share company WhatsApp
  },
  password: {
    type: String,
    required: true,
  },
  companyName: {
    type: String,
    required: true
  },
  gstNumber: {
    type: String,
    required: true,
    // Removed unique: true - multiple users from same company share GST
  },

  address: {
    type: String,
    required: true,
    // Removed unique: true - multiple users can have same business address
  },
  state: {
    type: String,
    required: true,
  },
  pincode: {
    type: Number,
    required: true,
  },
  officeOpeningTime: {
    type: Date,
    default: ""
  },
  officeClosingTime: {
    type: Date,
    default: ""
  },
  businessType: {
    type: String,
    default: "",
  },

  products: {
    type: String,
    default: "",
  },
  typeOfLoad: {
    type: String,
    default: ""
  },
  handlingCare: {
    type: String,
    default: ""
  },
  customerNetwork: {
    type: String,
    default: ""
  },
  monthlyOrder: {
    type: Number,
    default: ""
  },
  averageLoadInDispatch: {
    type: Number,
    default: 0
  },
  maxLoadInDispatch: {
    type: Number,
    default: 0
  },
  maxLength: {
    type: Number,
    default: 0
  },
  maxWidth: {
    type: Number,
    default: 0
  },
  maxHeight: {
    type: Number,
    default: 0
  },
  typeOfCustomers: {
    type: String,
    default: ""
  },

  isSubscribed: {
    type: Boolean,
    default: false,
    required: true
  },
  isTransporter: {
    type: Boolean,
    default: false,
    required: true
  },
  isAdmin: {
    type: Boolean,
    default: false,
    required: true
  },
  adminPermissions: {
    formBuilder: {
      type: Boolean,
      default: true
    },
    dashboard: {
      type: Boolean,
      default: false
    },
    vendorApproval: {
      type: Boolean,
      default: false
    },
    userManagement: {
      type: Boolean,
      default: false
    }
  },
  tokenAvailable: {
    type: Number,
    default: 10,
    required: true
  },
  sessionVersion: {
    type: Number,
    default: 0
  },
  rateLimitExempt: {
    type: Boolean,
    default: false
  },
  customRateLimit: {
    type: Number,
    default: 15
  }
}, { timestamps: true });

export default mongoose.model("customers", customerSchema);