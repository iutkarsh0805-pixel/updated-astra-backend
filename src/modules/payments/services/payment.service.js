// Payment Service
import razorpay from '../../../lib/razorpay.js';
import crypto from 'crypto';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Create an order
export const createOrder = async (amount, currency = 'INR', bookingId) => {
  const order = await razorpay.orders.create({
    amount: amount * 100, // Convert to paisa
    currency,
    receipt: `booking_${bookingId}`,
    metadata: {
      bookingId,
      type: 'booking_payment'
    }
  });

  return order;
};

// Verify webhook signature
export const verifyWebhookSignature = (body, signature, secret = RAZORPAY_WEBHOOK_SECRET) => {
  if (!secret || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
};

// Verify payment
export const verifyPayment = async (orderId, paymentId, signature) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`, 'utf8')
    .digest('hex');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
};

// Get payment details
export const getPaymentDetails = async (paymentId) => {
  const payment = await razorpay.payments.fetch(paymentId);
  return payment;
};

// Refund a payment
export const refundPayment = async (paymentId, amount = null) => {
  const refund = await razorpay.payments.refund(paymentId, { amount: amount ? amount * 100 : undefined });
  return refund;
};

// Create payment record
export const createPaymentRecord = async (data) => {
  const payment = await prisma.payment.create({
    data: {
      bookingId: data.bookingId,
      userId: data.userId,
      serviceId: data.serviceId,
      razorpayOrderId: data.orderId,
      razorpayPaymentId: data.paymentId,
      amount: data.amount,
      currency: data.currency || 'INR',
      status: 'PENDING'
    }
  });

  return payment;
};

// Update payment status
export const updatePaymentStatus = async (paymentId, status, data = {}) => {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status,
      ...data
    }
  });

  return payment;
};

// Get payment by ID
export const getPaymentById = async (paymentId) => {
  return await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true }
  });
};

// Get payments by user
export const getUserPayments = async (userId) => {
  return await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
};

// Get payments by booking
export const getPaymentsByBooking = async (bookingId) => {
  return await prisma.payment.findMany({
    where: { bookingId }
  });
};