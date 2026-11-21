import express from 'express';
import {
  createPaymentOrder,
  verifyPaymentWebhook,
  getPayment,
  getUserPayments,
  refundPaymentHandler
} from '../controllers/payment.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.post('/webhook', verifyPaymentWebhook);

// Protected routes
router.post('/create-order', requireAuth, createPaymentOrder);
router.get('/my-payments', requireAuth, getUserPayments);
router.get('/:id', requireAuth, getPayment);
router.post('/:id/refund', requireAuth, refundPaymentHandler);

export default router;