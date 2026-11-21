import express from 'express';
import {
  listNotifications,
  getUnreadCountController,
  markAsReadController,
  markAllAsReadController,
  deleteNotification
} from '../controllers/notification.controller.js';
import { requireAuth } from '../../auth/middlewares/auth.middleware.js';

const router = express.Router();

// Protected routes
router.get('/', requireAuth, listNotifications);
router.get('/unread-count', requireAuth, getUnreadCountController);
router.put('/:id/read', requireAuth, markAsReadController);
router.put('/mark-all-read', requireAuth, markAllAsReadController);
router.delete('/:id', requireAuth, deleteNotification);

export default router;