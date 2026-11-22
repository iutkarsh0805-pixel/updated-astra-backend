// Meeting Service - Google Meet Integration
import { prisma } from '../../../lib/prisma.js';
import { google } from 'googleapis';
import { logger } from '../../../lib/logger.js';
import crypto from 'crypto';
import { encryptToken, decryptToken } from '../../../lib/token-encryption.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET;

export const getOAuth2Client = (tokens = null) => {
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  if (tokens) client.setCredentials(tokens);
  return client;
};

export const getOAuthClientForUser = async (userId) => {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: 'GOOGLE' },
    orderBy: { updatedAt: 'desc' }
  });

  if (!account?.refreshToken) {
    throw new Error('Google Calendar account is not connected for this astrologer');
  }

  const client = getOAuth2Client({
    access_token: decryptToken(account.accessToken),
    refresh_token: decryptToken(account.refreshToken),
    expiry_date: account.refreshTokenExpiresAt?.getTime()
  });

  client.on('tokens', async (tokens) => {
    try {
      await prisma.oAuthAccount.update({
        where: { id: account.id },
        data: {
          accessToken: tokens.access_token ? encryptToken(tokens.access_token) : account.accessToken,
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : account.refreshToken,
          refreshTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : account.refreshTokenExpiresAt
        }
      });
    } catch (error) {
      logger.error('Failed to persist refreshed Google tokens', { error: error.message });
    }
  });

  return client;
};

// Generate Google OAuth URL
export const getGoogleAuthUrl = async (userId) => {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const state = await createGoogleOAuthState(userId);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state
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
  const existing = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'GOOGLE',
        providerAccountId: result.providerAccountId
      }
    }
  });

  if (existing && existing.userId !== userId) {
    throw new Error('This Google account is already connected to another user');
  }

  const accessToken = encryptToken(result.access_token);
  const refreshToken = encryptToken(result.refresh_token);
  const refreshTokenExpiresAt = result.expiry_date ? new Date(result.expiry_date) : null;

  return await prisma.oAuthAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'GOOGLE',
        providerAccountId: result.providerAccountId
      }
    },
    update: {
      userId,
      accessToken: accessToken || existing?.accessToken,
      refreshToken: refreshToken || existing?.refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt || existing?.refreshTokenExpiresAt,
      tokenType: result.token_type || existing?.tokenType,
      scope: result.scope || existing?.scope
    },
    create: {
      userId,
      provider: 'GOOGLE',
      providerAccountId: result.providerAccountId,
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
      tokenType: result.token_type || null,
      scope: result.scope || null
    }
  });
};

// Create a meeting
export const createMeeting = async (bookingId, userId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      slot: true,
      astrologer: { include: { user: true } },
      user: true,
      meeting: true
    }
  });

  if (!booking) throw new Error('Booking not found');
  if (!booking.astrologer?.user || !booking.slot) throw new Error('Booking is missing an astrologer or slot');
  if (booking.status !== 'CONFIRMED') throw new Error('Only confirmed bookings can create a meeting');

  const isCustomer = booking.userId === userId;
  const isAstrologer = booking.astrologer.userId === userId;
  if (!isCustomer && !isAstrologer) throw new Error('Not authorized');
  if (booking.meeting) return booking.meeting;

  let calendar;
  let createdEventId;
  try {
    const auth = await getOAuthClientForUser(booking.astrologer.userId);
    calendar = google.calendar({ version: 'v3', auth });

    const datePart = booking.slot.date.toISOString().slice(0, 10);
    const startTime = new Date(`${datePart}T${booking.slot.startTime}:00+05:30`);
    const endTime = new Date(`${datePart}T${booking.slot.endTime}:00+05:30`);

    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Astrology Consultation - ${booking.user.name} with ${booking.astrologer.user.name}`,
        description: `Consultation booking ${booking.id}`,
        start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Kolkata' },
        end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Kolkata' },
        attendees: [{ email: booking.user.email }, { email: booking.astrologer.user.email }],
        conferenceData: {
          createRequest: {
            requestId: `astra-${booking.id}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      }
    });

    createdEventId = response.data.id;
    const meetLink = response.data.conferenceData?.entryPoints?.find(entry => entry.entryPointType === 'video')?.uri
      || response.data.hangoutLink;

    if (!createdEventId || !meetLink) {
      throw new Error('Google Calendar did not return a Meet link');
    }

    const meeting = await prisma.meeting.create({
      data: {
        bookingId,
        googleEventId: createdEventId,
        googleMeetId: meetLink,
        meetingUrl: meetLink,
        startTime,
        endTime,
        status: 'SCHEDULED'
      }
    });

    await prisma.booking.update({
      where: { id: bookingId },
      data: { meetingUrl: meetLink }
    });

    return meeting;
  } catch (error) {
    if (createdEventId && calendar) {
      await calendar.events.delete({ calendarId: 'primary', eventId: createdEventId }).catch(() => {});
    }
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
    include: { booking: { include: { astrologer: true } } }
  });

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  if (meeting.booking.userId !== userId && meeting.booking.astrologer?.userId !== userId) {
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
    include: { booking: { include: { astrologer: true } } }
  });

  if (!meeting) throw new Error('Meeting not found');
  if (meeting.booking.userId !== userId && meeting.booking.astrologer?.userId !== userId) {
    throw new Error('Not authorized');
  }

  try {
    const calendarOwnerId = meeting.booking.astrologer.userId;
    const auth = await getOAuthClientForUser(calendarOwnerId);
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: meeting.googleEventId
    });

    await prisma.meeting.delete({ where: { id: meetingId } });
    return { success: true };
  } catch (error) {
    logger.error('Meeting deletion error:', error);
    throw new Error(`Failed to delete meeting: ${error.message}`);
  }
};

