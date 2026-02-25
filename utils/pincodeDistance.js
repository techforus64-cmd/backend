// backend/utils/pincodeDistance.js
const path = require('path');
const pincodeStore = require(path.join(__dirname, 'pincodeStore'));
const { haversineMeters } = require(path.join(__dirname, 'distanceUtil'));

async function getDistanceMeters(originPincode, destinationPincode){
  if(!originPincode || !destinationPincode) return null;
  const from = pincodeStore.getCoords(originPincode);
  const to = pincodeStore.getCoords(destinationPincode);
  if(!from || !to) return null;
  return haversineMeters(from, to);
}

module.exports = { getDistanceMeters };
