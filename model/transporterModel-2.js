import mongoose from "mongoose";

const transporterSchema = new mongoose.Schema({
    companyName: { //done
        type: String,
        required: true,
        unique: true
    },
    phone: { //done
        type: Number,
        required: true
    },
    email: { //done
        type: String,
        required: true
    },
    password: { //done
        type: String,
        required: true
    },
    gstNo: { //done
        type: String,
        required: true
    },
    address: { //done
        type: String,
        required: true
    },
    state: { //done
        type: String,
        required: true
    },
    pincode: { //done
        type: Number,
        required: true
    },
    officeStart: { //done
        type: String,
        required: true
    },
    officeEnd: { //done
        type: String,
        required: true
    },
    deliveryMode: { //done
        type: String,
        default: ""
    },
    deliveryTat: {
        type: String,
        default: ""
    },
    trackingLink: {
        type: String,
        default: ""
    },
    websiteLink: {
        type: String,
        default: ""
    },
    experience:{
        type: Number,
        required: true,
        default: 0
    },

    maxLoading: {
        type: Number,
        default: 0
    },
    noOfTrucks: {
        type: Number,
        default: 0
    },
    annualTurnover: {
        type: Number,
        default: 0
    },
    customerNetwork:{
        type: String,
        default: ""
    },
    servicableZones: [{
        type: String,
        required: true
    }],
    service: [{
        pincode: {
            type: Number,
            required: true
        },
        isOda: {
            type: Boolean,
            default: false
        },
        zone: {
            type: String,
            required: true
        }
    }],

    isAdmin: {
        type: Boolean,
        default: false,
        required: true
    },
    isTransporter: {
        type: Boolean,
        default: true,
        required: true
    }

}, {timestamps: true});

export default mongoose.model("transporters", transporterSchema);