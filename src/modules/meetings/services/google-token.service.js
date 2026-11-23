// Google Token Lifecycle & Refresh Service
import { prisma } from '../../../lib/prisma.js';
import { google } from 'googleapis';
import { logger } from '../../../lib/logger.js';
import { encryptToken, decryptToken } from '../../../lib/token-encryption.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// In-memory mutex map to prevent concurrent refreshes for the same user
const activeRefreshes = new Map();

export const getOAuth2Client = (tokens = null) => {
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  if (tokens) client.setCredentials(tokens);
  return client;
};

/**
 * Retrieves a valid, fresh Google OAuth2 client for the given user.
 * Automatically checks access token expiration and refreshes if necessary,
 * with concurrent refresh protection and safe refresh-token handling.
 */
export const getOAuthClientForUser = async (userId) => {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: 'GOOGLE' },
    orderBy: { updatedAt: 'desc' }
  });

  if (!account) {
    throw new Error('Google Calendar account is not connected for this user');
  }

  if (account.requiresReconnection) {
    throw new Error('Google account authorization has expired or been revoked. Please reconnect your Google Calendar.');
  }

  if (!account.refreshToken) {
    throw new Error('Google Calendar refresh token is missing for this user');
  }

  const decryptedAccessToken = decryptToken(account.accessToken);
  const decryptedRefreshToken = decryptToken(account.refreshToken);
  const expiryDate = account.refreshTokenExpiresAt ? new Date(account.refreshTokenExpiresAt).getTime() : 0;

  // Check if access token is expired or expiring within 5 minutes (300,000 ms)
  const fiveMinutesMs = 5 * 60 * 1000;
  const isExpiredOrExpiring = !decryptedAccessToken || !expiryDate || (expiryDate - Date.now() < fiveMinutesMs);

  if (!isExpiredOrExpiring) {
    // Return client with existing valid credentials
    const client = getOAuth2Client({
      access_token: decryptedAccessToken,
      refresh_token: decryptedRefreshToken,
      expiry_date: expiryDate
    });

    // Attach listener for runtime token refreshes triggered by googleapis
    setupTokenListener(client, account.id);
    return client;
  }

  // Token is expired or expiring soon - perform proactive refresh with concurrency protection
  return await executeProtectedRefresh(userId, account, decryptedRefreshToken);
};

const executeProtectedRefresh = async (userId, account, decryptedRefreshToken) => {
  // If a refresh is already in progress for this user, await it
  if (activeRefreshes.has(userId)) {
    return await activeRefreshes.get(userId);
  }

  const refreshPromise = (async () => {
    const client = getOAuth2Client({
      refresh_token: decryptedRefreshToken
    });

    try {
      const { credentials } = await client.refreshAccessToken();

      // Safe refresh token handling: Google may omit refresh_token on access token refresh
      const newAccessToken = credentials.access_token ? encryptToken(credentials.access_token) : account.accessToken;
      const newRefreshToken = credentials.refresh_token ? encryptToken(credentials.refresh_token) : account.refreshToken;
      const newExpiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : account.refreshTokenExpiresAt;

      // Persist updated credentials securely
      await prisma.oAuthAccount.update({
        where: { id: account.id },
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          refreshTokenExpiresAt: newExpiryDate,
          requiresReconnection: false,
          tokenType: credentials.token_type || account.tokenType,
          scope: credentials.scope || account.scope
        }
      });

      client.setCredentials({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || decryptedRefreshToken,
        expiry_date: credentials.expiry_date
      });

      setupTokenListener(client, account.id);
      return client;
    } catch (error) {
      const errMessage = error.message || '';
      const isInvalidGrant = errMessage.includes('invalid_grant') || error.code === 400 || (error.response && error.response.status === 400);

      if (isInvalidGrant) {
        logger.warn('Google OAuth refresh failed with invalid_grant, marking account as requiring reconnection', { userId });
        await prisma.oAuthAccount.update({
          where: { id: account.id },
          data: { requiresReconnection: true }
        }).catch((dbErr) => {
          logger.error('Failed to update OAuthAccount requiresReconnection status', { error: dbErr.message });
        });

        throw new Error('Google account authorization has expired or been revoked. Please reconnect your Google Calendar.');
      }

      logger.error('Failed to refresh Google OAuth access token', { userId, error: errMessage });

      // For transient errors, if we have an existing access token that might still be valid or close to valid,
      // return client with decrypted existing credentials rather than failing completely if possible,
      // or throw a clean error.
      const existingAccessToken = decryptToken(account.accessToken);
      if (existingAccessToken) {
        logger.warn('Using existing cached access token due to transient refresh failure', { userId });
        const fallbackClient = getOAuth2Client({
          access_token: existingAccessToken,
          refresh_token: decryptedRefreshToken,
          expiry_date: account.refreshTokenExpiresAt?.getTime()
        });
        setupTokenListener(fallbackClient, account.id);
        return fallbackClient;
      }

      throw new Error(`Failed to refresh Google OAuth token: ${errMessage}`);
    } finally {
      activeRefreshes.delete(userId);
    }
  })();

  activeRefreshes.set(userId, refreshPromise);
  return await refreshPromise;
};

const setupTokenListener = (client, accountId) => {
  client.on('tokens', async (tokens) => {
    try {
      // Re-read account to ensure we don't overwrite a newer refresh token concurrently
      const currentAccount = await prisma.oAuthAccount.findUnique({ where: { id: accountId } });
      if (!currentAccount) return;

      const currentStoredRefresh = decryptToken(currentAccount.refreshToken);

      await prisma.oAuthAccount.update({
        where: { id: accountId },
        data: {
          accessToken: tokens.access_token ? encryptToken(tokens.access_token) : currentAccount.accessToken,
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : currentAccount.refreshToken,
          refreshTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : currentAccount.refreshTokenExpiresAt
        }
      });
    } catch (error) {
      logger.error('Failed to persist refreshed Google tokens from client event', { error: error.message });
    }
  });
};
