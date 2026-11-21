// Notification Controllers
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead
} from '../services/notification.service.js';
import { prisma } from '../../../lib/prisma.js';

export const listNotifications = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await getUserNotifications(req.user.userId, page || 1, limit || 20);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getUnreadCountController = async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user.userId);
    res.json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    next(error);
  }
};

export const markAsReadController = async (req, res, next) => {
  try {
    const notification = await markAsRead(req.params.id, req.user.userId);
    res.json({ success: true, message: 'Notification marked as read', data: notification });
  } catch (error) {
    if (error.message === 'Notification not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Not authorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const markAllAsReadController = async (req, res, next) => {
  try {
    await markAllAsRead(req.user.userId);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id }
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (notification.userId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await prisma.notification.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
};