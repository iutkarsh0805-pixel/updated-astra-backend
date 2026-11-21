// Admin Controllers
import {
  getAllUsers,
  getAllAstrologers,
  getAllBookings,
  getDashboardData,
  updateUserStatus,
  updateAstrologerVerification,
  getSystemHealth,
  exportBookings,
  exportUsers
} from '../services/admin.service.js';
import { prisma } from '../../../lib/prisma.js';

export const getUsers = async (req, res, next) => {
  try {
    const filters = {
      role: req.query.role,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    };
    const result = await getAllUsers(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getAstrologers = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    };
    const result = await getAllAstrologers(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getBookings = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      bookingId: req.query.bookingId,
      customerId: req.query.customerId,
      astrologerId: req.query.astrologerId,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    };
    const result = await getAllBookings(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req, res, next) => {
  try {
    const dashboard = await getDashboardData();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    next(error);
  }
};

export const getUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        passwordCredential: false
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const updateUserStatusController = async (req, res, next) => {
  try {
    const user = await updateUserStatus(req.params.id, req.body.status);
    res.json({
      success: true,
      message: 'User status updated',
      data: user
    });
  } catch (error) {
    next(error);
  }
};

export const updateAstrologerVerificationController = async (req, res, next) => {
  try {
    const astrologer = await updateAstrologerVerification(req.params.id, req.body.status);
    res.json({
      success: true,
      message: 'Astrologer verification status updated',
      data: astrologer
    });
  } catch (error) {
    if (error.message === 'Astrologer not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getSystemHealthController = async (req, res, next) => {
  try {
    const health = await getSystemHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    next(error);
  }
};

export const exportBookingsController = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 100
    };
    const data = await exportBookings(filters);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const exportUsersController = async (req, res, next) => {
  try {
    const data = await exportUsers();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};