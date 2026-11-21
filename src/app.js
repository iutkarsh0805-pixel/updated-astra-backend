import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pino from 'pino-http';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middlewares/error.middleware.js';
import { routeNotFound } from './middlewares/not-found.middleware.js';
import { authRoutes } from './modules/auth/index.js';
import { bookingRoutes } from './modules/bookings/index.js';
import { slotRoutes } from './modules/slots/index.js';
import { paymentRoutes } from './modules/payments/index.js';
import { serviceRoutes } from './modules/services/index.js';
import { meetingRoutes } from './modules/meetings/index.js';
import { notificationRoutes } from './modules/notifications/index.js';
import { reviewRoutes } from './modules/reviews/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { consultationRoutes } from './modules/consultations/index.js';
import { transcriptRoutes } from './modules/transcripts/index.js';
import { reportRoutes } from './modules/reports/index.js';
import { aiRoutes } from './modules/ai/index.js';

const app = express();

// Security Middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Razorpay webhook requires the exact raw request body for HMAC verification
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

// Request Parsers
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' }
});

app.use(apiLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Logging
app.use(pino());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
const API_PREFIX = '/api/v1';

// Auth routes
app.use(`${API_PREFIX}/auth`, authRoutes);

// Bookings routes
app.use(`${API_PREFIX}/bookings`, bookingRoutes);

// Slots routes
app.use(`${API_PREFIX}/slots`, slotRoutes);

// Payments routes
app.use(`${API_PREFIX}/payments`, paymentRoutes);

// Services routes (Astrologer profiles & service management)
app.use(`${API_PREFIX}/services`, serviceRoutes);

// Meetings routes (Google Meet integration)
app.use(`${API_PREFIX}/meetings`, meetingRoutes);

// Notifications routes
app.use(`${API_PREFIX}/notifications`, notificationRoutes);

// Reviews routes
app.use(`${API_PREFIX}/reviews`, reviewRoutes);

// Admin routes (Admin only)
app.use(`${API_PREFIX}/admin`, adminRoutes);

// Consultations routes
app.use(`${API_PREFIX}/consultations`, consultationRoutes);

// Transcripts routes
app.use(`${API_PREFIX}/transcripts`, transcriptRoutes);

// Reports routes
app.use(`${API_PREFIX}/reports`, reportRoutes);

// AI Services routes
app.use(`${API_PREFIX}/ai`, aiRoutes);

// Error Handling
app.use(routeNotFound);
app.use(errorHandler);

export default app;