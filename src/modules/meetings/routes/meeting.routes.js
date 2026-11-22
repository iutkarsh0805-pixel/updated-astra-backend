import express from 'express';
import {
  createMeetingController,
  getMeetingController,
  updateMeetingController,
  deleteMeetingController,
  getMeetingTranscriptController,
  getGoogleAuthUrlController,
  googleOAuthCallbackController,
  requestMeetingTranscriptController
} from '../controllers/meeting.controller.js';
import { requireAuth } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

router.get('/google/callback', googleOAuthCallbackController);
router.get('/google-auth-url', requireAuth, getGoogleAuthUrlController);

router.post('/', requireAuth, createMeetingController);
router.get('/:id', requireAuth, getMeetingController);
router.put('/:id', requireAuth, updateMeetingController);
router.delete('/:id', requireAuth, deleteMeetingController);
router.get('/:id/transcript', requireAuth, getMeetingTranscriptController);
router.post('/:id/transcript', requireAuth, requestMeetingTranscriptController);

export default router;