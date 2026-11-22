// Job Workers - pg-boss Configuration
import PgBoss from 'pg-boss';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { createMeeting } from '../modules/meetings/services/meeting.service.js';
import { sendMeetingReminder } from '../modules/notifications/services/notification.service.js';
import { initializeReport } from '../modules/reports/services/report.service.js';

let pgBoss = null;

export const getPgBoss = () => {
  if (!pgBoss) {
    const connectionString = process.env.DATABASE_URL;
    pgBoss = new PgBoss({
      connectionString,
      maxConcurrentWorkers: 5,
      maxActiveWorkers: 10,
      archiveCompletedAfterSeconds: 60 * 60,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
      retryLimit: 5,
      retryDelay: 10,
      retryBackoff: true,
      monitorStateIntervalSeconds: 30
    });

    pgBoss.on('error', (error) => {
      logger.error('PgBoss database connection error', { error: error.message });
    });
  }
  return pgBoss;
};

export const initializeJobs = async () => {
  const boss = getPgBoss();

  // Job: Expire booking
  boss.work('expireBooking', async (job) => {
    logger.info('Processing expireBooking job', { bookingId: job.data.bookingId });

    const booking = await prisma.booking.findUnique({
      where: { id: job.data.bookingId }
    });

    if (!booking) return;

    if (booking.status === 'PENDING') {
      await prisma.booking.update({
        where: { id: job.data.bookingId },
        data: { status: 'EXPIRED' }
      });

      await prisma.payment.update({
        where: { id: job.data.paymentId },
        data: { status: 'REFUNDED' }
      });

      logger.info('Booking expired and refunded', { bookingId: booking.id });
    }
  });

  // Job: Create meeting
  boss.work('createMeeting', async (job) => {
    logger.info('Processing createMeeting job', { bookingId: job.data.bookingId });

    try {
      const meeting = await createMeeting(job.data.bookingId, job.data.userId);
      logger.info('Meeting created', { meetingId: meeting.id });
    } catch (error) {
      logger.error('Failed to create meeting', { error: error.message });
      throw error;
    }
  });

  // Job: Send reminder
  boss.work('sendReminder', async (job) => {
    await sendMeetingReminder(job.data.bookingId);
  });

  // Job: Generate transcript
  boss.work('generateTranscript', async (job) => {
    logger.info('Processing generateTranscript job', { meetingId: job.data.meetingId });
    // Integration with transcription service would go here
  });

  // Job: Generate AI report
  boss.work('generateReport', async (job) => {
    await initializeReport(job.data.bookingId, job.data.userId);
  });

  await boss.start();
  logger.info('Job workers initialized');
};

// Queue a job
export const queueJob = async (name, data, options = {}) => {
  const boss = getPgBoss();
  return await boss.send(name, data, options);
};

// Schedule booking expiration
export const scheduleBookingExpiration = async (bookingId, paymentId, delayMs = 24 * 60 * 60 * 1000) => {
  return await queueJob('expireBooking', { bookingId, paymentId }, {
    delay: delayMs,
    removeAfter: 7 * 24 * 60 * 60 // 7 days
  });
};

// Schedule meeting creation
export const scheduleMeetingCreation = async (bookingId, userId, delayMs = 5000) => {
  return await queueJob('createMeeting', { bookingId, userId }, {
    delay: delayMs
  });
};

// Cancel jobs for a booking
export const cancelJobsForBooking = async (bookingId) => {
  const boss = getPgBoss();
  const jobs = await boss.filter({ data: { bookingId } });

  for (const job of jobs) {
    await boss.cancel(job.id);
  }
};