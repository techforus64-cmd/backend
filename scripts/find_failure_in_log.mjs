
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, 'comprehensive_final_results_extended_v3.txt');

const content = fs.readFileSync(LOG_PATH, 'utf8');
const lines = content.split('\n');

console.log('Scanning for failures...');

let currentTest = '';
let buffer = [];

lines.forEach((line, index) => {
    if (line.includes('--- Test:')) {
        currentTest = line.trim();
        buffer = [line];
    } else {
        buffer.push(line);
    }

    // Check for failure indicators
    if (line.includes('ERROR') || line.includes('MISMATCH') || line.includes('Failed') || line.includes('Expected')) {
        // Exclude summary lines at the end
        if (!line.includes('Total Failed')) {
            console.log(`\nFailure found in ${currentTest} (Line ${index + 1}):`);
            console.log(line.trim());
            // Print context
            console.log(buffer.join('\n'));
        }
    }
});
