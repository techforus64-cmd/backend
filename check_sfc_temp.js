const XLSX = require('xlsx');
const wb = XLSX.readFile('../BLUE DART PIN CODE.xlsb');
const ws = wb.Sheets['sfc_pin'];
const data = XLSX.utils.sheet_to_json(ws);
let inbOnly=0, outOnly=0, both=0, neither=0;
data.forEach(r => {
  const inb = (r.SFC_INB||'').toLowerCase()==='yes';
  const out = (r.SFC_OUT||'').toLowerCase()==='yes';
  if(inb && out) both++;
  else if(inb) inbOnly++;
  else if(out) outOnly++;
  else neither++;
});
console.log('Both INB+OUT:', both);
console.log('INB only:', inbOnly);
console.log('OUT only:', outOnly);
console.log('Neither:', neither);
console.log('Total:', data.length);
// Show a few INB-only examples
const inbOnlySample = data.filter(r => (r.SFC_INB||'').toLowerCase()==='yes' && (r.SFC_OUT||'').toLowerCase()!=='yes').slice(0,5);
console.log('INB-only samples:', JSON.stringify(inbOnlySample, null,2));
