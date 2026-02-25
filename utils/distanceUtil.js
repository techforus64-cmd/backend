// backend/utils/distanceUtil.js
function deg2rad(deg){ return (deg * Math.PI) / 180; }

function haversineMeters(a,b){
  if(!a||!b) return null;
  const R = 6371000;
  const dLat = deg2rad(b.lat - a.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const lat1 = deg2rad(a.lat), lat2 = deg2rad(b.lat);
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const aa = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
  return Math.round(R * c);
}

module.exports = { haversineMeters };
