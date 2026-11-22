import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.RAZORPAY_KEY_ID ||= 'rzp_test_safe';
process.env.RAZORPAY_KEY_SECRET ||= 'checkout-secret';

const { verifyWebhookSignature, verifyPayment } = await import('../src/modules/payments/services/payment.service.js');

test('rejects webhook with missing or invalid signature', () => {
  assert.equal(verifyWebhookSignature(Buffer.from('{}'), null, 'test-secret'), false);
  assert.equal(verifyWebhookSignature(Buffer.from('{}'), 'invalid', 'test-secret'), false);
});

test('accepts a valid webhook signature', () => {
  const body = Buffer.from('{"event":"payment.captured"}');
  const secret = 'test-secret';
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, signature, secret), true);
});

test('verifies checkout order/payment signature', async () => {
  const keySecret = 'checkout-secret';
  process.env.RAZORPAY_KEY_SECRET = keySecret;
  const orderId = 'order_test';
  const paymentId = 'pay_test';
  const signature = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  assert.equal(await verifyPayment(orderId, paymentId, signature), true);
});
