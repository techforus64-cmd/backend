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
  phone:{
    type: Number,
    required: true,
    unique: true
  },
  whatsappNumber: {
    type: Number,
    unique: true
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
    unique: true,
  },

  address: {
    type: String,
    required: true,
    unique: true,
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
  
  isSubscribed:{
    type:Boolean,
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
  tokenAvailable: { 
    type: Number,
    default: 10,
    required: true
  }
}, {timestamps: true});

export default mongoose.model("customers", customerSchema);