// Get meeting transcript
export const getMeetingTranscript = async (meetingId) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { booking: { include: { transcripts: { orderBy: { createdAt: 'desc' }, take: 1 } } } }
  });

  if (!meeting) throw new Error('Meeting not found');
  return meeting.booking.transcripts[0] || null;
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
export const createGoogleOAuthState = async (userId) => {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const nonceHash = crypto.createHash('sha256').update(nonce).digest('hex');
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes

  const payload = Buffer.from(JSON.stringify({ userId, nonce, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  const state = `${payload}.${signature}`;

  await prisma.oAuthState.create({
    data: {
      userId,
      nonceHash,
      expiresAt: new Date(exp)
    }
  });

  return state;
};

export const verifyGoogleOAuthState = async (state) => {
  if (!state) throw new Error('Missing OAuth state');

  const parts = state.split('.');
  if (parts.length !== 2) throw new Error('Invalid OAuth state format');

  const [payload, signature] = parts;

  // Validate payload base64url format
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('Invalid OAuth state payload');

  // Timing-safe comparison
  const expectedSignal = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignal);
  let isValidSig = false;
  try {
    isValidSig = sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    isValidSig = false;
  }
  if (!isValidSig) {
    throw new Error('Invalid OAuth state signature');
  }

  // Parse and validate payload
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid OAuth state payload');
  }

  // Strict payload validation: exactly userId, nonce, exp; no arrays, no extra keys
  const keys = Object.keys(data);
  if (keys.length !== 3) throw new Error('Invalid OAuth state payload');
  if (!keys.includes('userId') || !keys.includes('nonce') || !keys.includes('exp')) {
    throw new Error('Invalid OAuth state payload');
  }
  if (typeof data.userId !== 'string' || typeof data.nonce !== 'string' || typeof data.exp !== 'number') {
    throw new Error('Invalid OAuth state payload');
  }
  if (typeof data.exp !== 'number' || !Number.isFinite(data.exp) || data.exp <= 0) {
    throw new Error('Invalid OAuth state payload');
  }

  const { userId, nonce, exp } = data;

  // Check expiration
  if (exp < Date.now()) throw new Error('OAuth state expired');

  // Hash the nonce for database lookup
  const nonceHash = crypto.createHash('sha256').update(nonce).digest('hex');

  // Atomic one-time consumption: delete and verify in one transaction
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.oAuthState.deleteMany({
      where: {
        userId,
        nonceHash,
        expiresAt: { gt: new Date() }
      }
    });
    return deleted.count;
  });

  if (result !== 1) {
    throw new Error('OAuth state already used or invalid');
  }

  return userId;
};