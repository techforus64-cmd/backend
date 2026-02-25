import userTransRel from '../model/usertransporterrelationshipModel.js';
import transporterModel from '../model/transporterModel.js';
import customerModel from '../model/customerModel.js';
import priceModel from '../model/priceModel.js';
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';

/**
 * Given all the inputs, compute:
 *  - tiedUpResult: array of quotes from tied‑up transporters
 *  - transporterResult: array of quotes from public transporters
 *  - lowestEntry: the single entry with the lowest totalCharges
 *
 * @param {Object} params
 * @param {string} params.customerID
 * @param {string} params.userogpincode
 * @param {string} params.modeoftransport
 * @param {string|number} params.fromPincode
 * @param {string|number} params.toPincode
 * @param {number} params.noofboxes
 * @param {number} params.length
 * @param {number} params.width
 * @param {number} params.height
 * @param {number} params.weight
 */
export async function calculatePriceData({
  customerID,
  userogpincode,
  modeoftransport,
  fromPincode,
  toPincode,
  noofboxes,
  length,
  width,
  height,
  weight,
}) {
  // 1) Distance & estimated time
  const { estTime, distance: dist } = await calculateDistanceBetweenPincode(
    fromPincode,
    toPincode
  );

  // 2) Compute actual weight
  const actualWeight = weight * noofboxes;

  // 3) Tied‑up transporters
  const tiedUpCompanies = await userTransRel.find({ customerID });
  const tiedUpRaw = await Promise.all(
    tiedUpCompanies.map(async (tuc) => {
      const fromZoneData = tuc.prices.priceChart[fromPincode];
      if (!fromZoneData) return null;

      const transporter = await transporterModel.findById(tuc.transporterId);
      if (!transporter) return null;

      const svcFrom = transporter.service.find(e => e.pincode === Number(fromPincode) && !e.isOda);
      const svcTo = transporter.service.find(e => e.pincode === Number(toPincode));
      if (!svcFrom || !svcTo) return null;

      const unitPrice = tuc.prices.priceChart[fromPincode][svcTo.zone];
      if (!unitPrice) return null;

      // volumetric weight
      let volW = (length * width * height) /
        (modeoftransport === 'Road' ? 4500 : 4750);
      volW = (volW * tuc.prices.priceRate.divisor).toFixed(2);

      const chargeableWeight = Math.max(volW, actualWeight);
      const baseFreight = unitPrice * chargeableWeight;

      const pr = tuc.prices.priceRate;
      const compute = (field) =>
        Math.max((pr[field].variable / 100) * baseFreight, pr[field].fixed);

      // FIX: minCharges is a FLOOR constraint, not an additive fee
      const effectiveBaseFreight = Math.max(baseFreight, pr.minCharges || 0);

      const totalCharges =
        effectiveBaseFreight +
        pr.docketCharges +
        // pr.minCharges removed - now enforced as floor via effectiveBaseFreight
        pr.greenTax +
        pr.daccCharges +
        pr.miscellanousCharges +
        (pr.fuel / 100) * effectiveBaseFreight +
        compute('rovCharges') +
        compute('insuaranceCharges') +
        (svcTo.isOda
          ? pr.odaCharges.fixed + chargeableWeight * (pr.odaCharges.variable / 100)
          : 0) +
        pr.handlingCharges.fixed +
        chargeableWeight * (pr.handlingCharges.variable / 100) +
        compute('fmCharges') +
        compute('appointmentCharges');

      return {
        companyId: transporter._id,
        companyName: transporter.companyName,
        originPincode: fromPincode,
        destinationPincode: toPincode,
        estimatedTime: estTime,
        distance: dist,
        chargeableWeight,
        unitPrice,
        baseFreight,
        docketCharge: pr.docketCharges,
        minCharges: pr.minCharges,
        greenTax: pr.greenTax,
        daccCharges: pr.daccCharges,
        miscCharges: pr.miscellanousCharges,
        fuelCharges: (pr.fuel / 100) * baseFreight,
        rovCharges: compute('rovCharges'),
        insuaranceCharges: compute('insuaranceCharges'),
        odaCharges: svcTo.isOda
          ? pr.odaCharges.fixed + chargeableWeight * (pr.odaCharges.variable / 100)
          : 0,
        handlingCharges:
          pr.handlingCharges.fixed +
          chargeableWeight * (pr.handlingCharges.variable / 100),
        fmCharges: compute('fmCharges'),
        appointmentCharges: compute('appointmentCharges'),
        totalCharges,
        isHidden: false,
      };
    })
  );
  const tiedUpResult = tiedUpRaw.filter(r => r);

  // 4) Public transporters
  const transporterData = await transporterModel.find();
  const customerData = await customerModel.findById(customerID);
  const isSubscribed = customerData?.isSubscribed ?? false;

  const transporterRaw = await Promise.all(
    transporterData.map(async (data) => {
      const svcFrom = data.service.find(e => e.pincode === Number(fromPincode) && !e.isOda);
      const svcTo = data.service.find(e => e.pincode === Number(toPincode));
      if (!svcFrom || !svcTo) return null;

      const priceData = await priceModel.findOne({ companyId: data._id });
      const pr = priceData.priceRate;
      const chart = priceData.zoneRates;
      const unitPrice = chart.get(svcFrom.zone)?.[svcTo.zone];
      if (!unitPrice) return null;

      let volW = (length * width * height) /
        (modeoftransport === 'Road' ? 4500 : 4750);
      volW = (volW * pr.divisor).toFixed(2);

      const chargeableWeight = Math.max(volW, actualWeight);
      const baseFreight = unitPrice * chargeableWeight;
      const compute = (field) =>
        Math.max((pr[field].variable / 100) * baseFreight, pr[field].fixed);

      // FIX: minCharges is a FLOOR constraint, not an additive fee
      const effectiveBaseFreight = Math.max(baseFreight, pr.minCharges || 0);

      const totalCharges =
        effectiveBaseFreight +
        pr.docketCharges +
        // pr.minCharges removed - now enforced as floor via effectiveBaseFreight
        pr.greenTax +
        pr.daccCharges +
        pr.miscellanousCharges +
        (pr.fuel / 100) * effectiveBaseFreight +
        compute('rovCharges') +
        compute('insuaranceCharges') +
        (svcTo.isOda
          ? pr.odaCharges.fixed + chargeableWeight * (pr.odaCharges.variable / 100)
          : 0) +
        pr.handlingCharges.fixed +
        chargeableWeight * (pr.handlingCharges.variable / 100) +
        compute('fmCharges') +
        compute('appointmentCharges');

      // hide if not subscribed
      if (!isSubscribed) {
        return { totalCharges, isHidden: true };
      }

      return {
        companyId: data._id,
        companyName: data.companyName,
        originPincode: fromPincode,
        destinationPincode: toPincode,
        estimatedTime: estTime,
        distance: dist,
        chargeableWeight,
        unitPrice,
        baseFreight,
        docketCharge: pr.docketCharges,
        minCharges: pr.minCharges,
        greenTax: pr.greenTax,
        daccCharges: pr.daccCharges,
        miscCharges: pr.miscellanousCharges,
        fuelCharges: (pr.fuel / 100) * baseFreight,
        rovCharges: compute('rovCharges'),
        insuaranceCharges: compute('insuaranceCharges'),
        odaCharges: svcTo.isOda
          ? pr.odaCharges.fixed + chargeableWeight * (pr.odaCharges.variable / 100)
          : 0,
        handlingCharges:
          pr.handlingCharges.fixed +
          chargeableWeight * (pr.handlingCharges.variable / 100),
        fmCharges: compute('fmCharges'),
        appointmentCharges: compute('appointmentCharges'),
        totalCharges,
        isHidden: false,
      };
    })
  );
  const transporterResult = transporterRaw.filter(r => r);

  // 5) Find lowest‐price entry
  const all = [...tiedUpResult, ...transporterResult];
  const lowestEntry = all.reduce((best, cur) =>
    cur.totalCharges < best.totalCharges ? cur : best
  );

  return { tiedUpResult, transporterResult, lowestEntry };
}
