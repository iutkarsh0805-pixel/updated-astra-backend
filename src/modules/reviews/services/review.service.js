// Review Service
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Create a review
export const createReview = async (data) => {
  const { bookingId, rating, comment, customerId } = data;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      astrologer: true,
      user: true
    }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  // Check if payment is completed
  const payment = booking.payment;
  if (!payment || payment.status !== 'SUCCESS') {
    throw new Error('Can only review after payment is completed');
  }

  // Check customer owns the booking
  if (customerId !== booking.userId) {
    throw new Error('Not authorized to review this booking');
  }

  // Check if review already exists
  const existingReview = await prisma.review.findUnique({
    where: { bookingId: bookingId }
  });

  if (existingReview) {
    throw new Error('Review already exists for this booking');
  }

  const review = await prisma.review.create({
    data: {
      bookingId: bookingId,
      userId: customerId,
      astrologerId: booking.astrologerId,
      rating: rating,
      comment: comment || '',
      serviceId: booking.serviceId
    },
    include: {
      user: true,
      astrologer: { include: { user: true } },
      service: true
    }
  });

  // Update astrologer's average rating
  await updateAstrologerRating(booking.astrologerId);

  return review;
};

// Update astrologer's average rating
const updateAstrologerRating = async (astrologerId) => {
  const avgRating = await prisma.review.aggregate({
    where: { astrologerId },
    _avg: { rating: true }
  });

  const reviewCount = await prisma.review.count({
    where: { astrologerId }
  });

  await prisma.astrologerProfile.update({
    where: { id: astrologerId },
    data: {
      rating: avgRating._avg.rating || 0,
      totalConsults: reviewCount
    }
  });
};

// Get reviews for an astrologer
export const getReviewsByAstrologer = async (astrologerId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const reviews = await prisma.review.findMany({
    where: { astrologerId: astrologerId },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
      service: true
    }
  });

  const total = await prisma.review.count({
    where: { astrologerId: astrologerId }
  });

  return {
    data: reviews,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get my reviews
export const getMyReviews = async (customerId) => {
  return await prisma.review.findMany({
    where: { userId: customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      astrologer: { include: { user: true } },
      service: true,
      booking: { select: { slot: true } }
    }
  });
};

// Get review by ID
export const getReviewById = async (reviewId) => {
  return await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      user: true,
      astrologer: { include: { user: true } },
      service: true,
      booking: true
    }
  });
};

// Update review
export const updateReview = async (reviewId, customerId, data) => {
  const review = await prisma.review.findUnique({
    where: { id: reviewId }
  });

  if (!review) {
    throw new Error('Review not found');
  }

  if (review.userId !== customerId) {
    throw new Error('Not authorized to update this review');
  }

  const updatedReview = await prisma.review.update({
    where: { id: reviewId },
    data: {
      rating: data.rating ? data.rating : undefined,
      comment: data.comment
    }
  });

  return updatedReview;
};

// Delete review
export const deleteReview = async (reviewId, customerId) => {
  const review = await prisma.review.findUnique({
    where: { id: reviewId }
  });

  if (!review) {
    throw new Error('Review not found');
  }

  if (review.userId !== customerId) {
    throw new Error('Not authorized to delete this review');
  }

  // Update astrologer's rating after deletion
  await updateAstrologerRating(review.astrologerId);

  await prisma.review.delete({
    where: { id: reviewId }
  });

  return { success: true };
};