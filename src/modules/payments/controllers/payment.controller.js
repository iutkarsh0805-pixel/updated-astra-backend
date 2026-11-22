// Payment Controllers
import { createOrder, verifyPayment, getPaymentDetails, refundPayment, verifyWebhookSignature } from '../services/payment.service.js';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

export const createPaymentOrder = async (req, res, next) => {
  try {
    const { bookingId } = req.body;
    const userId = req.user.userId;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true, payment: true }
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.userId !== userId) return res.status(403).json({ success: false, message: 'Not authorized' });
    if (!['PENDING', 'EXPIRED'].includes(booking.status)) {
      return res.status(409).json({ success: false, message: 'Booking is not awaiting payment' });
    }

    const link = booking.astrologerId
      ? await prisma.astrologerService.findUnique({
          where: { astrologerId_serviceId: { astrologerId: booking.astrologerId, serviceId: booking.serviceId } }
        })
      : null;
    const amount = link?.price ?? booking.service.price;

    if (booking.payment?.status === 'PENDING') {
      return res.json({
        success: true,
        data: {
          orderId: booking.payment.razorpayOrderId,
          amount: Math.round(booking.payment.amount * 100),
          currency: booking.payment.currency,
          keyId: process.env.RAZORPAY_KEY_ID
        }
      });
    }

    const order = await createOrder(amount, 'INR', booking.id);
    const payment = booking.payment
      ? await prisma.payment.update({
          where: { id: booking.payment.id },
          data: { razorpayOrderId: order.id, razorpayPaymentId: null, amount, status: 'PENDING', refundStatus: 'NONE' }
        })
      : await prisma.payment.create({
          data: {
            bookingId: booking.id,
            userId,
            serviceId: booking.serviceId,
            razorpayOrderId: order.id,
            amount,
            currency: 'INR',
            status: 'PENDING'
          }
        });

    return res.json({
      success: true,
      data: { orderId: payment.razorpayOrderId, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID }
    });
  } catch (error) {
    logger.error('Create payment order error:', error);
    next(error);
  }
};

export const verifyPaymentWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const eventId = req.headers['x-razorpay-event-id'];
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    if (!signature) return res.status(400).json({ success: false, message: 'Missing signature' });
    if (!eventId) return res.status(400).json({ success: false, message: 'Missing event ID' });
    if (!verifyWebhookSignature(body, signature)) {
      logger.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const payload = JSON.parse(body.toString('utf8'));
    if (await prisma.webhookEvent.findUnique({ where: { eventId } })) {
      return res.json({ success: true, message: 'Webhook already processed' });
    }

    let lateCaptureRefund = null;
    let meetingJob = null;
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({ data: { eventId, eventType: payload.event } });
      switch (payload.event) {
        case 'payment.captured': {
          const captured = await handlePaymentCaptured(payload.payload.payment.entity, tx);
          lateCaptureRefund = captured?.refund || null;
          meetingJob = captured?.meeting || null;
          break;
        }
        case 'payment.failed':
          await handlePaymentFailed(payload.payload.payment.entity, tx);
          break;
        case 'refund.processed':
          await handleRefundProcessed(payload.payload.refund.entity, tx);
          break;
        default:
          logger.info('Ignoring unsupported Razorpay event', { eventType: payload.event });
      }
    });

    if (lateCaptureRefund) {
      try {
        const providerRefund = await refundPayment(lateCaptureRefund.razorpayPaymentId, lateCaptureRefund.amount);
        await prisma.refund.update({
          where: { id: lateCaptureRefund.refundId },
          data: { razorpayRefundId: providerRefund.id }
        });
      } catch (error) {
        logger.error('Automatic refund for late captured payment failed', { error: error.message });
        await prisma.refund.update({
          where: { id: lateCaptureRefund.refundId },
          data: { status: 'FAILED', errorMessage: error.message }
        });
        await prisma.payment.update({
          where: { id: lateCaptureRefund.paymentId },
          data: { refundStatus: 'FAILED' }
        });
      }
    }

    if (meetingJob) {
      try {
        const { queueJob } = await import('../../../jobs/index.js');
        await queueJob('createMeeting', meetingJob, { delay: 5000 });
      } catch (error) {
        logger.error('Failed to queue meeting creation', { bookingId: meetingJob.bookingId, error: error.message });
      }
    }

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.json({ success: true, message: 'Webhook already processed' });
    }
    logger.error('Webhook processing error:', error);
    next(error);
  }
};

