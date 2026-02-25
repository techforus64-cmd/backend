import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import { addPincodeController, getPricesController } from '../controllers/adminController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });


router.post("/addpincode", protect, addPincodeController);
router.get("/getprice", protect, getPricesController);


export default router;
