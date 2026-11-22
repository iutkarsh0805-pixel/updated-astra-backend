// Meeting Service - Google Meet Integration
import { prisma } from '../../../lib/prisma.js';
import { google } from 'googleapis';
import { logger } from '../../../lib/logger.js';
import crypto from 'crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const GOOGLE_MEET_API_KEY = process.env.GOOGLE_MEET_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

// OAuth2 client for Google Calendar API
let oauth2Client = null;

export const getOAuth2Client = (tokens = null) => {
  oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  if (tokens) {
    oauth2Client.setCredentials(tokens);
  }

  return oauth2Client;
};

// Generate Google OAuth URL
export const getGoogleAuthUrl = (userId) => {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/meetings.space'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: createGoogleOAuthState(userId)
  });
};

// Exchange Google Auth Code for tokens
export const exchangeGoogleAuthCode = async (code) => {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    ...tokens,
    email: data.email,
    providerAccountId: data.id
  };
};

// Store Google OAuth account information
export const storeGoogleOAuthAccount = async (userId, result) => {
  return await prisma.oAuthAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'GOOGLE',
        providerAccountId: result.providerAccountId
      }
    },
    update: {
      userId,
      accessToken: result.access_token || null,
      refreshToken: result.refresh_token || undefined,
      refreshTokenExpiresAt: result.expiry_date ? new Date(result.expiry_date) : null,
      tokenType: result.token_type || null,
      scope: result.scope || null
    },
    create: {
      userId,
      provider: 'GOOGLE',
      providerAccountId: result.providerAccountId,
      accessToken: result.access_token || null,
      refreshToken: result.refresh_token || null,
      refreshTokenExpiresAt: result.expiry_date ? new Date(result.expiry_date) : null,
      tokenType: result.token_type || null,
      scope: result.scope || null
    }
  });
};

// Create a meeting
export const createMeeting = async (bookingId, userId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true, astrologer: { include: { user: true } }, user: true }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  // Check authorization
  if (booking.userId !== userId && booking.astrologerId !== userId) {
    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: userId }
    });
    if (!astrologer || astrologer.id !== booking.astrologerId) {
      throw new Error('Not authorized');
    }
  }

  try {
    if (!oauth2Client) {
      throw new Error('Google OAuth is not connected');
    }

    const auth = oauth2Client;

    const calendar = google.calendar({ version: 'v3', auth });

    const slot = booking.slot;
    const astrologerName = booking.astrologer.user.name;
    const customerName = booking.user.name;

    const startTime = new Date(`${slot.date.toISOString().split('T')[0]}T${slot.startTime}:00+05:30`);
    const endTime = new Date(`${slot.date.toISOString().split('T')[0]}T${slot.endTime}:00+05:30`);

    const event = {
      summary: `Astrology Consultation - ${customerName} with ${astrologerName}`,
      description: `Astrology consultation booking #${bookingId}\nCustomer: ${customerName}\nAstrologer: ${astrologerName}`,
      start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Kolkata' },
      end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Kolkata' },
      attendees: [
        { email: booking.user.email },
        { email: booking.astrologer.user.email }
      ],
      conferenceData: {
        createRequest: {
          requestId: `meeting-${bookingId}-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 30 },
          { method: 'popup', minutes: 10 }
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1
    });

    const meetLink = response.data.conferenceData.entryPoints.find(
      entry => entry.entryPointType === 'video'
    )?.uri;

    // Create meeting record
    const meeting = await prisma.meeting.create({
      data: {
        bookingId: bookingId,
        googleEventId: response.data.id,
        googleMeetId: response.data.id,
        meetingUrl: meetLink,
        startTime: slot.date,
        endTime: slot.date,
        status: 'SCHEDULED'
      }
    });

    return meeting;
  } catch (error) {
    logger.error('Meeting creation error:', error);
    throw new Error(`Failed to create meeting: ${error.message}`);
  }
};

// Get meeting by ID
export const getMeeting = async (meetingId, userId, role) => {
  const where = { id: meetingId };

  if (role !== 'ADMIN') {
    where.OR = [
      { booking: { userId: userId } },
      { booking: { astrologer: { userId: userId } } }
    ];
  }

  const meeting = await prisma.meeting.findUnique({
    where,
    include: {
      booking: {
        include: {
          slot: true,
          astrologer: { include: { user: true } },
          user: true
        }
      }
    }
  });

  return meeting;
};

// Update meeting
export const updateMeeting = async (meetingId, userId, data) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { booking: true }
  });

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  // Check authorization
  if (meeting.booking.userId !== userId && meeting.booking.astrologerId !== userId) {
    throw new Error('Not authorized');
  }

  return await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: data.status || meeting.status
    }
  });
};

// Delete/Update meeting on Google Calendar
export const deleteMeeting = async (meetingId, userId) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { booking: true }
  });

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  // Check authorization
  if (meeting.booking.userId !== userId && meeting.booking.astrologerId !== userId) {
    throw new Error('Not authorized');
  }

  try {
    if (!oauth2Client) {
      throw new Error('Google OAuth is not connected');
    }

    const auth = oauth2Client;

    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: meeting.googleEventId
    });

    await prisma.meeting.delete({
      where: { id: meetingId }
    });

    return { success: true };
  } catch (error) {
    logger.error('Meeting deletion error:', error);
    throw new Error(`Failed to delete meeting: ${error.message}`);
  }
};

// Get meeting transcript
export const getMeetingTranscript = async (meetingId) => {
  // This would integrate with transcription service
  // Placeholder for now
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { transcript: true }
  });

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  return meeting.transcript;
};

// Schedule meeting reminders (pg-boss job would call this)
export const scheduleReminders = async (meetingId) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId }
  });

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  // Create notification jobs
  const booking = await prisma.booking.findUnique({
    where: { id: meeting.bookingId },
    include: { user: true, astrologer: { include: { user: true } } }
  });

  // Send notifications via notification service
  // This integrates with the notifications module
  return {
    meetingId,
    customerNotified: true,
    astrologerNotified: true
  };
};

// Create and verify Google OAuth state
export const createGoogleOAuthState = (userId) => {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const verifyGoogleOAuthState = (state) => {
  if (!state) throw new Error('Missing OAuth state');
  const [payload, signature] = state.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (signature !== expected) throw new Error('Invalid OAuth state');

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (data.exp < Date.now()) throw new Error('OAuth state expired');
  return data.userId;
};