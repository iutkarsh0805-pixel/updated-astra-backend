import express from 'express';
import {
  createReviewController,
  getReviewsByAstrologerController,
  getMyReviewsController,
  getReviewController,
  updateReviewController,
  deleteReviewController
} from '../controllers/review.controller.js';
import { requireAuth } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.get('/astrologer/:astrologerId', getReviewsByAstrologerController);
router.get('/:id', getReviewController);

// Protected routes
router.post('/', requireAuth, createReviewController);
router.get('/my-reviews', requireAuth, getMyReviewsController);
router.put('/:id', requireAuth, updateReviewController);
router.delete('/:id', requireAuth, deleteReviewController);

export default router;