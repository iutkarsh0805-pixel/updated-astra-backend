import express from 'express';
import {
  initializeReportController,
  getReportByBookingController,
  updateReportController,
  getCustomerReportsController,
  getAstrologerReportsController,
  getAnalyticsController,
  deleteReportController
} from '../controllers/report.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Initialize a new report for a booking
router.post('/initialize', initializeReportController);

// Get report by booking ID
router.get('/booking/:bookingId', getReportByBookingController);

// Get reports for customer
router.get('/customer', requireRole('CUSTOMER'), getCustomerReportsController);

// Get reports for astrologer
router.get('/astrologer', requireRole('ASTROLOGER'), getAstrologerReportsController);

// Analytics endpoint (admin and astrologer can access)
router.get('/analytics', requireRole('ADMIN'), getAnalyticsController);

// Update report
router.patch('/:reportId', updateReportController);

// Delete report (admin only)
router.delete('/:reportId', requireRole('ADMIN'), deleteReportController);

export default router;