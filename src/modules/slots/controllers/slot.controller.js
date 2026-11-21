// Slot Controllers
import { getAvailableSlots, createSlots, getSlotById, updateSlot, deleteSlot } from '../services/slot.service.js';
import { prisma } from '../../../lib/prisma.js';
import { hashToken } from '../../auth/middlewares/auth.middleware.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export const listAvailableSlots = async (req, res, next) => {
  try {
    const astrologerId = req.query.astrologerId;
    const date = req.query.date;

    if (!astrologerId) {
      return res.status(400).json({
        success: false,
        message: 'Astrologer ID is required'
      });
    }

    const slots = await getAvailableSlots(astrologerId, date);

    res.json({
      success: true,
      data: slots
    });
  } catch (error) {
    next(error);
  }
};

export const createSlotsForAstrologer = async (req, res, next) => {
  try {
    const astrologerId = req.params.astrologerId;

    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: req.user.userId }
    });

    if (!astrologer || astrologerId !== astrologer.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to create slots for this astrologer'
      });
    }

    const slots = await createSlots(astrologerId, req.body.slots);

    res.status(201).json({
      success: true,
      message: 'Slots created successfully',
      data: slots
    });
  } catch (error) {
    next(error);
  }
};

export const getSlot = async (req, res, next) => {
  try {
    const slot = await getSlotById(req.params.id);

    if (!slot) {
      return res.status(404).json({
        success: false,
        message: 'Slot not found'
      });
    }

    res.json({
      success: true,
      data: slot
    });
  } catch (error) {
    next(error);
  }
};

export const updateSlotController = async (req, res, next) => {
  try {
    const slot = await prisma.slot.findUnique({
      where: { id: req.params.id }
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found' });
    }

    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: req.user.userId }
    });

    if (!astrologer || slot.astrologerId !== astrologer.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updatedSlot = await updateSlot(req.params.id, req.body);

    res.json({
      success: true,
      message: 'Slot updated successfully',
      data: updatedSlot
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSlotController = async (req, res, next) => {
  try {
    const slot = await prisma.slot.findUnique({
      where: { id: req.params.id }
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found' });
    }

    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId: req.user.userId }
    });

    if (!astrologer || slot.astrologerId !== astrologer.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await deleteSlot(req.params.id);

    res.json({
      success: true,
      message: 'Slot deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const mySlots = async (req, res, next) => {
  try {
    const slots = await prisma.slot.findMany({
      where: { astrologer: { userId: req.user.userId } },
      orderBy: { startTime: 'asc' }
    });

    res.json({
      success: true,
      data: slots
    });
  } catch (error) {
    next(error);
  }
};