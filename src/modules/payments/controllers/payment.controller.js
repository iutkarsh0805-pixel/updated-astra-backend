// Payment Controllers
import { createOrder, verifyPayment, getPaymentDetails, refundPayment, verifyWebhookSignature } from '../services/payment.service.js';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

export const createPaymentOrder = async (req, res, next) => {
  try {
    const { amount, currency, bookingId, description } = req.body;
    const userId = req.user.userId;

    if (!amount || !bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Amount and booking ID are required'
      });
    }

    // Verify booking exists and belongs to user or astrologer
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { astrologer: true }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const order = await createOrder(amount || booking.serviceId ? amount : 0, currency, bookingId);

    // Create payment record
    await prisma.payment.create({
      data: {
        bookingId,
        userId,
        serviceId: booking.serviceId,
        razorpayOrderId: order.id,
        amount: amount || Number(order.amount) / 100,
        currency: currency || 'INR',
        status: 'PENDING',
        description
      }
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID
      }
    });
  } catch (error) {
    logger.error('Create payment order error:', error);
    next(error);
  }
};

export const verifyPaymentWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    if (!signature) {
      return res.status(400).json({ success: false, message: 'Missing signature' });
    }

    const isValid = verifyWebhookSignature(body, signature);

    if (!isValid) {
      logger.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const payload = JSON.parse(body.toString('utf8'));
    const { event } = payload;

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload.payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(payload.payload.payment.entity);
        break;
      case 'refund.processed':
        await handleRefundProcessed(payload.payload.refund.entity);
        break;
    }

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    next(error);
  }
};

async function handlePaymentCaptured(payment) {
  const paymentRecord = await prisma.payment.findFirst({
    where: { razorpayPaymentId: payment.id }
  });

  if (paymentRecord) {
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: 'SUCCESS',
        razorpayPaymentId: payment.id,
        updatedAt: new Date()
      }
    });

    // Update booking status
    await prisma.booking.update({
      where: { id: paymentRecord.bookingId },
      data: { status: 'CONFIRMED' }
    });
  }
}

async function handlePaymentFailed(payment) {
  const paymentRecord = await prisma.payment.findFirst({
    where: { razorpayPaymentId: payment.id }
  });

  if (paymentRecord) {
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: 'FAILED',
        updatedAt: new Date()
      }
    });
  }
}

async function handleRefundProcessed(refund) {
  const paymentRecord = await prisma.payment.findFirst({
    where: {
      OR: [
        { razorpayPaymentId: refund.payment_id },
        { razorpayOrderId: refund.order_id }
      ]
    }
  });

  if (paymentRecord) {
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: 'REFUNDED',
        updatedAt: new Date()
      }
    });

    // Update booking status
    await prisma.booking.update({
      where: { id: paymentRecord.bookingId },
      data: { status: 'REFUNDED' }
    });

    // Create refund record
    await prisma.refund.create({
      data: {
        paymentId: paymentRecord.id,
        razorpayRefundId: refund.id,
        amount: refund.amount / 100,
        currency: paymentRecord.currency,
        status: 'COMPLETED'
      }
    });
  }
}

export const getPayment = async (req, res, next) => {
  try {
    const { paymentId } = req.params;
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
  try {
    const { paymentId } = req.params;
    const userId = req.user.userId;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status !== 'SUCCESS') {
      return res.status(400).json({ success: false, message: 'Only successful payments can be refunded' });
    }

    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId }
    });

    if (
      payment.userId !== userId &&
      (!astrologer || payment.bookingId !== astrologer.id)
    ) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const refund = await prisma.refund.create({
      data: {
        paymentId,
        amount: payment.amount,
        currency: payment.currency,
        status: 'PENDING',
        razorpayRefundId: null
      }
    });

    try {
      const razorpayRefund = await refundPayment(payment.razorpayPaymentId);

      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          razorpayRefundId: razorpayRefund.id,
          status: 'COMPLETED'
        }
      });

      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'REFUNDED' }
      });

      res.json({ success: true, message: 'Refund processed', data: { refundId: refund.id } });
    } catch (error) {
      logger.error('Refund processing error:', error);
      await prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'FAILED', errorMessage: error.message }
      });
      next(error);
    }
  } catch (error) {
    next(error);
  }
};