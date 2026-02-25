// backend-main/backend-main/src/utils/pincodeMap.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Resolve the path to pincode_centroids.json
const JSON_PATH = path.join(__dirname, "../../data/pincode_centroids.json");

let rawCentroids = [];
try {
  rawCentroids = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
} catch (err) {
  console.error("Failed to load pincode_centroids.json:", err);
  process.exit(1);
}

// 2. Build an in-memory map: { "560001": { lat: 12.97..., lng: 77.59... }, … }
const pinMap = {};
rawCentroids.forEach((entry) => {
  if (entry.pincode) {
    pinMap[entry.pincode] = { lat: entry.lat, lng: entry.lng };
  }
});

// Log successful load
console.log(`✅ Centroids loaded: ${Object.keys(pinMap).length} pincodes`);

export default pinMap;
