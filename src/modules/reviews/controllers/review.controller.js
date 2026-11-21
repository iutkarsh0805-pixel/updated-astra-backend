// Review Controllers
import {
  createReview,
  getReviewsByAstrologer,
  getMyReviews,
  getReviewById,
  updateReview,
  deleteReview
} from '../services/review.service.js';

export const createReviewController = async (req, res, next) => {
  try {
    const review = await createReview({
      ...req.body,
      customerId: req.user.userId
    });

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: review
    });
  } catch (error) {
    if (error.message === 'Booking not found' ||
        error.message === 'Can only review after payment is completed' ||
        error.message === 'Not authorized to review this booking' ||
        error.message === 'Review already exists for this booking') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getReviewsByAstrologerController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await getReviewsByAstrologer(
      req.params.astrologerId,
      parseInt(page) || 1,
      parseInt(limit) || 10
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getMyReviewsController = async (req, res, next) => {
  try {
    const reviews = await getMyReviews(req.user.userId);
    res.json({ success: true, data: reviews });
  } catch (error) {
    next(error);
  }
};

export const getReviewController = async (req, res, next) => {
  try {
    const review = await getReviewById(req.params.id);

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    res.json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

export const updateReviewController = async (req, res, next) => {
  try {
    const review = await updateReview(req.params.id, req.user.userId, req.body);
    res.json({
      success: true,
      message: 'Review updated successfully',
      data: review
    });
  } catch (error) {
    if (error.message === 'Review not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized to update this review') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const deleteReviewController = async (req, res, next) => {
  try {
    await deleteReview(req.params.id, req.user.userId);
    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    if (error.message === 'Review not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized to delete this review') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};