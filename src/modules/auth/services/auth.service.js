// Auth Service
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be defined in environment variables');
}

// Generate access token
export const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// Generate refresh token
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.id, sessionId: null },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
};

// Hash token for session storage
export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Hash password using Argon2id
export const hashPassword = async (password) => {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
};

// Verify password
export const verifyPassword = async (hashedPassword, password) => {
  return await argon2.verify(hashedPassword, password);
};

// Create session in database
export const createSession = async (userId, token, expiresAt) => {
  return await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: 'unknown',
      ipAddress: 'unknown'
    }
  });
};

// Create refresh token in database
export const createRefreshToken = async (userId, token, expiresAt) => {
  return await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      revoked: false
    }
  });
};

// Register user
export const registerUser = async (email, password, name) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error('User already exists');
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: 'CUSTOMER',
      passwordCredential: {
        create: {
          passwordHash
        }
      }
    }
  });

  return user;
};

// Login user
export const loginUser = async (email, password) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { passwordCredential: true }
  });

  if (!user || !user.passwordCredential || !user.isActive) {
    return null;
  }

  const isValid = await verifyPassword(user.passwordCredential.passwordHash, password);
  if (!isValid) {
    return null;
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  const accessExpires = new Date(Date.now() + 15 * 60 * 1000);
  const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await createSession(user.id, accessToken, accessExpires);
  await createRefreshToken(user.id, refreshToken, refreshExpires);

  return { user, accessToken, refreshToken };
};

// Refresh tokens
export const refreshTokens = async (refreshToken) => {
  const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  const refreshTokenRecord = await prisma.refreshToken.findFirst({
    where: {
      userId: decoded.userId,
      tokenHash: hashToken(refreshToken),
      revoked: false,
     expiresAt: { gt: new Date() }
    }
  });

  if (!refreshTokenRecord) {
    throw new Error('Invalid refresh token');
  }

  await prisma.refreshToken.update({
    where: { id: refreshTokenRecord.id },
    data: { revoked: true }
  });

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  const accessExpires = new Date(Date.now() + 15 * 60 * 1000);
  const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await createSession(user.id, newAccessToken, accessExpires);
  await createRefreshToken(user.id, newRefreshToken, refreshExpires);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

// Logout user
export const logoutUser = async (refreshToken) => {
  const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

  await prisma.refreshToken.updateMany({
    where: {
      userId: decoded.userId,
      tokenHash: hashToken(refreshToken),
      revoked: false
    },
    data: { revoked: true }
  });

  await prisma.session.updateMany({
    where: {
      userId: decoded.userId,
      revokedAt: null
    },
    data: { revokedAt: new Date() }
  });
};

// Verify JWT and return user
export const verifyJWT = async (token) => {
  const decoded = jwt.verify(token, JWT_SECRET);
  const session = await prisma.session.findFirst({
    where: {
      userId: decoded.userId,
      tokenHash: hashToken(token),
      expiresAt: { gt: new Date() },
      revokedAt: null
    }
  });

  if (!session) {
    return null;
  }

  return decoded;
};