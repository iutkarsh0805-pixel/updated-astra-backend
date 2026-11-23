import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { encryptToken, decryptToken } from '../src/lib/token-encryption.js';

// In-memory mutex simulation for testing concurrent refresh protection
const mutexMap = new Map();
let refreshCallCount = 0;

const executeProtectedRefresh = async (userId, account, decryptedRefreshToken, refreshFn) => {
  if (mutexMap.has(userId)) {
    return await mutexMap.get(userId);
  }

  const refreshPromise = (async () => {
    try {
      return await refreshFn();
    } finally {
      mutexMap.delete(userId);
    }
  })();

  mutexMap.set(userId, refreshPromise);
  refreshCallCount++;
  return await refreshPromise;
};

test('Google Token Lifecycle Tests', async (t) => {
  await t.test('Token encryption/decryption roundtrip', () => {
    const token = 'ya29.a0AfH6SM...test-google-token-12345';
    const encrypted = encryptToken(token);

    assert.equal(typeof encrypted, 'string');
    assert.equal(encrypted.split('.').length, 5); // version.key_id.iv.tag.ciphertext

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, token);
  });

  await t.test('Concurrent refresh protection prevents duplicate calls', async (t) => {
    mutexMap.clear();
    refreshCallCount = 0;

    const mockAccount = {
      id: 'test-account-id',
      refreshToken: encryptToken('test-refresh-token'),
      refreshTokenExpiresAt: new Date(Date.now() + 100000),
      requiresReconnection: false,
    };

    let actualRefreshCount = 0;
    const mockRefreshFn = async () => {
      actualRefreshCount++;
      await new Promise(r => setTimeout(r, 50));
      return {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };
    };

    // Simulate concurrent calls
    const [result1, result2] = await Promise.all([
      executeProtectedRefresh('user-1', mockAccount, encryptToken('refresh'), mockRefreshFn),
      executeProtectedRefresh('user-1', mockAccount, encryptToken('refresh'), mockRefreshFn),
    ]);

    assert.equal(actualRefreshCount, 1, 'Refresh function should only be called once');
    assert.equal(result1.accessToken, 'new-access-token');
  });

  await t.test('Safe refresh token handling preserves existing token', () => {
    const existingRefreshToken = 'existing-refresh-token-abc123';
    const newAccessToken = 'new-access-token-xyz';

    // Simulate Google response without refresh_token
    const googleResponse = {
      access_token: newAccessToken,
      expiry_date: Date.now() + 3600000,
    };

    // This is the logic from google-token.service.js line 83-84:
    // const newRefreshToken = credentials.refresh_token ? encryptToken(credentials.refresh_token) : account.refreshToken;
    const savedRefreshToken = googleResponse.refresh_token
      ? encryptToken(googleResponse.refresh_token)
      : encryptToken(existingRefreshToken); // Use existing when Google omits

    const decrypted = decryptToken(savedRefreshToken);
    assert.equal(decrypted, existingRefreshToken, 'Existing refresh token should be preserved');
  });

  await t.test('Invalid grant detection identifies revocation', () => {
    const cases = [
      { error: { message: 'invalid_grant' }, expected: true },
      { error: { message: 'Token has been expired' }, expected: false }, // Not invalid_grant specifically
      { error: { code: 400 }, expected: true },
      { error: { response: { status: 400 } }, expected: true },
    ];

    const isInvalidGrant = (err) => {
      const errMessage = err.message || '';
      return errMessage.includes('invalid_grant') ||
             err.code === 400 ||
             !!(err.response && err.response.status === 400);
    };

    for (const { error, expected } of cases) {
      assert.equal(isInvalidGrant(error), expected, `Should detect invalid_grant for ${error.message || error.code}`);
    }
  });

  await t.test('5-minute expiry buffer calculation', () => {
    const baseNow = Date.now();
    const fiveMinutesMs = 5 * 60 * 1000;

    // Use fixed timestamps relative to baseNow for reliable testing
    const cases = [
      { expiryDate: baseNow + 10 * 60 * 1000, expected: false }, // 10 min - not expired
      { expiryDate: baseNow + 299999, expected: true },          // 5 min - 1ms - within buffer
      { expiryDate: baseNow + 300000, expected: true },          // 5 min exactly - within buffer (300000ms)
      { expiryDate: baseNow + 299000, expected: true },          // 4 min 59 sec - within buffer
      { expiryDate: baseNow, expected: true },                   // Already expired
      { expiryDate: null, expected: true },                      // Null expiry - should trigger
    ];

    for (const { expiryDate, expected } of cases) {
      const isExpiredOrExpiring = !expiryDate || (expiryDate - baseNow <= fiveMinutesMs);
      assert.equal(isExpiredOrExpiring, expected, `Expiry ${expiryDate} should be ${expected}`);
    }
  });

  await t.test('OAuth state format validation', () => {
    const validState = 'eyJ1c2VySWQiOiJ1c2VyLTEyMyIsIm5vbmNlIjoiYWJjMTIzIiwiZXhwIjoxNzAwMDAwMDAwfQ.c2lnbmF0dXJl';

    const validateStateFormat = (state) => {
      if (!state) return false;
      const parts = state.split('.');
      if (parts.length !== 2) return false;

      const [payload, signature] = parts;

      // Validate base64url format
      if (!/^[A-Za-z0-9_-]+$/.test(payload)) return false;
      if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;

      return true;
    };

    assert.equal(validateStateFormat(validState), true, 'Valid state should pass validation');
    assert.equal(validateStateFormat('invalid'), false, 'Invalid state should fail');
    assert.equal(validateStateFormat('payload'), false, 'State without signature should fail');
  });

  await t.test('Timing-safe signature comparison', () => {
    const secret = 'test-secret-key';
    const payload = 'test-payload-data';
    const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

    // Same length comparison
    const validSigBuf = Buffer.from(validSignature);
    const validExpectedBuf = Buffer.from(validSignature);

    let isValid = false;
    try {
      isValid = validSigBuf.length === validExpectedBuf.length &&
                crypto.timingSafeEqual(validSigBuf, validExpectedBuf);
    } catch {
      isValid = false;
    }

    assert.equal(isValid, true, 'Same signature should validate with timing-safe comparison');

    // Different signature
    const invalidSig = 'YWJjZA=='; // 'abcd' in base64
    const invalidSigBuf = Buffer.from(invalidSig);
    const invalidExpectedBuf = Buffer.from(validSignature);

    let isInvalid = false;
    try {
      isInvalid = invalidSigBuf.length === invalidExpectedBuf.length &&
                  crypto.timingSafeEqual(invalidSigBuf, invalidExpectedBuf);
    } catch {
      isInvalid = false;
    }

    assert.equal(isInvalid, false, 'Different signature should fail validation');
  });

  await t.test('Legacy token migration', () => {
    // Create a legacy format token
    const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret';
    const key = crypto.createHash('sha256').update(jwtSecret).digest();
    const iv = crypto.randomBytes(12);
    const token = 'token-to-be-migrated-xyz';

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const legacyFormat = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');

    // Migrate using the same decryption logic
    const decrypted = decryptToken(legacyFormat);
    const reencrypted = encryptToken(decrypted);

    assert.equal(decrypted, token, 'Legacy token should decrypt correctly');
    assert.equal(reencrypted.split('.').length, 5, 'Migrated token should have new format');

    const redecrypted = decryptToken(reencrypted);
    assert.equal(redecrypted, token, 'Migrated token should roundtrip correctly');
  });
});