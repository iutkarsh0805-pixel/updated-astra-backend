// Transcript Service
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Get transcript for a meeting
export const getTranscriptByMeeting = async (meetingId, userId, role) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { booking: true }
  });

  if (!meeting) return null;
  if (role !== 'ADMIN') {
    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId }
    });
    const authorized = meeting.booking.userId === userId ||
      (astrologer && meeting.booking.astrologerId === astrologer.id);
    if (!authorized) return null;
  }

  return await prisma.transcript.findFirst({
    where: { bookingId: meeting.bookingId },
    orderBy: { createdAt: 'desc' }
  });
};

// Create or update transcript
export const upsertTranscript = async (data) => {
  const existing = await prisma.transcript.findFirst({
    where: { bookingId: data.bookingId },
    orderBy: { createdAt: 'desc' }
  });

  const wordCount = data.content?.split(/\s+/).filter(Boolean).length || 0;
  const transcriptData = {
    content: data.content || null,
    summary: data.summary || null,
    language: data.language || 'en',
    wordCount,
    status: data.status || 'READY',
    audioUrl: data.audioUrl || null,
    transcriptUrl: data.transcriptUrl || null
  };

  if (existing) {
    return await prisma.transcript.update({
      where: { id: existing.id },
      data: transcriptData
    });
  }

  return await prisma.transcript.create({
    data: { bookingId: data.bookingId, ...transcriptData }
  });
};

// Get transcripts by booking
export const getTranscriptsByBooking = async (bookingId, userId, role) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  // Check authorization
  if (role !== 'ADMIN') {
    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: userId }
    });

    const isAuthorized =
      userId === booking.userId ||
      (astrologer && booking.astrologerId === astrologer.id);

    if (!isAuthorized) {
      throw new Error('Not authorized');
    }
  }

  const transcripts = await prisma.transcript.findMany({
    where: { bookingId: bookingId },
    orderBy: { createdAt: 'desc' }
  });

  return transcripts;
};

// Get customer transcripts
export const getCustomerTranscripts = async (customerId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const transcripts = await prisma.transcript.findMany({
    where: {
      booking: { userId: customerId }
    },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          astrologer: { include: { user: true } },
          slot: true
        }
      }
    }
  });

  const total = await prisma.transcript.count({
    where: {
      booking: { userId: customerId }
    }
  });

  return {
    data: transcripts,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get astrologer transcripts
export const getAstrologerTranscripts = async (astrologerUserId, page = 1, limit = 20) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: astrologerUserId }
  });

  if (!astrologer) {
    throw new Error('Astrologer not found');
  }

  const skip = (page - 1) * limit;

  const transcripts = await prisma.transcript.findMany({
    where: {
      booking: { astrologerId: astrologer.id }
    },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          slot: true
        }
      }
    }
  });

  const total = await prisma.transcript.count({
    where: {
      booking: { astrologerId: astrologer.id }
    }
  });

  return {
    data: transcripts,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get transcript content (full text)
export const getTranscriptContent = async (transcriptId, userId, role) => {
  const transcript = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    include: {
      booking: {
        include: {
          user: true,
          astrologer: { include: { user: true } }
        }
      }
    }
  });

  if (!transcript) {
    throw new Error('Transcript not found');
  }

  // Check authorization
  if (role !== 'ADMIN') {
    const isOwner = userId === transcript.booking.userId;
    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: userId }
    });
    const isAstrologer = astrologer && transcript.booking.astrologerId === astrologer.id;

    if (!isOwner && !isAstrologer) {
      throw new Error('Not authorized');
    }
  }

  return transcript;
};