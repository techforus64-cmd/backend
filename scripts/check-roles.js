import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load env
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import customerModel from '../model/customerModel.js';

async function checkUserinfo() {
    try {
        const uri = process.env.MONGO_DB_URL;
        if (!uri) throw new Error('MONGO_DB_URL not found in .env');

        await mongoose.connect(uri);
        console.log('✅ Connected to MongoDB\n');

        const emailToCheck = 'singhabhudaya7@gmail.com';
        const user = await customerModel.findOne({ email: emailToCheck });

        if (!user) {
            console.log(`❌ User not found with email: ${emailToCheck}`);
        } else {
            console.log(`👤 User Profile: ${user.firstName} ${user.lastName} (${user.email})`);
            console.log('--------------------------------------------------');
            console.log(`- isAdmin:         ${user.isAdmin ? '✅ YES' : '❌ NO'}`);
            console.log(`- isSubscribed:    ${user.isSubscribed ? '✅ YES' : '❌ NO'}`);
            console.log(`- rateLimitExempt: ${user.rateLimitExempt ? '✅ YES' : '❌ NO'}`);
            console.log('--------------------------------------------------');

            if (user.isAdmin || user.isSubscribed || user.rateLimitExempt) {
                console.log('💡 VERDICT: This user WILL BYPASS the rate limit because they have a special role.');
            } else {
                console.log('💡 VERDICT: This user is a NORMAL FREE USER and WILL BE rate limited (15/hr).');
            }
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

checkUserinfo();
