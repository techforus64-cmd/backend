import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    saveHistory,
    getHistory,
    clearHistory,
    deleteEntry
} from '../controllers/searchHistoryController.js';

const router = express.Router();

// All search-history endpoints require authentication
router.post('/', protect, saveHistory);
router.get('/', protect, getHistory);
// /clear must be registered before /:id so Express doesn't treat "clear" as an ID
router.delete('/clear', protect, clearHistory);
router.delete('/:id', protect, deleteEntry);

export default router;
