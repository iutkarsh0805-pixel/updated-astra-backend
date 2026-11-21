import express from 'express';
import {
  getUsers,
  getAstrologers,
  getBookings,
  getDashboard,
  getUser,
  updateUserStatusController,
  updateAstrologerVerificationController,
  getSystemHealthController,
  exportBookingsController,
  exportUsersController
} from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// All admin routes require ADMIN role
router.use(requireAuth, requireRole('ADMIN'));

// Dashboard
router.get('/dashboard', getDashboard);
router.get('/health', getSystemHealthController);

// Users
router.get('/users', getUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id/status', updateUserStatusController);

// Astrologers
router.get('/astrologers', getAstrologers);
router.patch('/astrologers/:id/verification', updateAstrologerVerificationController);

// Bookings
router.get('/bookings', getBookings);

// Exports
router.get('/export/bookings', exportBookingsController);
router.get('/export/users', exportUsersController);

export default router;