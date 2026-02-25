import jwt from 'jsonwebtoken';
import customerModel from '../model/customerModel.js';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

export const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            if (!token) {
                return res.status(401).json({ success: false, message: 'Not authorized, no token found in Bearer string' });
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            
            if (!decoded.customer || !decoded.customer._id) {
                return res.status(401).json({ success: false, message: 'Not authorized, invalid token structure' });
            }
            
            req.customer = await customerModel.findById(decoded.customer._id).select('-password');

            if (!req.customer) {
                return res.status(401).json({ success: false, message: 'Not authorized, user not found' });
            }

            next();
        } catch (error) {
            console.error('Token verification failed:', error.message);
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({ success: false, message: 'Not authorized, token is invalid' });
            }
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ success: false, message: 'Not authorized, token has expired' });
            }
            return res.status(401).json({ success: false, message: 'Not authorized, token processing failed' });
        }
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized, no token provided' });
    }
};