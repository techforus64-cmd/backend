import express from 'express';
import { createBidding, getAvailableBiddings, getBiddingByUser, getBiddingDetails, placeBid } from '../controllers/biddingController.js';

const router = express.Router();

router.post('/addbid', createBidding);
router.post('/getbids', getAvailableBiddings);
router.post("/:biddingId/bid", placeBid);
router.get("/details/:biddingId", getBiddingDetails);
router.get("/user/:userId", getBiddingByUser);

export default router;