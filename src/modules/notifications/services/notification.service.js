// Notification Service
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { sendEmail } from '../../../lib/email.js';

// Create notification
export const createNotification = async (data) => {
  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      data: data.data || {},
      channel: data.channel || data.channels?.[0] || 'EMAIL'
    }
  });

  if (notification.channel === 'EMAIL') {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true }
    });

    if (user?.email) {
      const result = await sendEmail({
        to: user.email,
        subject: data.title,
        text: data.message
      }).catch(error => {
        logger.error('Notification email delivery failed', { error: error.message });
        return { delivered: false };
      });

      logger.info('Notification email delivery result', { delivered: result.delivered });
    }
  }

  return notification;
};

// Get user's notifications
export const getUserNotifications = async (userId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const notifications = await prisma.notification.findMany({
    where: { userId: userId },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' }
  });

  const total = await prisma.notification.count({
    where: { userId: userId }
  });

  return {
    data: notifications,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get unread count
export const getUnreadCount = async (userId) => {
  return await prisma.notification.count({
    where: {
      userId: userId,
      isRead: false
    }
  });
};

// Mark notification as read
export const markAsRead = async (notificationId, userId) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification) {
    throw new Error('Notification not found');
  }

  if (notification.userId !== userId) {
    throw new Error('Not authorized');
  }

  return await prisma.notification.update({
    where: { id: notificationId },
    data: {
      readAt: new Date(),
      isRead: true
    }
  });
};

// Mark all as read
export const markAllAsRead = async (userId) => {
  return await prisma.notification.updateMany({
    where: {
      userId: userId,
      isRead: false
    },
    data: {
      readAt: new Date(),
      isRead: true
    }
  });
};

// Send booking confirmation
export const sendBookingConfirmation = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: true,
      astrologer: { include: { user: true } },
      slot: true
    }
  });

  if (!booking) return;

  // Customer notification
  await createNotification({
    userId: booking.userId,
    type: 'BOOKING_CONFIRMED',
    title: 'Booking Confirmed',
    message: `Your booking with ${booking.astrologer.user.name} for ${booking.slot.date} has been confirmed.`,
    data: { bookingId: booking.id },
    channels: ['EMAIL', 'PUSH']
  });

  // Astrologer notification
  await createNotification({
    userId: booking.astrologer.user.id,
    type: 'NEW_BOOKING',
    title: 'New Booking Request',
    message: `${booking.user.name} has booked your service.`,
    data: { bookingId: booking.id },
    channels: ['EMAIL', 'PUSH', 'SMS']
  });
};

// Send payment confirmation
export const sendPaymentConfirmation = async (paymentId) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { include: { user: true, astrologer: { include: { user: true } } } } }
  });

  if (!payment) return;

  // Customer notification
  await createNotification({
    userId: payment.booking.userId,
    type: 'PAYMENT_CONFIRMED',
    title: 'Payment Confirmed',
    message: `Your payment of ₹${payment.amount} has been successfully processed.`,
    data: { paymentId: payment.id, bookingId: payment.bookingId },
    channels: ['EMAIL', 'PUSH']
  });

  // Astrologer notification
  await createNotification({
    userId: payment.booking.astrologer.user.id,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment Received',
    message: `You received ₹${payment.amount} for booking #${payment.bookingId}.`,
    data: { paymentId: payment.id, bookingId: payment.bookingId },
    channels: ['EMAIL', 'PUSH']
  });
};

// Send meeting reminder
export const sendMeetingReminder = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      slot: true,
      meeting: true,
      user: true,
      astrologer: { include: { user: true } }
    }
  });

  if (!booking || !booking.meeting) return;

  const meetingTime = booking.meeting.startTime;
  const timeUntil = Math.floor((meetingTime.getTime() - Date.now()) / (1000 * 60));

  // Customer reminder
  await createNotification({
    userId: booking.userId,
    type: 'MEETING_REMINDER',
    title: 'Meeting Reminder',
    message: `Your consultation with ${booking.astrologer.user.name} is in ${timeUntil > 0 ? '30 minutes' : 'today'}.`,
    data: {
      meetingId: booking.meeting?.id || booking.id,
      meetingUrl: booking.meeting?.googleMeetId,
      time: meetingTime
    },
    channels: ['EMAIL', 'PUSH', 'SMS']
  });

  // Astrologer reminder
  await createNotification({
    userId: booking.astrologer.user.id,
    type: 'MEETING_REMINDER',
    title: 'Meeting Reminder',
    message: `${booking.user.name} is joining your consultation in 30 minutes.`,
    data: {
      bookingId: booking.id,
      meetingUrl: booking.meeting?.googleMeetId
    },
    channels: ['EMAIL', 'PUSH', 'SMS']
  });
};