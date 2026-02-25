import mongoose from "mongoose";

const usertransporterrelationshipSchema = new mongoose.Schema(
  {
    customerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      required: true
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "transporters",
      required: true,
    },
    prices: 
      {
        vendorCode:{
          type:String,
          required:true
        },
        vendorPhone: {
          type: Number,
          required: true
        },
        vendorEmail: {
          type: String,
          required: true
        },
        gstNo: {
          type: String,
          required: true
        },
        mode: {
          type: String,
          required: true
        },
        address: {
          type: String,
          required: true
        },
        state: {
          type: String,
          required: true
        },
        pincode: {
          type: Number,
          required: true
        },
        priceRate: {
          minWeight: {
            type: Number,
            required: true,
            default: 0,
          },
          docketCharges: {
            type: Number,
            required: true,
            default: 0,
          },
          fuel: {
            type: Number,
            required: true,
            default: 0,
          },
          rovCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          insuaranceCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          odaCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          codCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          prepaidCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          topayCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          handlingCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
            threshholdweight: {
              type: Number,
              required: true,
              default: 0
            }
          },
          fmCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          appointmentCharges: {
            variable: {
              type: Number,
              required: true,
              default: 0,
            },
            fixed: {
              type: Number,
              required: true,
              default: 0,
            },
          },
          divisor: {
            type: Number,
            required: true,
            default: 1,
          },
          minCharges: {
            type: Number,
            required: true,
            default: 0,
          },
          greenTax: {
            type: Number,
            required: true,
            default: 0,
          },
          daccCharges: {
            type: Number,
            required: true,
            default: 0,
          },
          miscellanousCharges: {
            type: Number,
            required: true,
            default: 0,
          },
        },
        priceChart: {
          
        }
      }
  }, { timestamps: true, strict: false}
);

export default mongoose.model(
  "usertransporterrelationship",
  usertransporterrelationshipSchema
);
