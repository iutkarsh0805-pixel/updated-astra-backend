import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { generateSummary } from '../src/modules/ai/services/ai.service.js';

test('seeded customer can login and access profile', async () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('username:password')) {
    return;
  }

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'customer@example.com', password: 'customer123' });

  assert.equal(login.status, 200);
  assert.ok(login.body.data.accessToken);

  const profile = await request(app)
    .get('/api/v1/auth/profile')
    .set('Authorization', `Bearer ${login.body.data.accessToken}`);

  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.email, 'customer@example.com');
});

test('Gemini summary provider returns text when configured', async () => {
  if (!process.env.GEMINI_API_KEY) {
    return;
  }

  const summary = await generateSummary({
    astrologerName: 'Test Astrologer',
    topics: ['Career'],
    recommendations: ['Review career goals']
  });

  assert.equal(typeof summary, 'string');
  assert.ok(summary.length > 20);
});

test('Google OAuth state is signed and bound to the initiating user', async () => {
  const { createGoogleOAuthState, verifyGoogleOAuthState } = await import('../src/modules/meetings/services/meeting.service.js');
  const testUserId = 'user-test-id-' + Date.now();
  await prisma.user.create({
    data: { id: testUserId, email: `oauth-test-${Date.now()}@example.com`, name: 'OAuth Test User' }
  });
  try {
    const state = await createGoogleOAuthState(testUserId);
    const verifiedId = await verifyGoogleOAuthState(state);
    assert.equal(verifiedId, testUserId);
    await assert.rejects(
      async () => await verifyGoogleOAuthState(`${state}tampered`),
      /Invalid OAuth state/
    );
  } finally {
    await prisma.oAuthState.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  }
});

