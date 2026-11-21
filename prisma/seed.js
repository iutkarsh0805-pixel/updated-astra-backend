// Prisma Seed Script for Astra Astrology Platform
// Run with: npx prisma db seed

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import argon2 from 'argon2';

async function main() {
  console.log('Starting seed...');

  // Create default admin user
  const adminPassword = await argon2.hash('admin123');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@astra.com' },
    update: {},
    create: {
      email: 'admin@astra.com',
      name: 'Admin User',
      role: 'ADMIN',
      isActive: true,
      passwordCredential: {
        create: {
          passwordHash: adminPassword
        }
      }
    }
  });
  console.log(`Created admin user: ${admin.email}`);

  // Create customer user
  const customerPassword = await argon2.hash('customer123');
  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      email: 'customer@example.com',
      name: 'Test Customer',
      role: 'CUSTOMER',
      isActive: true,
      passwordCredential: {
        create: {
          passwordHash: customerPassword
        }
      }
    }
  });
  console.log(`Created customer user: ${customer.email}`);

  // Create default astrologer user
  const astrologerPassword = await argon2.hash('astrologer123');
  const astrologer = await prisma.user.upsert({
    where: { email: 'astrologer@example.com' },
    update: {},
    create: {
      email: 'astrologer@example.com',
      name: 'Test Astrologer',
      role: 'ASTROLOGER',
      isActive: true,
      passwordCredential: {
        create: {
          passwordHash: astrologerPassword
        }
      }
    }
  });
  console.log(`Created astrologer user: ${astrologer.email}`);

  // Create astrologer profile
  const astrologerProfile = await prisma.astrologerProfile.upsert({
    where: { userId: astrologer.id },
    update: {},
    create: {
      userId: astrologer.id,
      displayName: 'Test Astrologer',
      bio: 'Experienced astrologer with 10+ years of practice',
      specialization: ['Vedic Astrology', 'Career Counseling', 'Relationship Advice'],
      experienceYears: 10,
      rating: 4.8,
      consultationFeeRupees: 1000,
      responseTimeMinutes: 30,
      languages: ['en', 'hi'],
      certifications: ['Jyotish Shiksha', 'Career Astrology Certification']
    }
  });
  console.log(`Created astrologer profile for: ${astrologerProfile.displayName}`);

  // Create consultation types
  const consultationTypes = [
    { name: 'General Horoscope', description: 'Daily and monthly horoscope readings', priceMultiplier: 1.0, orderBy: 1 },
    { name: 'Career & Business', description: 'Career guidance and business astrology', priceMultiplier: 1.2, orderBy: 2 },
    { name: 'Love & Relationships', description: 'Relationship and marriage guidance', priceMultiplier: 1.1, orderBy: 3 },
    { name: 'Health & Wellness', description: 'Health-related astrological advice', priceMultiplier: 0.9, orderBy: 4 },
    { name: 'Financial Planning', description: 'Financial growth and money management', priceMultiplier: 1.15, orderBy: 5 },
    { name: 'Education & Exams', description: 'Exam and education guidance', priceMultiplier: 0.85, orderBy: 6 }
  ];

  for (const type of consultationTypes) {
    await prisma.consultationType.upsert({
      where: { name: type.name },
      update: type,
      create: type
    });
  }
  console.log('Created consultation types');

  // Create default availability rule template for astrologer
  await prisma.availabilityRule.create({
    data: {
      astrologerId: astrologerProfile.id,
      dayOfWeek: 1, // Monday
      startTime: '09:00:00',
      endTime: '12:00:00',
      isActive: true
    }
  });

  await prisma.availabilityRule.create({
    data: {
      astrologerId: astrologerProfile.id,
      dayOfWeek: 1, // Monday
      startTime: '14:00:00',
      endTime: '18:00:00',
      isActive: true
    }
  });
  console.log('Created default availability rules');

  // Create sample notification templates
  const templates = [
    {
      type: 'BOOKING_CONFIRMED',
      subject: 'Your Booking is Confirmed',
      bodyTemplate: 'Dear {{customerName}}, your booking with {{astrologerName}} on {{date}} at {{time}} is confirmed.',
      channel: 'EMAIL'
    },
    {
      type: 'BOOKING_CANCELLED',
      subject: 'Booking Cancelled',
      bodyTemplate: 'Your booking has been cancelled. Please contact support for assistance.',
      channel: 'EMAIL'
    },
    {
      type: 'PAYMENT_SUCCESS',
      subject: 'Payment Successful',
      bodyTemplate: 'Your payment of ₹{{amount}} was successful. Thank you for using Astra.',
      channel: 'EMAIL'
    },
    {
      type: 'MEETING_STARTING',
      subject: 'Meeting Starting Soon',
      bodyTemplate: 'Your meeting with {{astrologerName}} will start in 10 minutes. Join here: {{meetingLink}}',
      channel: 'EMAIL'
    },
    {
      type: 'REVIEW_REQUEST',
      subject: 'Share Your Experience',
      bodyTemplate: 'We hope you enjoyed your consultation! Please share your feedback.',
      channel: 'EMAIL'
    },
    {
      type: 'REMINDER',
      subject: 'Appointment Reminder',
      bodyTemplate: 'This is a reminder for your appointment with {{astrologerName}} on {{date}}.',
      channel: 'EMAIL'
    }
  ];

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { type: template.type },
      update: template,
      create: template
    });
  }
  console.log('Created notification templates');

  // Create default system settings
  await prisma.systemSettings.upsert({
    where: { key: 'app_name' },
    update: {},
    create: {
      key: 'app_name',
      value: 'Astra Astrology',
      description: 'Application name'
    }
  });

  await prisma.systemSettings.upsert({
    where: { key: 'currency' },
    update: {},
    create: {
      key: 'currency',
      value: 'INR',
      description: 'Default currency for payments'
    }
  });

  await prisma.systemSettings.upsert({
    where: { key: 'timezone' },
    update: {},
    create: {
      key: 'timezone',
      value: 'Asia/Kolkata',
      description: 'Default timezone'
    }
  });

  console.log('Created system settings');
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });