// Service Controllers
import {
  getMyServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
  searchServices,
  getFeaturedServices,
  getServiceAnalytics
} from '../services/service.service.js';
import { prisma } from '../../../lib/prisma.js';

export const listMyServices = async (req, res, next) => {
  try {
    const services = await getMyServices(req.user.userId);
    res.json({ success: true, data: services });
  } catch (error) {
    next(error);
  }
};

export const getService = async (req, res, next) => {
  try {
    const service = await getServiceById(
      req.params.id,
      req.user?.userId,
      req.user?.role || 'CUSTOMER'
    );

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    res.json({ success: true, data: service });
  } catch (error) {
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const createServiceController = async (req, res, next) => {
  try {
    const service = await createService({
      ...req.body,
      creatorId: req.user.userId
    });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: service
    });
  } catch (error) {
    if (error.message === 'Astrologer profile not found') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const updateServiceController = async (req, res, next) => {
  try {
    const service = await updateService(req.params.id, req.user.userId, req.body);
    res.json({
      success: true,
      message: 'Service updated successfully',
      data: service
    });
  } catch (error) {
    if (error.message === 'Service not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized to update this service') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const deleteServiceController = async (req, res, next) => {
  try {
    await deleteService(req.params.id, req.user.userId);
    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (error) {
    if (error.message === 'Service not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized to delete this service') {
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message === 'Cannot delete service with active bookings') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const searchServicesController = async (req, res, next) => {
  try {
    const { category, page, limit } = req.query;
    const result = await searchServices(category, parseInt(page) || 1, parseInt(limit) || 10);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getFeaturedServicesController = async (req, res, next) => {
  try {
    const { limit } = req.query;
    const services = await getFeaturedServices(parseInt(limit) || 10);
    res.json({ success: true, data: services });
  } catch (error) {
    next(error);
  }
};

export const getServiceAnalyticsController = async (req, res, next) => {
  try {
    const analytics = await getServiceAnalytics(req.params.id, req.user.userId);
    res.json({ success: true, data: analytics });
  } catch (error) {
    if (error.message === 'Service not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};