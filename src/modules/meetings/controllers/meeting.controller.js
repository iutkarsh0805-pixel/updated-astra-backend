// Meeting Controllers
import {
  createMeeting,
  getMeeting,
  updateMeeting,
  deleteMeeting,
  getMeetingTranscript,
  scheduleReminders,
  getGoogleAuthUrl,
  exchangeGoogleAuthCode,
  storeGoogleOAuthAccount,
  verifyGoogleOAuthState
} from '../services/meeting.service.js';

export const createMeetingController = async (req, res, next) => {
  try {
    const meeting = await createMeeting(req.body.bookingId, req.user.userId);
    res.status(201).json({
      success: true,
      message: 'Meeting created successfully',
      data: meeting
    });
  } catch (error) {
    if (error.message === 'Booking not found' || error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getMeetingController = async (req, res, next) => {
  try {
    const meeting = await getMeeting(req.params.id, req.user.userId, req.user.role);

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    res.json({ success: true, data: meeting });
  } catch (error) {
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const updateMeetingController = async (req, res, next) => {
  try {
    const meeting = await updateMeeting(req.params.id, req.user.userId, req.body);
    res.json({
      success: true,
      message: 'Meeting updated successfully',
      data: meeting
    });
  } catch (error) {
    if (error.message === 'Meeting not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const deleteMeetingController = async (req, res, next) => {
  try {
    const result = await deleteMeeting(req.params.id, req.user.userId);
    res.json({ ...result, message: 'Meeting deleted successfully' });
  } catch (error) {
    if (error.message === 'Meeting not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getMeetingTranscriptController = async (req, res, next) => {
  try {
    const meeting = await getMeeting(req.params.id, req.user.userId, req.user.role);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const transcript = await getMeetingTranscript(req.params.id);
    res.json({ success: true, data: transcript });
  } catch (error) {
    next(error);
  }
};

export const getGoogleAuthUrlController = async (req, res, next) => {
  try {
    const authUrl = getGoogleAuthUrl(req.user.userId);
    res.json({ success: true, data: { authUrl } });
  } catch (error) {
    next(error);
  }
};

export const googleOAuthCallbackController = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Authorization code is required' });
    }

    const userId = await verifyGoogleOAuthState(state);
    const result = await exchangeGoogleAuthCode(code);
    await storeGoogleOAuthAccount(userId, result);

    res.json({ success: true, message: 'Google account connected', data: { email: result.email } });
  } catch (error) {
    next(error);
  }
};

export const requestMeetingTranscriptController = async (req, res, next) => {
  try {
    const meeting = await getMeeting(req.params.id, req.user.userId, req.user.role);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    const { driveFileId, language = 'en' } = req.body;
    if (typeof driveFileId !== 'string' || !/^[\w-]{10,}$/.test(driveFileId)) {
      return res.status(400).json({ success: false, message: 'A valid Google Drive recording file ID is required' });
    }

    const { queueJob } = await import('../../../jobs/index.js');
    const jobId = await queueJob('generateTranscript', {
      meetingId: meeting.id,
      driveFileId,
      language
    });

    res.status(202).json({ success: true, message: 'Transcript job queued', data: { jobId } });
  } catch (error) {
    next(error);
  }
};