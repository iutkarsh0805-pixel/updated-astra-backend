// Report Service
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Helper functions for date manipulation (replaces date-fns)
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

const subDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
};

const format = (date, formatStr) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Initialize report - creates or updates a report based on booking
export const initializeReport = async (bookingId, userId) => {
  const report = await prisma.report.findUnique({
    where: { bookingId: bookingId }
  });

  if (report) {
    return report;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      payment: true,
      consultation: true,
      meeting: true,
      user: true,
      astrologer: { include: { user: true } },
      slot: true
    }
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  // Check authorization - can only create report for own bookings or as admin
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: userId }
  });

  const isAuthorized =
    userId === booking.userId ||
    (astrologer && booking.astrologerId === astrologer.id);

  if (!isAuthorized) {
    throw new Error('Not authorized');
  }

  const reportData = {
    bookingId,
    summary: generateDefaultSummary(booking),
    recommendations: [],
    insights: null,
    aiAnalysis: {
      bookingAmount: booking.payment?.amount || 0,
      status: booking.status,
      createdAt: new Date().toISOString()
    },
    status: 'PENDING'
  };

  return await prisma.report.create({
    data: reportData
  });
};

// Generate default summary from booking data
const generateDefaultSummary = (booking) => {
  const astrologerName = booking.astrologer?.user?.name || 'Astrologer';
  const customerName = booking.user?.name || 'Customer';

  return `${customerName} consulted with ${astrologerName} regarding ${booking.service || 'astrological consultation'}.\n\nBooking Details:\n- Date: ${booking.slot?.date?.toISOString().split('T')[0] || 'N/A'}\n- Status: ${booking.status}\n- Payment: ${booking.payment?.status || 'Not processed'}\n\nConsultation Summary:\n${booking.consultation?.summary || 'No consultation summary available.'}`;
};

// Get report by booking ID
export const getReportByBooking = async (bookingId, userId, role) => {
  const report = await prisma.report.findUnique({
    where: { bookingId: bookingId }
  });

  if (!report) {
    return null;
  }

  // Check authorization
  if (role === 'ADMIN') {
    return report;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  });

  if (!booking) {
    return null;
  }

  const isOwner = userId === booking.userId;
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: userId }
  });
  const isAstrologer = astrologer && booking.astrologerId === astrologer.id;

  if (isOwner || isAstrologer) {
    return report;
  }

  return null;
};

// Update report
export const updateReport = async (reportId, userId, data) => {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { booking: true }
  });

  if (!report) {
    throw new Error('Report not found');
  }

  const booking = report.booking;

  // Check authorization
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: userId }
  });

  const isAuthorized =
    userId === booking.userId ||
    (astrologer && booking.astrologerId === astrologer.id);

  if (!isAuthorized) {
    throw new Error('Not authorized');
  }

  return await prisma.report.update({
    where: { id: reportId },
    data: {
      summary: data.summary,
      recommendations: data.recommendations,
      insights: data.insights,
      updatedAt: new Date()
    }
  });
};

// Get reports for a customer
export const getCustomerReports = async (customerId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const reports = await prisma.report.findMany({
    where: { booking: { userId: customerId } },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          astrologer: { include: { user: true } },
          slot: true,
          payment: true
        }
      }
    }
  });

  const total = await prisma.report.count({
    where: {
      booking: { userId: customerId }
    }
  });

  return {
    data: reports,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get reports for an astrologer
export const getAstrologerReports = async (astrologerUserId, page = 1, limit = 20) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: astrologerUserId }
  });

  if (!astrologer) {
    throw new Error('Astrologer not found');
  }

  const skip = (page - 1) * limit;

  const reports = await prisma.report.findMany({
    where: { booking: { astrologerId: astrologer.id } },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          slot: true,
          payment: true
        }
      }
    }
  });

  const total = await prisma.report.count({
    where: {
      booking: { astrologerId: astrologer.id }
    }
  });

  return {
    data: reports,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get analytics for admin dashboard
export const getAnalytics = async (filters = {}) => {
  const { days = 30, period = 'all' } = filters;
  const startDate = period !== 'all'
    ? subDays(new Date(), days)
    : new Date('2024-01-01');
  const endDate = endOfToday();

  // Get basic stats
  const [
    totalBookings,
    totalCustomers,
    totalAstrologers,
    totalRevenue,
    completedBookings,
    pendingBookings,
    cancelledBookings,
    reportsGenerated
  ] = await Promise.all([
    prisma.booking.count(),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.astrologerProfile.count(),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.booking.count({ where: { status: 'COMPLETED' } }),
    prisma.booking.count({ where: { status: 'PENDING' } }),
    prisma.booking.count({ where: { status: 'CANCELLED' } }),
    prisma.report.count()
  ]);

  // Get revenue by month (last 6 months)
  const sixMonthsAgo = subDays(new Date(), 180);
  const monthlyRevenue = await prisma.payment.findMany({
    where: {
      status: 'SUCCESS',
      createdAt: { gte: sixMonthsAgo }
    },
    select: {
      amount: true,
      createdAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  // Group by month
  const revenueByMonth = monthlyRevenue.reduce((acc, payment) => {
    const month = format(payment.createdAt, 'yyyy-MM');
    acc[month] = (acc[month] || 0) + payment.amount;
    return acc;
  }, {});

  return {
    summary: {
      totalBookings,
      totalCustomers,
      totalAstrologers,
      totalRevenue: totalRevenue._sum.amount || 0,
      completedBookings,
      pendingBookings,
      cancelledBookings,
      reportsGenerated
    },
    revenueByMonth: Object.entries(revenueByMonth).map(([month, amount]) => ({
      month,
      amount
    }))
  };
};

// Delete report
export const deleteReport = async (reportId, userId, role) => {
  if (role !== 'ADMIN') {
    throw new Error('Only admins can delete reports');
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId }
  });

  if (!report) {
    throw new Error('Report not found');
  }

  await prisma.report.delete({
    where: { id: reportId }
  });

  return { success: true, message: 'Report deleted' };
};
