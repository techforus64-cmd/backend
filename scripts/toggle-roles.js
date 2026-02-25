import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

// Load env
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import customerModel from '../model/customerModel.js';

const BACKUP_FILE = join(__dirname, 'role-backups.json');
const TARGET_EMAILS = ['forus@gmail.com', 'singhabhudaya7@gmail.com'];

async function toggleRoles() {
    const mode = process.argv[2]; // 'disable' or 'restore'

    if (!['disable', 'restore'].includes(mode)) {
        console.error('Usage: node scripts/toggle-roles.js [disable|restore]');
        process.exit(1);
    }

    try {
        const uri = process.env.MONGO_DB_URL;
        if (!uri) throw new Error('MONGO_DB_URL not found in .env');

        await mongoose.connect(uri, { family: 4 });
        console.log(`✅ Connected to MongoDB. Mode: ${mode.toUpperCase()}`);

        if (mode === 'disable') {
            const backups = {};

            for (const email of TARGET_EMAILS) {
                const user = await customerModel.findOne({ email });
                if (user) {
                    // 1. Backup current state
                    backups[email] = {
                        isAdmin: user.isAdmin || false,
                        isSubscribed: user.isSubscribed || false,
                        rateLimitExempt: user.rateLimitExempt || false
                    };

                    // 2. Disable all roles
                    user.isAdmin = false;
                    user.isSubscribed = false;
                    user.rateLimitExempt = false;
                    await user.save();

                    console.log(`🔒 DISABLED roles for ${email}`);
                } else {
                    console.log(`⚠️ User not found: ${email}`);
                }
            }

            // Save backup to file
            fs.writeFileSync(BACKUP_FILE, JSON.stringify(backups, null, 2));
            console.log(`\n💾 Backup saved to ${BACKUP_FILE}`);
            console.log(`✅ Both users are now NORMAL FREE USERS.`);

        } else if (mode === 'restore') {
            if (!fs.existsSync(BACKUP_FILE)) {
                throw new Error('No backup file found! Cannot restore.');
            }

            const backups = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));

            for (const email of TARGET_EMAILS) {
                const user = await customerModel.findOne({ email });
                const backup = backups[email];

                if (user && backup) {
                    user.isAdmin = backup.isAdmin;
                    user.isSubscribed = backup.isSubscribed;
                    user.rateLimitExempt = backup.rateLimitExempt;
                    await user.save();
                    console.log(`🔓 RESTORED original roles for ${email}`);
                } else {
                    console.log(`⚠️ Could not restore ${email} (User or backup missing)`);
                }
            }

            console.log(`\n✅ Original settings have been successfully restored.`);
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

toggleRoles();
