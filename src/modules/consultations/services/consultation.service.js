// Consultation Service
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Get consultation type configurations
export const getConsultationTypes = async () => {
  return [
    { id: 'VIDEO', name: 'Video Consultation', duration: 60 },
    { id: 'AUDIO', name: 'Audio Call', duration: 45 },
    { id: 'CHAT', name: 'Chat Session', duration: 30 },
    { id: 'IN_PERSON', name: 'In Person', duration: 90 }
  ];
};

// Get consultations for a booking
export const getConsultationByBooking = async (bookingId, userId, role) => {
  const consultation = await prisma.consultation.findUnique({
    where: { bookingId: bookingId }
  });

  if (!consultation) {
    return null;
  }

  // Check authorization
  if (role === 'ADMIN') {
    return consultation;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  });

  if (!booking) {
    return null;
  }

  if (userId === booking.userId ||
      booking.astrologerId === (await prisma.astrologerProfile.findUnique({
        where: { userId: userId }
      }))?.id) {
    return consultation;
  }

  return null;
};

// Create consultation
export const createConsultation = async (data) => {
  const consultation = await prisma.consultation.create({
    data: {
      bookingId: data.bookingId,
      type: data.type,
      topics: data.topics || [],
      recommendations: data.recommendations || [],
      durationMinutes: data.durationMinutes || 60
    }
  });

  return consultation;
};

// Update consultation
export const updateConsultation = async (consultationId, userId, data) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId }
  });

  if (!consultation) {
    throw new Error('Consultation not found');
  }

  // Check if user is authorized (customer or astrologer)
  const booking = await prisma.booking.findUnique({
    where: { id: consultation.bookingId }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: userId }
  });

  const isAuthorized =
    userId === booking.userId ||
    (astrologer && booking.astrologerId === astrologer.id);

  if (!isAuthorized) {
    throw new Error('Not authorized');
  }

  return await prisma.consultation.update({
    where: { id: consultationId },
    data: {
      type: data.type,
      topics: data.topics,
      recommendations: data.recommendations,
      notes: data.notes,
      durationMinutes: data.durationMinutes
    }
  });
};

// Get recent consultations for astrologer
export const getAstrologerConsultations = async (astrologerUserId, page = 1, limit = 20) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: astrologerUserId }
  });

  if (!astrologer) {
    throw new Error('Astrologer not found');
  }

  const skip = (page - 1) * limit;

  const consultations = await prisma.consultation.findMany({
    where: {
      booking: { astrologerId: astrologer.id }
    },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      }
    }
  });

  const total = await prisma.consultation.count({
    where: {
      booking: { astrologerId: astrologer.id }
    }
  });

  return {
    data: consultations,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get recent consultations for customer
export const getCustomerConsultations = async (customerId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const consultations = await prisma.consultation.findMany({
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

  const total = await prisma.consultation.count({
    where: {
      booking: { userId: customerId }
    }
  });

  return {
    data: consultations,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};