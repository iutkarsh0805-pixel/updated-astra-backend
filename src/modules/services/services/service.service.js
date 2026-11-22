// Service Service - Astrologer Services Management
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Get all services for an astrologer
export const getMyServices = async (userId) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId }
  });

  if (!astrologer) {
    throw new Error('Astrologer profile not found');
  }

  return await prisma.astrologerService.findMany({
    where: { astrologerId: astrologer.id },
    include: {
      service: {
        include: {
          _count: { select: { bookings: true } }
        }
      }
    },
    orderBy: { id: 'desc' }
  });
};

// Get service by ID with bookings
export const getServiceById = async (serviceId, userId, role) => {
  return await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      astrologerServices: {
        include: {
          astrologer: { include: { user: true } }
        }
      },
      _count: { select: { bookings: true } }
    }
  });
};

// Create a service
export const createService = async (data) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId: data.creatorId }
  });

  if (!astrologer) {
    throw new Error('Astrologer profile not found');
  }

  return await prisma.service.create({
    data: {
      title: data.name || data.title,
      category: data.category,
      description: data.description,
      image: data.image || '',
      price: data.price?.amount ?? data.price ?? 0,
      duration: data.durationMinutes || data.duration || 60,
      astrologerServices: {
        create: {
          astrologerId: astrologer.id,
          price: data.price?.amount ?? data.price ?? null
        }
      }
    }
  });
};

// Update a service
export const updateService = async (serviceId, userId, data) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId }
  });

  if (!astrologer) throw new Error('Astrologer profile not found');

  const link = await prisma.astrologerService.findUnique({
    where: {
      astrologerId_serviceId: {
        astrologerId: astrologer.id,
        serviceId
      }
    }
  });

  if (!link) throw new Error('Not authorized to update this service');

  const updatedService = await prisma.service.update({
    where: { id: serviceId },
    data: {
      title: data.name || data.title,
      description: data.description,
      category: data.category,
      duration: data.durationMinutes || data.duration
    }
  });

  if (data.price !== undefined) {
    await prisma.astrologerService.update({
      where: { id: link.id },
      data: { price: data.price?.amount ?? data.price }
    });
  }

  return updatedService;
};

// Delete a service
export const deleteService = async (serviceId, userId) => {
  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId }
  });

  if (!astrologer) throw new Error('Astrologer profile not found');

  const link = await prisma.astrologerService.findUnique({
    where: {
      astrologerId_serviceId: {
        astrologerId: astrologer.id,
        serviceId
      }
    }
  });

  if (!link) throw new Error('Not authorized to delete this service');

  const activeBookings = await prisma.booking.count({
    where: {
      serviceId,
      status: { in: ['PENDING', 'CONFIRMED'] }
    }
  });

  if (activeBookings > 0) {
    throw new Error('Cannot delete service with active bookings');
  }

  await prisma.astrologerService.delete({ where: { id: link.id } });

  const remainingLinks = await prisma.astrologerService.count({
    where: { serviceId }
  });

  if (remainingLinks === 0) {
    await prisma.service.delete({ where: { id: serviceId } });
  }

  return { success: true };
};

// Search services by category
export const searchServices = async (category, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const where = category
    ? { category: { contains: category, mode: 'insensitive' } }
    : {};

  const [services, total] = await Promise.all([
    prisma.service.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        astrologerServices: {
          include: { astrologer: { include: { user: true } } }
        }
      }
    }),
    prisma.service.count({ where })
  ]);

  return {
    data: services,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

// Get featured services
export const getFeaturedServices = async (limit = 10) => {
  return await prisma.service.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      astrologerServices: {
        include: { astrologer: { include: { user: true } } }
      }
    }
  });
};

// Get service analytics
export const getServiceAnalytics = async (serviceId, userId) => {
  const service = await prisma.service.findUnique({
    where: { id: serviceId }
  });

  if (!service) {
    throw new Error('Service not found');
  }

  const astrologer = await prisma.astrologerProfile.findUnique({
    where: { userId }
  });

  if (!astrologer) throw new Error('Astrologer profile not found');

  const link = await prisma.astrologerService.findUnique({
    where: {
      astrologerId_serviceId: {
        astrologerId: astrologer.id,
        serviceId
      }
    }
  });

  if (!link) throw new Error('Not authorized');

  const totalBookings = await prisma.booking.count({
    where: { serviceId: serviceId }
  });

  const completedBookings = await prisma.booking.count({
    where: { serviceId: serviceId, status: 'COMPLETED' }
  });

  const totalRevenue = await prisma.payment.aggregate({
    where: {
      booking: { serviceId: serviceId },
      status: 'SUCCESS'
    },
    _sum: { amount: true }
  });

  const reviews = await prisma.review.findMany({
    where: { booking: { serviceId } },
    include: { user: true },
    orderBy: { rating: 'desc' }
  });

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  return {
    totalBookings,
    completedBookings,
    revenue: totalRevenue._sum.amount || 0,
    averageRating,
    recentReviews: reviews.slice(0, 5)
  };
};