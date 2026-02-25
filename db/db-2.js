import mongoose from "mongoose";
import dotenv from 'dotenv';

dotenv.config();

const connectDatabase = async() => {
    try {
        const url = process.env.MONGO_DB_URL;
        console.log('🔌 Attempting to connect to MongoDB...');
        const connectDB = await mongoose.connect(url);
        if (connectDB) {
            console.log(`✅ Connected to DB ${connectDB.connection.host}`);
        }
        else {
            console.log(`❌ Failed to connect DB`);
        }
    } catch (error) {
        console.error('❌ Database connection error:', error);
        throw error;
    }
}

export default connectDatabase;