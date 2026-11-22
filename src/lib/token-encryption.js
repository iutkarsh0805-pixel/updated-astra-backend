// Google OAuth Token Encryption - Dedicated Key
// Decoupled from JWT_SECRET for independent rotation
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

// Derive encryption key from dedicated Google token encryption key
// Falls back to JWT_SECRET for backward compatibility during migration
const getEncryptionKey = () => {
  const source = GOOGLE_TOKEN_ENCRYPTION_KEY || JWT_SECRET;
  if (!source || source === 'your-super-secret-jwt-key-change-this') {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is not configured. Set it in your environment.');
  }
  return crypto.createHash('sha256').update(source).digest();
};

// Check if token was encrypted with old JWT_SECRET-based key
const isNewFormatKeyAvailable = () => {
  return GOOGLE_TOKEN_ENCRYPTION_KEY &&
         GOOGLE_TOKEN_ENCRYPTION_KEY !== 'your-super-secret-jwt-key-change-this';
};

// Encrypt token using AES-256-GCM
export const encryptToken = (token) => {
  if (!token) return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

  // Format: version.key_id.iv.auth_tag.ciphertext (all base64url)
  // Version 1 = new dedicated key format
  const version = '1';
  const keyId = isNewFormatKeyAvailable() ? 'google' : 'jwt';

  return [version, keyId, iv, cipher.getAuthTag(), encrypted]
    .map(part => part.toString('base64url'))
    .join('.');
};

// Decrypt token - supports both new and legacy formats
export const decryptToken = (value) => {
  if (!value) return null;

  const parts = value.split('.');

  try {
    // New format: version.key_id.iv.auth_tag.ciphertext (5 parts)
    if (parts.length === 5) {
      const [version, keyId, iv, tag, encrypted] = parts;

      // Validate version
      if (version !== '1') {
        throw new Error('Unsupported token version');
      }

      // Use appropriate key based on keyId
      let key;
      if (keyId === 'google' && isNewFormatKeyAvailable()) {
        key = getEncryptionKey();
      } else {
        // Fall back to JWT_SECRET-based key for backward compatibility
        if (!JWT_SECRET || JWT_SECRET === 'your-super-secret-jwt-key-change-this') {
          throw new Error('Encryption key not available');
        }
        key = crypto.createHash('sha256').update(JWT_SECRET).digest();
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final()
      ]).toString('utf8');
    }

    // Legacy format: iv.auth_tag.encrypted (3 parts) - uses JWT_SECRET
    if (parts.length === 3) {
      if (!JWT_SECRET || JWT_SECRET === 'your-super-secret-jwt-key-change-this') {
        throw new Error('Legacy encryption key not available');
      }

      const key = crypto.createHash('sha256').update(JWT_SECRET).digest();
      const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'));

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]).toString('utf8');
    }

    throw new Error('Invalid token format');
  } catch (error) {
    // Return null for decryption failures - don't expose error details
    return null;
  }
};

// Re-encrypt a token with the new key (used during migration)
export const migrateToken = (encryptedValue) => {
  if (!encryptedValue) return null;

  // Decrypt with old key
  const plaintext = decryptToken(encryptedValue);
  if (!plaintext) {
    return null; // Decryption failed, return original or null
  }

  // Encrypt with new key
  return encryptToken(plaintext);
};

// Validate encryption key at startup
export const validateEncryptionKey = () => {
  try {
    if (!JWT_SECRET || JWT_SECRET === 'your-super-secret-jwt-key-change-this') {
      console.error('ERROR: JWT_SECRET is not configured properly');
      process.exit(1);
    }

    // Test encryption/decryption
    const testToken = 'test-token-validation';
    const encrypted = encryptToken(testToken);
    const decrypted = decryptToken(encrypted);

    if (decrypted !== testToken) {
      throw new Error('Encryption validation failed: round-trip mismatch');
    }

    console.log('Token encryption validated successfully');
    return true;
  } catch (error) {
    console.error('Encryption key validation failed:', error.message);
    process.exit(1);
  }
};

export { isNewFormatKeyAvailable, getEncryptionKey };