test('signed Razorpay webhook retries are idempotent', async () => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return;

  const body = JSON.stringify({ event: 'test.ignored', payload: {} });
  const eventId = `evt_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const signature = (await import('node:crypto')).default
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const send = () => request(app)
    .post('/api/v1/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', eventId)
    .set('x-razorpay-signature', signature)
    .send(body);

  const first = await send();
  const retry = await send();
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.match(retry.body.message, /already processed/);
});

test('simultaneous slot reservations allow exactly one winner', async () => {
  if (!process.env.DATABASE_URL) return;
  const { prisma } = await import('../src/lib/prisma.js');
  const astrologer = await prisma.astrologerProfile.findFirst();
  if (!astrologer) return;

  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  date.setUTCHours(0, 0, 0, 0);
  const slot = await prisma.slot.create({
    data: {
      astrologerId: astrologer.id,
      date,
      startTime: '03:00',
      endTime: '04:00'
    }
  });

  try {
    const reserve = () => prisma.$transaction(async (tx) => tx.slot.updateMany({
      where: { id: slot.id, status: 'AVAILABLE' },
      data: { status: 'RESERVED' }
    }));
    const results = await Promise.all([reserve(), reserve()]);
    assert.equal(results.reduce((sum, result) => sum + result.count, 0), 1);
  } finally {
    await prisma.slot.delete({ where: { id: slot.id } });
  }
});

test('payment capture, cancellation, and refund processing update the full lifecycle', async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  const razorpay = (await import('../src/lib/razorpay.js')).default;
  const { cancelBooking } = await import('../src/modules/bookings/services/booking.service.js');
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
  const astrologer = await prisma.astrologerProfile.findFirst();
  if (!customer || !astrologer || !secret) return;

  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const service = await prisma.service.create({
    data: {
      title: `Lifecycle test ${suffix}`,
      category: 'test',
      description: 'test fixture',
      image: 'https://example.com/test.png',
      price: 250,
      duration: 30
    }
  });
  const serviceLink = await prisma.astrologerService.create({
    data: { astrologerId: astrologer.id, serviceId: service.id, price: 250 }
  });
  const slot = await prisma.slot.create({
    data: {
      astrologerId: astrologer.id,
      date: new Date('2027-01-15T00:00:00.000Z'),
      startTime: '03:00',
      endTime: '03:30'
    }
  });
  const booking = await prisma.booking.create({
    data: {
      userId: customer.id,
      serviceId: service.id,
      slotId: slot.id,
      status: 'PENDING'
    }
  });
  const orderId = `order_test_${suffix}`;
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      userId: customer.id,
      serviceId: service.id,
      razorpayOrderId: orderId,
      amount: 250,
      currency: 'INR',
      status: 'PENDING'
    }
  });
  const eventIds = [];
  const sendWebhook = async (event, payload) => {
    const body = JSON.stringify({ event, payload });
    const eventId = `evt_${suffix}_${event.replaceAll('.', '_')}`;
    eventIds.push(eventId);
    const signature = (await import('node:crypto')).default
      .createHmac('sha256', secret).update(body).digest('hex');
    return request(app).post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', eventId)
      .set('x-razorpay-signature', signature)
      .send(body);
  };

  const originalRefund = razorpay.payments.refund;
  try {
    const captured = await sendWebhook('payment.captured', {
      payment: { entity: { id: `pay_${suffix}`, order_id: orderId, amount: 25000, currency: 'INR' } }
    });
    assert.equal(captured.status, 200);
    assert.equal((await prisma.booking.findUnique({ where: { id: booking.id } })).status, 'CONFIRMED');
    assert.equal((await prisma.slot.findUnique({ where: { id: slot.id } })).status, 'BOOKED');

    razorpay.payments.refund = async () => ({ id: `rfnd_${suffix}`, status: 'pending' });
    const cancelled = await cancelBooking(booking.id, customer.id, 'Integration test cancellation');
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).refundStatus, 'PENDING');

    const refundProcessed = await sendWebhook('refund.processed', {
      refund: { entity: { id: `rfnd_${suffix}`, payment_id: `pay_${suffix}`, order_id: orderId, amount: 25000 } }
    });
    assert.equal(refundProcessed.status, 200);
    assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'REFUNDED');
    assert.equal((await prisma.booking.findUnique({ where: { id: booking.id } })).status, 'REFUNDED');
  } finally {
    razorpay.payments.refund = originalRefund;
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.refund.deleteMany({ where: { paymentId: payment.id } });
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.slot.delete({ where: { id: slot.id } });
    await prisma.astrologerService.delete({ where: { id: serviceLink.id } });
    await prisma.service.delete({ where: { id: service.id } });
  }
});

test('customer booking API reserves one slot and uses authoritative service price', async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  const razorpay = (await import('../src/lib/razorpay.js')).default;
  const customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
  const astrologer = await prisma.astrologerProfile.findFirst();
  if (!customer || !astrologer) return;

  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const service = await prisma.service.create({
    data: {
      title: `Booking test ${suffix}`,
      category: 'test',
      description: 'test fixture',
      image: 'https://example.com/booking-test.png',
      price: 999,
      duration: 30
    }
  });
  const link = await prisma.astrologerService.create({
    data: { astrologerId: astrologer.id, serviceId: service.id, price: 425 }
  });
  const slot = await prisma.slot.create({
    data: {
      astrologerId: astrologer.id,
      date: new Date('2027-01-16T00:00:00.000Z'),
      startTime: '03:00',
      endTime: '03:30'
    }
  });
  const originalCreate = razorpay.orders.create;
  const orderId = `order_booking_${suffix}`;
  razorpay.orders.create = async ({ amount, currency }) => ({ id: orderId, amount, currency });

  let bookingId;
  try {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: customer.email, password: 'customer123' });
    assert.equal(login.status, 200);

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ slotId: slot.id, serviceId: service.id, amount: 1 });

    assert.equal(response.status, 201);
    bookingId = response.body.data.id;
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    assert.equal(payment.amount, 425);
    assert.equal(payment.razorpayOrderId, orderId);
    assert.equal((await prisma.slot.findUnique({ where: { id: slot.id } })).status, 'RESERVED');
  } finally {
    razorpay.orders.create = originalCreate;
    if (bookingId) {
      await prisma.payment.deleteMany({ where: { bookingId } });
      await prisma.booking.delete({ where: { id: bookingId } });
    }
    await prisma.slot.delete({ where: { id: slot.id } });
    await prisma.astrologerService.delete({ where: { id: link.id } });
    await prisma.service.delete({ where: { id: service.id } });
  }
});

test('completed booking generates and persists an AI report', async () => {
  if (!process.env.GEMINI_API_KEY) return;
  const { prisma } = await import('../src/lib/prisma.js');
  const { generateReportForBooking } = await import('../src/modules/reports/services/report.service.js');
  const customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
  const astrologer = await prisma.astrologerProfile.findFirst({ include: { user: true } });
  if (!customer || !astrologer) return;

  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const service = await prisma.service.create({
    data: {
      title: `Report test ${suffix}`,
      category: 'test',
      description: 'test fixture',
      image: 'https://example.com/report-test.png',
      price: 250,
      duration: 30
    }
  });
  const slot = await prisma.slot.create({
    data: {
      astrologerId: astrologer.id,
      date: new Date('2027-01-17T00:00:00.000Z'),
      startTime: '03:00',
      endTime: '03:30'
    }
  });
  const booking = await prisma.booking.create({
    data: {
      userId: customer.id,
      serviceId: service.id,
      slotId: slot.id,
      astrologerId: astrologer.id,
      status: 'COMPLETED'
    }
  });

  try {
    const report = await generateReportForBooking(booking.id);
    assert.equal(report.status, 'READY');
    assert.ok(report.summary?.length > 20);
    assert.ok(Array.isArray(report.recommendations));
  } finally {
    await prisma.report.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.slot.delete({ where: { id: slot.id } });
    await prisma.service.delete({ where: { id: service.id } });
  }
});
