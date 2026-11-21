import express from 'express';
import {
  listAvailableSlots,
  createSlotsForAstrologer,
  getSlot,
  updateSlotController,
  deleteSlotController,
  mySlots
} from '../controllers/slot.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.get('/available', listAvailableSlots);
router.get('/:id', getSlot);

// Protected routes
router.get('/my-slots', requireAuth, requireRole('ASTROLOGER'), mySlots);
router.post('/astrologer/:astrologerId', requireAuth, requireRole('ASTROLOGER'), createSlotsForAstrologer);
router.put('/:id', requireAuth, updateSlotController);
router.delete('/:id', requireAuth, deleteSlotController);

export default router;