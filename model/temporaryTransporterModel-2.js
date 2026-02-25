import mongoose from "mongoose";

const temporaryTransporterModel = new mongoose.Schema(
  {
    customerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      required: true,
    },
    companyName: {
      type: String,
      required: true,
    },
    vendorCode: {
      type: String,
      required: true,
    },
    vendorPhone: {
      type: Number,
      required: true,
    },
    vendorEmail: {
      type: String,
      required: true,
    },
    gstNo: {
      type: String,
      required: true,
    },
    mode: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    pincode: {
      type: Number,
      required: true,
    },
    city: {
      type: String,
      default: "",
    },
    rating: {
      type: Number,
      default: 3,
    },
    subVendor: {
      type: String,
      default: "",
    },
    selectedZones: [{
      type: String,
    }],
    prices: 
      {
        priceRate: {
          minWeight: {
            type: Number,

            default: 0,
          },
          docketCharges: {
            type: Number,

            default: 0,
          },
          fuel: {
            type: Number,

            default: 0,
          },
          rovCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          insuaranceCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          odaCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          codCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          prepaidCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          topayCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          handlingCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          fmCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          appointmentCharges: {
            variable: {
              type: Number,

              default: 0,
            },
            fixed: {
              type: Number,

              default: 0,
            },
          },
          divisor: {
            type: Number,

            default: 1,
          },
          minCharges: {
            type: Number,

            default: 0,
          },
          greenTax: {
            type: Number,

            default: 0,
          },
          daccCharges: {
            type: Number,

            default: 0,
          },
          miscellanousCharges: {
            type: Number,

            default: 0,
          },
        },
        priceChart: {},
      },
  },
  { timestamps: true, strict: false }
);

export default mongoose.model(
  "temporaryTransporters",
  temporaryTransporterModel
);
