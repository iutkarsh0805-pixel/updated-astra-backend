import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { encryptToken, decryptToken, migrateToken } from '../src/lib/token-encryption.js';

test('Token Encryption Security Suite', async (t) => {
  await t.test('encryptToken and decryptToken roundtrip with new format', () => {
    const token = 'ya29.a0AfH6SM...test-google-token-12345';
    const encrypted = encryptToken(token);

    assert.equal(typeof encrypted, 'string');
    assert.equal(encrypted.split('.').length, 5); // version.key_id.iv.tag.ciphertext

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, token);
  });

  await t.test('decryptToken supports legacy format (3 parts) using JWT_SECRET', () => {
    // Generate legacy format token (iv.tag.ciphertext) using JWT_SECRET
    const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret';
    const key = crypto.createHash('sha256').update(jwtSecret).digest();
    const iv = crypto.randomBytes(12);
    const token = 'legacy-google-refresh-token-abc';

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const legacyFormat = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');

    const decrypted = decryptToken(legacyFormat);
    assert.equal(decrypted, token);
  });

  await t.test('decryptToken rejects tampered ciphertext', () => {
    const token = 'sensitive-token-data';
    const encrypted = encryptToken(token);

    const parts = encrypted.split('.');
    parts[4] = Buffer.from('tampereddata').toString('base64url');
    const tampered = parts.join('.');

    const decrypted = decryptToken(tampered);
    assert.equal(decrypted, null);
  });

  await t.test('decryptToken rejects tampered auth tag', () => {
    const token = 'sensitive-token-data';
    const encrypted = encryptToken(token);

    const parts = encrypted.split('.');
    parts[3] = crypto.randomBytes(16).toString('base64url');
    const tampered = parts.join('.');

    const decrypted = decryptToken(tampered);
    assert.equal(decrypted, null);
  });

  await t.test('JWT_SECRET rotation does not affect new-format Google token encryption when dedicated key is present', () => {
    // Set dedicated encryption key
    const originalDedicated = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    const originalJwt = process.env.JWT_SECRET;

    try {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'dedicated-google-encryption-secret-key';
      const token = 'google-token-with-dedicated-key';

      const encrypted = encryptToken(token);

      // Rotate JWT_SECRET
      process.env.JWT_SECRET = 'completely-rotated-jwt-secret-value';

      const decrypted = decryptToken(encrypted);
      assert.equal(decrypted, token);
    } finally {
      if (originalDedicated !== undefined) {
        process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalDedicated;
      } else {
        delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
      }
      if (originalJwt !== undefined) {
        process.env.JWT_SECRET = originalJwt;
      }
    }
  });

  await t.test('migrateToken upgrades legacy token to new format', () => {
    const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret';
    const key = crypto.createHash('sha256').update(jwtSecret).digest();
    const iv = crypto.randomBytes(12);
    const token = 'token-to-be-migrated-xyz';

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const legacyFormat = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');

    const migrated = migrateToken(legacyFormat);
    assert.equal(typeof migrated, 'string');
    assert.equal(migrated.split('.').length, 5); // New 5-part format

    const decrypted = decryptToken(migrated);
    assert.equal(decrypted, token);
  });
});
