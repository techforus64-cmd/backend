// backend/utils/pincodeStore.js
const fs = require('fs');
const path = require('path');

class PincodeStore {
  constructor() {
    this.map = new Map();
    this.loaded = false;
  }

  loadSync(filePath = path.join(__dirname, '..', 'data', 'pincodes.txt')) {
    if (this.loaded) return;
    let raw;
    try { raw = fs.readFileSync(filePath, 'utf8'); }
    catch (err) { console.error('[pincodeStore] read error:', err.message); return; }
    raw.split(/\r?\n/).forEach(line => {
      line = line.trim(); if (!line || line.startsWith('#')) return;
      const parts = line.split(/[,|\s|\t]+/).filter(Boolean);
      if (parts.length < 3) return;
      const [pincode, latS, lonS] = parts;
      const lat = parseFloat(latS), lon = parseFloat(lonS);
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.map.set(String(pincode), { lat, lon });
    });
    this.loaded = true;
    console.info('[pincodeStore] loaded', this.map.size, 'pincodes');
  }

  getCoords(pincode) {
    if (!this.loaded) this.loadSync();
    return this.map.get(String(pincode)) || null;
  }
}

module.exports = new PincodeStore();
