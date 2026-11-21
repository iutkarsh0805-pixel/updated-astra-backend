import express from 'express';
import {
  createBookingController,
  getBookingController,
  listMyBookings,
  cancelBookingController,
  completeBookingController,
  rescheduleBookingController
} from '../controllers/booking.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes would go here

// Protected routes
router.post('/', requireAuth, createBookingController);
router.get('/my-bookings', requireAuth, listMyBookings);
router.get('/:id', requireAuth, getBookingController);
router.put('/:id/cancel', requireAuth, cancelBookingController);
router.put('/:id/complete', requireAuth, completeBookingController);
router.put('/:id/reschedule', requireAuth, rescheduleBookingController);

export default router;