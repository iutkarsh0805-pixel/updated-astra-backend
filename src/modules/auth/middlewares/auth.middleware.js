// JWT Authentication Middleware
import jwt from 'jsonwebtoken';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined in environment variables');
}

import crypto from 'crypto';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
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
      return res.status(401).json({ success: false, message: 'Session expired or revoked' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Account is inactive or unavailable' });
    }

    req.user = { ...decoded, role: user.role };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    logger.error('JWT verification error:', error);
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

export const requireAuth = verifyJWT;

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
};

export { hashToken };