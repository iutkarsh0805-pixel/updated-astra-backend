// Transcript Controllers
import {
  getTranscriptByMeeting,
  upsertTranscript,
  getTranscriptsByBooking,
  getCustomerTranscripts,
  getAstrologerTranscripts,
  getTranscriptContent
} from '../services/transcript.service.js';

export const getTranscriptByMeetingController = async (req, res, next) => {
  try {
    const transcript = await getTranscriptByMeeting(
      req.params.meetingId,
      req.user.userId,
      req.user.role
    );

    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcript not found or access denied'
      });
    }

    res.json({ success: true, data: transcript });
  } catch (error) {
    next(error);
  }
};

export const upsertTranscriptController = async (req, res, next) => {
  try {
    const transcript = await upsertTranscript(req.body);
    res.status(201).json({
      success: true,
      message: 'Transcript saved',
      data: transcript
    });
  } catch (error) {
    next(error);
  }
};

export const getTranscriptsByBookingController = async (req, res, next) => {
  try {
    const transcripts = await getTranscriptsByBooking(
      req.params.bookingId,
      req.user.userId,
      req.user.role
    );

    res.json({ success: true, data: transcripts });
  } catch (error) {
    if (error.message === 'Booking not found' || error.message === 'Not authorized') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getCustomerTranscriptsController = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await getCustomerTranscripts(req.user.userId, page, limit);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getAstrologerTranscriptsController = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await getAstrologerTranscripts(req.user.userId, page, limit);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getTranscriptContentController = async (req, res, next) => {
  try {
    const transcript = await getTranscriptContent(
      req.params.transcriptId,
      req.user.userId,
      req.user.role
    );

    res.json({ success: true, data: transcript });
  } catch (error) {
    if (error.message === 'Transcript not found' || error.message === 'Not authorized') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};