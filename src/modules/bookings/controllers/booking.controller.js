// Booking Controllers
import { createBooking, getBooking, getUserBookings, cancelBooking, completeBooking, rescheduleBooking } from '../services/booking.service.js';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

export const createBookingController = async (req, res, next) => {
  try {
    const booking = await createBooking({
      slotId: req.body.slotId,
      serviceId: req.body.serviceId,
      customerId: req.user.userId,
      amount: req.body.amount,
      consultationType: req.body.consultationType,
      notes: req.body.notes
    });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking
    });
  } catch (error) {
    if (error.message.includes('Slot')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getBookingController = async (req, res, next) => {
  try {
    const booking = await getBooking(req.params.id, req.user.userId, req.user.role);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const listMyBookings = async (req, res, next) => {
  try {
    const bookings = await getUserBookings(req.user.userId, req.user.role);

    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    next(error);
  }
};

export const cancelBookingController = async (req, res, next) => {
  try {
    const booking = await cancelBooking(req.params.id, req.user.userId, req.body.reason);

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: booking
    });
  } catch (error) {
    if (error.message === 'Booking not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message.includes('Cannot cancel')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const completeBookingController = async (req, res, next) => {
  try {
    // Verify astrologer owns this booking
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: req.user.userId }
    });

    if (!astrologer || booking.astrologerId !== astrologer.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updatedBooking = await completeBooking(req.params.id);

    const { queueJob } = await import('../../../jobs/index.js');
    await queueJob('generateReport', { bookingId: updatedBooking.id }).catch(error => {
      logger.error('Failed to queue report generation', { bookingId: updatedBooking.id, error: error.message });
    });

    res.json({
      success: true,
      message: 'Booking completed successfully',
      data: updatedBooking
    });
  } catch (error) {
    next(error);
  }
};

export const rescheduleBookingController = async (req, res, next) => {
  try {
    const booking = await rescheduleBooking(req.params.id, req.body.newSlotId, req.user.userId);

    res.json({
      success: true,
      message: 'Booking rescheduled successfully',
      data: booking
    });
  } catch (error) {
    if (error.message === 'Booking not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message.includes('not available') || error.message.includes('Cannot')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};