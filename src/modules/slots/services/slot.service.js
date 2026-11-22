// Slot Service
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';

// Get available slots for an astrologer
export const getAvailableSlots = async (astrologerId, date = null) => {
  const where = {
    astrologerId,
    status: 'AVAILABLE',
    bookings: {
      none: {
        status: { in: ['PENDING', 'CONFIRMED'] }
      }
    }
  };

  if (date) {
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    where.date = {
      gte: startDate,
      lte: endDate
    };
  }

  return await prisma.slot.findMany({
    where,
    orderBy: { startTime: 'asc' }
  });
};

// Create slots for an astrologer
export const createSlots = async (astrologerId, slotsData) => {
  const createData = slotsData.map(slot => ({
    astrologerId,
    date: new Date(slot.date),
    startTime: slot.startTime,
    endTime: slot.endTime
  }));

  const slots = await prisma.slot.createMany({
    data: createData,
    skipDuplicates: true
  });

  return slots;
};

// Create a single slot
export const createSlot = async (astrologerId, date, startTime, endTime) => {
  const slot = await prisma.slot.create({
    data: {
      astrologerId,
      date: new Date(date),
      startTime,
      endTime
    }
  });

  return slot;
};

// Get slot by ID
export const getSlotById = async (slotId) => {
  return await prisma.slot.findUnique({
    where: { id: slotId },
    include: {
      astrologer: {
        include: { user: true }
      },
      bookings: true
    }
  });
};

// Update slot availability
export const updateSlot = async (slotId, data) => {
  return await prisma.slot.update({
    where: { id: slotId },
    data
  });
};

// Delete a slot
export const deleteSlot = async (slotId) => {
  return await prisma.slot.delete({
    where: { id: slotId }
  });
};

// Transactional slot reservation
export const reserveSlot = async (slotId, userId, transactionClient = null) => {
  const prismaClient = transactionClient || prisma;

  return await prismaClient.$transaction(async (tx) => {
    // Lock the slot for update
    const slot = await tx.slot.findUnique({
      where: { id: slotId },
      include: { bookings: true }
    });

    if (!slot) {
      throw new Error('Slot not found');
    }

    if (slot.status !== 'AVAILABLE') {
      throw new Error('Slot is not available');
    }

    if (slot.bookings.length > 0) {
      const hasActiveBooking = slot.bookings.some(b =>
        b.status === 'PENDING' || b.status === 'CONFIRMED'
      );
      if (hasActiveBooking) {
        throw new Error('Slot already booked');
      }
    }

    // Mark slot as reserved
    await tx.slot.update({
      where: { id: slotId },
      data: { status: 'RESERVED' }
    });

    return slot;
  });
};

// Get slots for authenticated user (customer or astrologer)
export const getUserSlots = async (userId, role) => {
  if (role === 'ASTROLOGER') {
    const astrologer = await prisma.astrologerProfile.findUnique({
      where: { userId }
    });
    if (!astrologer) return [];

    return await prisma.slot.findMany({
      where: { astrologerId: astrologer.id },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    });
  }

  return await prisma.slot.findMany({
    where: {
      booking: {
        some: { userId }
      }
    },
    orderBy: { startTime: 'asc' }
  });
};