import express from 'express';
import {
  getTranscriptByMeetingController,
  upsertTranscriptController,
  getTranscriptsByBookingController,
  getCustomerTranscriptsController,
  getAstrologerTranscriptsController,
  getTranscriptContentController
} from '../controllers/transcript.controller.js';
import { requireAuth, requireRole } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Create/update transcript
router.post('/', upsertTranscriptController);

// Get transcript by meeting
router.get('/meeting/:meetingId', getTranscriptByMeetingController);

// Get transcript content (full text)
router.get('/:transcriptId/content', getTranscriptContentController);

// Get transcript by booking
router.get('/booking/:bookingId', getTranscriptsByBookingController);

// Customer-specific routes
router.get('/customer', requireRole('CUSTOMER'), getCustomerTranscriptsController);

// Astrologer-specific routes
router.get('/astrologer', requireRole('ASTROLOGER'), getAstrologerTranscriptsController);

export default router;