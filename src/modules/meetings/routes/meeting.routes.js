import express from 'express';
import {
  createMeetingController,
  getMeetingController,
  updateMeetingController,
  deleteMeetingController,
  getMeetingTranscriptController,
  getGoogleAuthUrlController,
  googleOAuthCallbackController
} from '../controllers/meeting.controller.js';
import { requireAuth } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Public routes

// Protected routes
router.post('/', requireAuth, createMeetingController);
router.get('/:id', requireAuth, getMeetingController);
router.put('/:id', requireAuth, updateMeetingController);
router.delete('/:id', requireAuth, deleteMeetingController);
router.get('/:id/transcript', requireAuth, getMeetingTranscriptController);
router.get('/google/callback', googleOAuthCallbackController);
router.get('/google-auth-url', requireAuth, getGoogleAuthUrlController);

export default router;