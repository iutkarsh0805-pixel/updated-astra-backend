import express from 'express';
import {
  listMyServices,
  getService,
  createServiceController,
  updateServiceController,
  deleteServiceController,
  searchServicesController,
  getFeaturedServicesController,
  getServiceAnalyticsController
} from '../controllers/service.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.get('/search', searchServicesController);
router.get('/featured', getFeaturedServicesController);
router.get('/:id', getService);

// Protected routes - Astrologer only
router.get('/my-services', requireAuth, requireRole('ASTROLOGER'), listMyServices);
router.post('/', requireAuth, requireRole('ASTROLOGER'), createServiceController);
router.put('/:id', requireAuth, requireRole('ASTROLOGER'), updateServiceController);
router.delete('/:id', requireAuth, requireRole('ASTROLOGER'), deleteServiceController);
router.get('/:id/analytics', requireAuth, requireRole('ASTROLOGER'), getServiceAnalyticsController);

export default router;