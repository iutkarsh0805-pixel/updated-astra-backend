import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma.js';
import { createGoogleOAuthState, verifyGoogleOAuthState } from '../src/modules/meetings/services/meeting.service.js';

test('OAuth State Security Suite', async (t) => {
  const testUserId = 'test-user-' + Date.now();

  // Setup test user
  await prisma.user.create({
    data: { id: testUserId, email: `test-${Date.now()}@example.com`, name: 'Test User' }
  });

  t.after(async () => {
    await prisma.oAuthState.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    await prisma.$disconnect();
  });

  await t.test('createGoogleOAuthState creates state and database record', async () => {
    const state = await createGoogleOAuthState(testUserId);
    assert.equal(typeof state, 'string');
    assert.equal(state.split('.').length, 2);

    const dbStates = await prisma.oAuthState.findMany({ where: { userId: testUserId } });
    assert.equal(dbStates.length, 1);
    assert.equal(dbStates[0].userId, testUserId);
    assert.ok(dbStates[0].nonceHash);
    assert.ok(dbStates[0].expiresAt instanceof Date);
  });

  await t.test('verifyGoogleOAuthState validates valid state and consumes it (one-time use)', async () => {
    const state = await createGoogleOAuthState(testUserId);
    const userId = await verifyGoogleOAuthState(state);
    assert.equal(userId, testUserId);

    // Replay attack: second use should fail
    await assert.rejects(
      async () => await verifyGoogleOAuthState(state),
      /OAuth state already used or invalid/
    );
  });

  await t.test('verifyGoogleOAuthState rejects missing or invalid format state', async () => {
    await assert.rejects(
      async () => await verifyGoogleOAuthState(null),
      /Missing OAuth state/
    );
    await assert.rejects(
      async () => await verifyGoogleOAuthState('invalid-format'),
      /Invalid OAuth state format/
    );
  });

  await t.test('verifyGoogleOAuthState rejects tampered signature', async () => {
    const state = await createGoogleOAuthState(testUserId);
    const [payload] = state.split('.');
    const tampered = `${payload}.invalidsignature`;

    await assert.rejects(
      async () => await verifyGoogleOAuthState(tampered),
      /Invalid OAuth state signature/
    );
  });

  await t.test('verifyGoogleOAuthState rejects expired state', async () => {
    const nonce = 'expired-nonce-' + Date.now();
    const nonceHash = crypto.createHash('sha256').update(nonce).digest('hex');

    await prisma.oAuthState.create({
      data: {
        userId: testUserId,
        nonceHash,
        expiresAt: new Date(Date.now() - 1000) // Expired
      }
    });

    const payload = Buffer.from(JSON.stringify({ userId: testUserId, nonce, exp: Date.now() - 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(payload).digest('base64url');
    const state = `${payload}.${signature}`;

    await assert.rejects(
      async () => await verifyGoogleOAuthState(state),
      /OAuth state expired/
    );
  });

  await t.test('verifyGoogleOAuthState rejects malformed payload structure', async () => {
    // Missing nonce or extra keys
    const payload = Buffer.from(JSON.stringify({ userId: testUserId, exp: Date.now() + 600000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(payload).digest('base64url');
    const state = `${payload}.${signature}`;

    await assert.rejects(
      async () => await verifyGoogleOAuthState(state),
      /Invalid OAuth state payload/
    );
  });
});
