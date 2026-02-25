// model/User.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    firstName: { type: String },
    lastName: { type: String },
    email: { type: String, index: true, unique: true },
    phone: { type: Number },
    whatsappNumber: { type: Number },
    password: { type: String }, // hashed
    companyName: { type: String },
    gstNumber: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: Number },
    officeOpeningTime: { type: String, default: null },
    officeClosingTime: { type: String, default: null },
    businessType: { type: String },
    products: { type: String },
    typeOfLoad: { type: String },
    handlingCare: { type: String },
    customerNetwork: { type: String },
    monthlyOrder: { type: Number, default: 0 },
    averageLoadInDispatch: { type: Number, default: 0 },
    maxLoadInDispatch: { type: Number, default: 0 },
    maxLength: { type: Number, default: 0 },
    maxWidth: { type: Number, default: 0 },
    maxHeight: { type: Number, default: 0 },
    typeOfCustomers: { type: String },
    isSubscribed: { type: Boolean, default: false },
    isTransporter: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    tokenAvailable: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// This line is important to avoid OverwriteModelError
const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
