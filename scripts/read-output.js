import fs from 'fs';
const content = fs.readFileSync('test-output.txt', 'utf16le');
console.log(content);
