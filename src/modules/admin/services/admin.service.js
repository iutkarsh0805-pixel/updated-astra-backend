// Admin Service - Administrative operations
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Get all users with filtering
export const getAllUsers = async (filters = {}) => {
  const where = {};

  if (filters.role) {
    where.role = filters.role;
  }

  const users = await prisma.user.findMany({
    where,
    skip: (filters.page - 1) * (filters.limit || 20),
    take: filters.limit || 20,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      _count: {
        select: { bookings: true }
      }
    }
  });

  const total = await prisma.user.count({ where });

  return {
    data: users,
    total,
    page: filters.page || 1,
    totalPages: Math.ceil(total / (filters.limit || 20))
  };
};

// Get all astrologers
export const getAllAstrologers = async (filters = {}) => {
  const astrologers = await prisma.astrologerProfile.findMany({
    where: filters.status ? { verificationStatus: filters.status } : {},
    skip: (filters.page - 1) * (filters.limit || 20),
    take: filters.limit || 20,
    orderBy: { createdAt: 'desc' },
    include: {
      user: true
    }
  });

  const total = await prisma.astrologerProfile.count({
    where: filters.status ? { verificationStatus: filters.status } : {}
  });

  return {
    data: astrologers,
    total,
    page: filters.page || 1,
    totalPages: Math.ceil(total / (filters.limit || 20))
  };
};

// Get all bookings with filters
export const getAllBookings = async (filters = {}) => {
  const where = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.bookingId) {
    where.id = filters.bookingId;
  }

  if (filters.customerId) {
    where.userId = filters.customerId;
  }

  if (filters.astrologerId) {
    where.astrologerId = filters.astrologerId;
  }

  const bookings = await prisma.booking.findMany({
    where,
    skip: (filters.page - 1) * (filters.limit || 20),
    take: filters.limit || 20,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, email: true, name: true } },
      astrologer: { include: { user: true } },
      slot: true,
      payment: true,
      meeting: true
    }
  });

  const total = await prisma.booking.count({ where });

  return {
    data: bookings,
    total,
    page: filters.page || 1,
    totalPages: Math.ceil(total / (filters.limit || 20))
  };
};

// Get analytics dashboard data
export const getDashboardData = async () => {
  const [
    totalUsers,
    totalAstrologers,
    totalCustomers,
    totalBookings,
    completedBookings,
    totalRevenue,
    pendingPayments,
    recentBookings
  ] = await Promise.all([
    prisma.user.count(),
    prisma.astrologerProfile.count(),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'COMPLETED' } }),
    prisma.payment.aggregate({
      where: { status: 'SUCCESS' },
      _sum: { amount: true }
    }),
    prisma.booking.count({ where: { status: 'PENDING' } }),
    prisma.booking.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
        astrologer: { include: { user: true } }
      }
    })
  ]);

  return {
    stats: {
      totalUsers,
      totalAstrologers,
      totalCustomers,
      totalBookings,
      completedBookings,
      totalRevenue: totalRevenue._sum.amount || 0,
      pendingPayments
    },
    recentBookings,
    revenueByDay: [] // Would require additional querying
  };
};

// Update user status
export const updateUserStatus = async (userId, status) => {
  return await prisma.user.update({
    where: { id: userId },
    data: { isActive: status === 'active' }
  });
};

// Update astrologer verification status
export const updateAstrologerVerification = async (astrologerId, status) => {
  return await prisma.astrologerProfile.update({
    where: { id: astrologerId },
    data: { verificationStatus: status }
  });
};

// Get system health
export const getSystemHealth = async () => {
  const dbHealth = await prisma.$queryRaw`SELECT 1 as health`;

  return {
    database: dbHealth ? 'healthy' : 'unhealthy',
    status: 'healthy',
    timestamp: new Date().toISOString()
  };
};

// Export data (for admin reports)
export const exportBookings = async (filters = {}) => {
  const bookings = await getAllBookings(filters);
  return bookings.data;
};

export const exportUsers = async () => {
  return await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true
    }
  });
};