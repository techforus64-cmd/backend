// backend/migrations/dropInvalidIndexes.js
// Run this ONCE after deploying the model changes to remove old unique indexes

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function dropInvalidIndexes() {
    try {
        console.log('🔌 Connecting to database...');
        await mongoose.connect(process.env.MONGO_DB_URL);
        console.log('✅ Connected to database');

        const db = mongoose.connection.db;
        const collection = db.collection('customers');

        console.log('\n📋 Current indexes:');
        const indexes = await collection.indexes();
        console.log(JSON.stringify(indexes, null, 2));

        console.log('\n🗑️  Dropping invalid unique indexes...');

        // Drop gstNumber unique index
        try {
            await collection.dropIndex('gstNumber_1');
            console.log('✅ Dropped gstNumber_1 index');
        } catch (err) {
            console.log('⚠️  gstNumber_1 index not found or already dropped');
        }

        // Drop address unique index
        try {
            await collection.dropIndex('address_1');
            console.log('✅ Dropped address_1 index');
        } catch (err) {
            console.log('⚠️  address_1 index not found or already dropped');
        }

        // Drop whatsappNumber unique index
        try {
            await collection.dropIndex('whatsappNumber_1');
            console.log('✅ Dropped whatsappNumber_1 index');
        } catch (err) {
            console.log('⚠️  whatsappNumber_1 index not found or already dropped');
        }

        console.log('\n📋 Remaining indexes:');
        const remainingIndexes = await collection.indexes();
        console.log(JSON.stringify(remainingIndexes, null, 2));

        console.log('\n✅ Migration complete!');
        console.log('Only email and phone should have unique indexes.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

dropInvalidIndexes();
