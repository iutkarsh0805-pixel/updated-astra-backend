// Job Workers - pg-boss Configuration
import PgBoss from 'pg-boss';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { createMeeting } from '../modules/meetings/services/meeting.service.js';
import { sendMeetingReminder } from '../modules/notifications/services/notification.service.js';
import { generateReportForBooking } from '../modules/reports/services/report.service.js';
import { transcribeGoogleDriveRecording } from '../modules/transcripts/services/transcript.service.js';

let pgBoss = null;
let jobsStarted = false;

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
    const booking = await prisma.booking.findUnique({
      where: { id: job.data.bookingId },
      include: { payment: true }
    });

    if (!booking || booking.status !== 'PENDING') return;

    await prisma.$transaction(async (tx) => {
      const changed = await tx.booking.updateMany({
        where: { id: booking.id, status: 'PENDING' },
        data: { status: 'EXPIRED' }
      });
      if (changed.count !== 1) return;

      if (booking.payment?.status === 'PENDING') {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { status: 'FAILED' }
        });
      }

      await tx.slot.updateMany({
        where: { id: booking.slotId, status: 'RESERVED' },
        data: { status: 'AVAILABLE' }
      });
    });

    logger.info('Pending booking expired and its slot released', { bookingId: booking.id });
  });

  // Job: Create meeting
  boss.work('createMeeting', async (job) => {
    logger.info('Processing createMeeting job', { bookingId: job.data.bookingId });

    try {
      const meeting = await createMeeting(job.data.bookingId, job.data.userId);
      const delay = Math.max(0, meeting.startTime.getTime() - Date.now() - 30 * 60 * 1000);
      await queueJob('sendReminder', { bookingId: job.data.bookingId }, { delay });
      logger.info('Meeting created and reminder scheduled', { meetingId: meeting.id });
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
    const transcript = await transcribeGoogleDriveRecording(
      job.data.meetingId,
      job.data.driveFileId,
      job.data.language || 'en'
    );
    logger.info('Transcript ready', { meetingId: job.data.meetingId, transcriptId: transcript.id });
  });

  // Job: Generate AI report
  boss.work('generateReport', async (job) => {
    logger.info('Processing generateReport job', { bookingId: job.data.bookingId });

    try {
      await generateReportForBooking(job.data.bookingId, job.data.userId);
      logger.info('Report generation initiated', { bookingId: job.data.bookingId });
    } catch (error) {
      logger.error('Failed to generate report', { error: error.message });
      throw error;
    }
  });

  await boss.start();
  jobsStarted = true;
  logger.info('Job workers initialized');
};

// Queue a job
export const queueJob = async (name, data, options = {}) => {
  if (!jobsStarted) {
    throw new Error('Background jobs have not been initialized');
  }
  return await getPgBoss().send(name, data, options);
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