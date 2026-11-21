// Consultation Controllers
import {
  getConsultationByBooking,
  createConsultation,
  updateConsultation,
  getAstrologerConsultations,
  getCustomerConsultations,
  getConsultationTypes
} from '../services/consultation.service.js';

export const getConsultationTypesController = async (req, res, next) => {
  try {
    const types = await getConsultationTypes();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
};

export const getConsultationByBookingController = async (req, res, next) => {
  try {
    const consultation = await getConsultationByBooking(
      req.params.bookingId,
      req.user.userId,
      req.user.role
    );

    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: 'Consultation not found or access denied'
      });
    }

    res.json({ success: true, data: consultation });
  } catch (error) {
    next(error);
  }
};

export const createConsultationController = async (req, res, next) => {
  try {
    const consultation = await createConsultation(req.body);
    res.status(201).json({
      success: true,
      message: 'Consultation created',
      data: consultation
    });
  } catch (error) {
    next(error);
  }
};

export const updateConsultationController = async (req, res, next) => {
  try {
    const consultation = await updateConsultation(
      req.params.consultationId,
      req.user.userId,
      req.body
    );

    res.json({
      success: true,
      message: 'Consultation updated',
      data: consultation
    });
  } catch (error) {
    if (error.message === 'Consultation not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getAstrologerConsultationsController = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await getAstrologerConsultations(
      req.user.userId,
      page,
      limit
    );

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getCustomerConsultationsController = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await getCustomerConsultations(
      req.user.userId,
      page,
      limit
    );

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};