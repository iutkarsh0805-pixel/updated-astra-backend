import express from 'express';
import {
  generateSummaryController,
  generateRecommendationsController,
  analyzeSentimentController,
  generateInsightsController,
  detectLanguageController
} from '../controllers/ai.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// All AI routes require authentication
router.use(requireAuth);

// Generate summary from consultation data
router.post('/summary', generateSummaryController);

// Generate recommendations
router.post('/recommendations', generateRecommendationsController);

// Analyze sentiment from text
router.post('/sentiment', analyzeSentimentController);

// Generate insights
router.post('/insights', generateInsightsController);

// Detect language
router.post('/detect-language', detectLanguageController);

export default router;