async function handlePaymentCaptured(payment, tx = prisma) {
  const paymentRecord = await tx.payment.findFirst({
    where: {
      OR: [
        { razorpayPaymentId: payment.id },
        { razorpayOrderId: payment.order_id }
      ]
    }
  });

  if (!paymentRecord) {
    logger.warn('Captured payment record not found', { paymentId: payment.id, orderId: payment.order_id });
    return null;
  }
  if (Math.round(paymentRecord.amount * 100) !== payment.amount || paymentRecord.currency !== payment.currency) {
    throw new Error('Captured amount or currency does not match the stored order');
  }

  await tx.payment.update({
    where: { id: paymentRecord.id },
    data: { status: 'SUCCESS', razorpayPaymentId: payment.id }
  });

  if (!paymentRecord.bookingId) return null;
  const booking = await tx.booking.findUnique({
    where: { id: paymentRecord.bookingId },
    include: { astrologer: { select: { userId: true } } }
  });
  if (!booking) return null;

  if (booking.status === 'PENDING') {
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
    await tx.slot.update({ where: { id: booking.slotId }, data: { status: 'BOOKED' } });
    return booking.astrologer
      ? { meeting: { bookingId: booking.id, userId: booking.astrologer.userId } }
      : null;
  }

  if (!['CANCELLED', 'EXPIRED'].includes(booking.status)) return null;

  const existingRefund = await tx.refund.findUnique({ where: { paymentId: paymentRecord.id } });
  const refund = existingRefund || await tx.refund.create({
    data: {
      paymentId: paymentRecord.id,
      amount: paymentRecord.amount,
      currency: paymentRecord.currency,
      status: 'PENDING',
      reason: `Automatic refund for ${booking.status.toLowerCase()} booking`
    }
  });

  await tx.payment.update({
    where: { id: paymentRecord.id },
    data: { refundStatus: 'PENDING', refundAmount: paymentRecord.amount }
  });

  return {
    refund: {
      paymentId: paymentRecord.id,
      razorpayPaymentId: payment.id,
      amount: paymentRecord.amount,
      refundId: refund.id
    }
  };
}

async function handlePaymentFailed(payment, tx = prisma) {
  const paymentRecord = await tx.payment.findFirst({
    where: {
      OR: [
        { razorpayPaymentId: payment.id },
        { razorpayOrderId: payment.order_id }
      ]
    }
  });

  if (!paymentRecord) {
    logger.warn('Failed payment record not found', { paymentId: payment.id, orderId: payment.order_id });
    return;
  }

  await tx.payment.update({
    where: { id: paymentRecord.id },
    data: { status: 'FAILED', razorpayPaymentId: payment.id }
  });
}

async function handleRefundProcessed(refund, tx = prisma) {
  const paymentRecord = await tx.payment.findFirst({
    where: {
      OR: [
        { razorpayPaymentId: refund.payment_id },
        { razorpayOrderId: refund.order_id }
      ]
    }
  });

  if (!paymentRecord) {
    logger.warn('Refund payment record not found', { refundId: refund.id });
    return;
  }

  const refundAmount = refund.amount / 100;
  const isFullRefund = refundAmount >= paymentRecord.amount;

  await tx.payment.update({
    where: { id: paymentRecord.id },
    data: {
      status: isFullRefund ? 'REFUNDED' : 'SUCCESS',
      refundStatus: 'SUCCESS',
      refundAmount
    }
  });

  await tx.refund.upsert({
    where: { paymentId: paymentRecord.id },
    update: {
      razorpayRefundId: refund.id,
      amount: refundAmount,
      status: 'COMPLETED'
    },
    create: {
      paymentId: paymentRecord.id,
      razorpayRefundId: refund.id,
      amount: refundAmount,
      currency: paymentRecord.currency,
      status: 'COMPLETED'
    }
  });

  if (isFullRefund && paymentRecord.bookingId) {
    await tx.booking.update({
      where: { id: paymentRecord.bookingId },
      data: { status: 'REFUNDED' }
    });
  }
}

export const getPayment = async (req, res, next) => {
  try {
    const { paymentId = req.params.id } = req.params;
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: true }
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

export const getUserPayments = async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      include: { booking: { include: { astrologer: true } } }
    });

    res.json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
};

export const refundPaymentHandler = async (req, res, next) => {
  let refundRecord;
  try {
    const { paymentId = req.params.id } = req.params;
    const userId = req.user.userId;
    const refundAmount = req.body.amount;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: true }
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status !== 'SUCCESS' || !payment.razorpayPaymentId) {
      return res.status(400).json({ success: false, message: 'Only captured payments can be refunded' });
    }

    const astrologer = await prisma.astrologerProfile.findUnique({ where: { userId } });
    const ownsBooking = payment.booking?.userId === userId;
    const assignedAstrologer = astrologer && payment.booking?.astrologerId === astrologer.id;
    if (!ownsBooking && !assignedAstrologer && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const existing = await prisma.refund.findUnique({ where: { paymentId } });
    if (existing && ['PENDING', 'COMPLETED'].includes(existing.status)) {
      return res.status(409).json({ success: false, message: 'A refund is already pending or completed' });
    }

    const amount = refundAmount === undefined ? payment.amount : Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > payment.amount) {
      return res.status(400).json({ success: false, message: 'Refund amount is invalid' });
    }

    refundRecord = await prisma.refund.upsert({
      where: { paymentId },
      update: { amount, status: 'PENDING', reason: req.body.reason || null, errorMessage: null },
      create: { paymentId, amount, currency: payment.currency, status: 'PENDING', reason: req.body.reason || null }
    });

    const providerRefund = await refundPayment(payment.razorpayPaymentId, amount);

    await prisma.$transaction([
      prisma.refund.update({
        where: { id: refundRecord.id },
        data: { razorpayRefundId: providerRefund.id, status: 'PENDING' }
      }),
      prisma.payment.update({
        where: { id: paymentId },
        data: { refundStatus: 'PENDING', refundAmount: amount }
      })
    ]);

    return res.status(202).json({
      success: true,
      message: 'Refund requested; status will update when Razorpay confirms it',
      data: { refundId: refundRecord.id, status: 'PENDING' }
    });
  } catch (error) {
    logger.error('Refund processing error:', error);
    if (refundRecord) {
      await prisma.refund.update({
        where: { id: refundRecord.id },
        data: { status: 'FAILED', errorMessage: error.message }
      }).catch(() => {});
    }
    next(error);
  }
};