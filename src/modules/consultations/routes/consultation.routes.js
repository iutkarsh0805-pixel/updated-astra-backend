import express from 'express';
import {
  getConsultationTypesController,
  getConsultationByBookingController,
  createConsultationController,
  updateConsultationController,
  getAstrologerConsultationsController,
  getCustomerConsultationsController
} from '../controllers/consultation.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.get('/types', getConsultationTypesController);

// Authenticated routes
router.use(requireAuth);

// Create consultation
router.post('/', createConsultationController);

// Get consultation types (authenticated)
router.get('/types', getConsultationTypesController);

// Get consultation by booking ID
router.get('/booking/:bookingId', getConsultationByBookingController);

// Astrologer-specific routes
router.get('/astrologer', requireRole('ASTROLOGER'), getAstrologerConsultationsController);

// Customer-specific routes
router.get('/customer', requireRole('CUSTOMER'), getCustomerConsultationsController);

// Update consultation (owner or authorized user)
router.patch('/:consultationId', updateConsultationController);

export default router;