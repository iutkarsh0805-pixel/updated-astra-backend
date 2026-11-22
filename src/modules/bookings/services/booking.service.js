// Booking Service
import { prisma } from '../../../lib/prisma.js';
import { createOrder, refundPayment } from '../../payments/services/payment.service.js';
import { scheduleBookingExpiration } from '../../../jobs/index.js';
import { logger } from '../../../lib/logger.js';

const slotStartsAt = (slot) => {
  const date = slot.date.toISOString().slice(0, 10);
  const time = String(slot.startTime).slice(0, 5);
  return new Date(`${date}T${time}:00+05:30`);
};

// Create a booking
export const createBooking = async (data) => {
  if (!data.slotId || !data.serviceId || !(data.customerId || data.userId)) {
    throw new Error('Slot, service, and customer are required');
  }

  const result = await prisma.$transaction(async (tx) => {
    const [slot, service] = await Promise.all([
      tx.slot.findUnique({ where: { id: data.slotId } }),
      tx.service.findUnique({ where: { id: data.serviceId } })
    ]);

    if (!slot) throw new Error('Slot not found');
    if (!service) throw new Error('Service not found');
    if (slotStartsAt(slot) <= new Date()) throw new Error('Cannot book past slot');

    const serviceLink = await tx.astrologerService.findUnique({
      where: {
        astrologerId_serviceId: {
          astrologerId: slot.astrologerId,
          serviceId: service.id
        }
      }
    });
    if (!serviceLink) throw new Error('Service is not offered by this astrologer');

    const reservation = await tx.slot.updateMany({
      where: { id: slot.id, status: 'AVAILABLE' },
      data: { status: 'RESERVED' }
    });
    if (reservation.count !== 1) throw new Error('Slot already booked');

    const amount = serviceLink.price ?? service.price;
    const booking = await tx.booking.create({
      data: {
        userId: data.customerId || data.userId,
        serviceId: service.id,
        astrologerId: slot.astrologerId,
        slotId: slot.id,
        status: 'PENDING',
        notes: data.notes || null
      }
    });

    const order = await createOrder(amount, 'INR', booking.id);
    const payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        userId: booking.userId,
        serviceId: service.id,
        razorpayOrderId: order.id,
        amount,
        currency: 'INR',
        status: 'PENDING'
      }
    });

    return { booking, payment };
  });

  try {
    await scheduleBookingExpiration(result.booking.id, result.payment.id);
  } catch (error) {
    logger.error('Failed to schedule booking expiration', { bookingId: result.booking.id, error: error.message });
  }

  return result.booking;
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
      payment: true,
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
        payment: true
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
      payment: true
    }
  });
};

// Cancel a booking
export const cancelBooking = async (bookingId, userId, reason = null) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true }
  });

  if (!booking) throw new Error('Booking not found');

  if (booking.userId !== userId) {
    const astrologer = await prisma.astrologerProfile.findUnique({ where: { userId } });
    if (!astrologer || booking.astrologerId !== astrologer.id) {
      throw new Error('Not authorized to cancel this booking');
    }
  }

  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
    throw new Error('Cannot cancel booking in current status');
  }

  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELLED', cancellationReason: reason }
    });
    if (changed.count !== 1) throw new Error('Cannot cancel booking in current status');

    await tx.slot.updateMany({
      where: { id: booking.slotId, status: { in: ['RESERVED', 'BOOKED'] } },
      data: { status: 'AVAILABLE' }
    });

    let refund = null;
    if (booking.payment?.status === 'PENDING') {
      await tx.payment.update({ where: { id: booking.payment.id }, data: { status: 'FAILED' } });
    } else if (booking.payment?.status === 'SUCCESS') {
      refund = await tx.refund.create({
        data: {
          paymentId: booking.payment.id,
          amount: booking.payment.amount,
          currency: booking.payment.currency,
          status: 'PENDING',
          reason: reason || 'Booking cancelled'
        }
      });
      await tx.payment.update({
        where: { id: booking.payment.id },
        data: { refundStatus: 'PENDING', refundAmount: booking.payment.amount }
      });
    }

    return { booking: await tx.booking.findUnique({ where: { id: bookingId } }), refund };
  });

  if (result.refund && booking.payment?.razorpayPaymentId) {
    try {
      const providerRefund = await refundPayment(booking.payment.razorpayPaymentId, result.refund.amount);
      await prisma.refund.update({
        where: { id: result.refund.id },
        data: { razorpayRefundId: providerRefund.id }
      });
    } catch (error) {
      logger.error('Cancellation refund request failed', { bookingId, error: error.message });
      await prisma.refund.update({
        where: { id: result.refund.id },
        data: { status: 'FAILED', errorMessage: error.message }
      });
      await prisma.payment.update({
        where: { id: booking.payment.id },
        data: { refundStatus: 'FAILED' }
      });
    }
  }

  return result.booking;
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
  return await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true }
    });

    if (!booking) throw new Error('Booking not found');
    if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
      throw new Error('Cannot reschedule booking in current status');
    }

    if (booking.userId !== userId) {
      const astrologer = await tx.astrologerProfile.findUnique({ where: { userId } });
      if (!astrologer || booking.astrologerId !== astrologer.id) {
        throw new Error('Not authorized to reschedule this booking');
      }
    }

    const newSlot = await tx.slot.findUnique({ where: { id: newSlotId } });
    if (!newSlot) throw new Error('New slot not found');
    if (slotStartsAt(newSlot) <= new Date()) throw new Error('Cannot book past slot');

    const serviceLink = await tx.astrologerService.findUnique({
      where: {
        astrologerId_serviceId: {
          astrologerId: newSlot.astrologerId,
          serviceId: booking.serviceId
        }
      }
    });
    if (!serviceLink) throw new Error('Service is not offered by the new astrologer');

    const reservation = await tx.slot.updateMany({
      where: { id: newSlotId, status: 'AVAILABLE' },
      data: { status: booking.payment?.status === 'SUCCESS' ? 'BOOKED' : 'RESERVED' }
    });
    if (reservation.count !== 1) throw new Error('New slot is not available');

    await tx.slot.updateMany({
      where: { id: booking.slotId, status: { in: ['RESERVED', 'BOOKED'] } },
      data: { status: 'AVAILABLE' }
    });

    return await tx.booking.update({
      where: { id: bookingId },
      data: {
        slotId: newSlotId,
        astrologerId: newSlot.astrologerId,
        status: booking.payment?.status === 'SUCCESS' ? 'CONFIRMED' : 'PENDING'
      }
    });
  });
};