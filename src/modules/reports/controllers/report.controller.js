// Report Controllers
import {
  initializeReport,
  getReportByBooking,
  updateReport,
  getCustomerReports,
  getAstrologerReports,
  getAnalytics,
  deleteReport
} from '../services/report.service.js';

export const initializeReportController = async (req, res, next) => {
  try {
    const report = await initializeReport(req.body.bookingId, req.user.userId);
    res.status(201).json({
      success: true,
      message: 'Report initialized',
      data: report
    });
  } catch (error) {
    if (error.message === 'Booking not found' || error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getReportByBookingController = async (req, res, next) => {
  try {
    const report = await getReportByBooking(
      req.params.bookingId,
      req.user.userId,
      req.user.role
    );

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found or access denied'
      });
    }

    res.json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
};

export const updateReportController = async (req, res, next) => {
  try {
    const report = await updateReport(
      req.params.reportId,
      req.user.userId,
      req.body
    );

    res.json({
      success: true,
      message: 'Report updated',
      data: report
    });
  } catch (error) {
    if (error.message === 'Report not found' || error.message === 'Not authorized') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getCustomerReportsController = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await getCustomerReports(req.user.userId, page, limit);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getAstrologerReportsController = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await getAstrologerReports(req.user.userId, page, limit);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getAnalyticsController = async (req, res, next) => {
  try {
    const filters = {
      days: req.query.days,
      period: req.query.period
    };

    const analytics = await getAnalytics(filters);
    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};

export const deleteReportController = async (req, res, next) => {
  try {
    const result = await deleteReport(req.params.reportId, req.user.userId, req.user.role);
    res.json(result);
  } catch (error) {
    if (error.message === 'Only admins can delete reports' || error.message === 'Report not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};