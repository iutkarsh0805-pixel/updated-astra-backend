// Booking Service
import { prisma } from '../../../lib/prisma.js';
import { reserveSlot } from '../../slots/services/slot.service.js';
import { createOrder } from '../../payments/services/payment.service.js';
import { logger } from '../../../lib/logger.js';

// Create a booking
export const createBooking = async (data) => {
  return await prisma.$transaction(async (tx) => {
    // Reserve the slot
    const slot = await tx.slot.findUnique({
      where: { id: data.slotId }
    });

    if (!slot) {
      throw new Error('Slot not found');
    }

    if (new Date(slot.date) < new Date()) {
      throw new Error('Cannot book past slot');
    }

    // Check if already booked
    const existingBooking = await tx.booking.findFirst({
      where: {
        slotId: data.slotId,
        OR: [
          { status: 'PENDING' },
          { status: 'CONFIRMED' }
        ]
      }
    });

    if (existingBooking) {
      throw new Error('Slot already booked');
    }

    // Validate service
    if (!data.slotId || !data.serviceId) {
      throw new Error('Slot and service are required');
    }

    const service = await tx.service.findUnique({
      where: { id: data.serviceId }
    });

    if (!service) {
      throw new Error('Service not found');
    }

    // Create booking
    const booking = await tx.booking.create({
      data: {
        userId: data.customerId || data.userId,
        serviceId: data.serviceId,
        astrologerId: slot.astrologerId,
        slotId: data.slotId,
        status: 'PENDING',
        notes: data.notes || null
      }
    });

    // Create payment order
    const order = await createOrder(data.amount || service.price, 'INR', booking.id);

    // Create payment record
    await tx.payment.create({
      data: {
        bookingId: booking.id,
        userId: data.customerId || data.userId,
        serviceId: data.serviceId,
        razorpayOrderId: order.id,
        amount: data.amount || service.price,
        currency: 'INR',
        status: 'PENDING'
      }
    });

    // Mark slot as unavailable
    await tx.slot.update({
      where: { id: data.slotId },
      data: { status: 'RESERVED' }
    });

    return booking;
  });
};

// Get booking by ID
export const getBooking = async (bookingId, userId, role) => {
  const where = { id: bookingId };

  if (role !== 'ADMIN') {
    where.OR = [
      { userId: userId },
      { astrologer: { userId: userId } }
    ];
  }

  const booking = await prisma.booking.findUnique({
    where,
    include: {
      slot: true,
      astrologer: {
        include: { user: true }
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true
        }
      },
      payments: true,
      meeting: true
    }
  });

  return booking;
};

// Get user's bookings
export const getUserBookings = async (userId, role) => {
  if (role === 'ASTROLOGER') {
    return await prisma.booking.findMany({
      where: { astrologer: { userId: userId } },
      orderBy: { createdAt: 'desc' },
      include: {
        slot: true,
        payments: true
      }
    });
  }

  return await prisma.booking.findMany({
    where: { userId: userId },
    orderBy: { createdAt: 'desc' },
    include: {
      slot: true,
      astrologer: {
        include: { user: true }
      },
      payments: true
    }
  });
};

// Cancel a booking
export const cancelBooking = async (bookingId, userId, reason = null) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  // Check authorization
  if (booking.userId !== userId) {
    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: userId }
    });
    if (!astrologer || booking.astrologerId !== astrologer.id) {
      throw new Error('Not authorized to cancel this booking');
    }
  }

  // Check if cancellable
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
    throw new Error('Cannot cancel booking in current status');
  }

  // Update booking status
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CANCELLED',
      cancellationReason: reason
    }
  });

  // Process refund if payment is captured
  const payment = booking.payments.find(p => p.status === 'SUCCESS');
  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED' }
    });

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'REFUNDED' }
    });
  }

  return updatedBooking;
};

// Mark booking as complete
export const completeBooking = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  if (booking.status !== 'CONFIRMED') {
    throw new Error('Cannot complete booking in current status');
  }

  return await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'COMPLETED' }
  });
};

// Reschedule booking
export const rescheduleBooking = async (bookingId, newSlotId, userId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  if (booking.userId !== userId && booking.status === 'CANCELLED') {
    throw new Error('Only the customer can reschedule');
  }

  // Check new slot availability
  const newSlot = await prisma.slot.findUnique({
    where: { id: newSlotId }
  });

  if (!newSlot || newSlot.status !== 'AVAILABLE') {
    throw new Error('New slot is not available');
  }

  const newBookingDate = new Date();
  if (new Date(newSlot.date) < newBookingDate) {
    throw new Error('Cannot book past slot');
  }

  // Check for existing booking on new slot
  const existingBooking = await prisma.booking.findFirst({
    where: {
      slotId: newSlotId,
      OR: [
        { status: 'PENDING' },
        { status: 'CONFIRMED' },
        { status: 'CONFIRMED' }
      ]
    }
  });

  if (existingBooking) {
    throw new Error('New slot is already booked');
  }

  // Restore old slot availability
  await prisma.slot.update({
    where: { id: booking.slotId },
    data: { status: 'AVAILABLE' }
  });

  // Update booking with new slot
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      slotId: newSlotId,
      astrologerId: newSlot.astrologerId,
      status: 'PENDING',
      isRescheduled: true
    }
  });

  // Mark new slot as unavailable
  await prisma.slot.update({
    where: { id: newSlotId },
    data: { status: 'RESERVED' }
  });

  return updatedBooking;
};