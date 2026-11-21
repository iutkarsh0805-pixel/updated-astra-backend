import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const isConfigured = Boolean(
  SMTP_HOST &&
  SMTP_USER &&
  SMTP_PASS &&
  SMTP_USER !== 'your-email@gmail.com' &&
  SMTP_PASS !== 'your-email-password'
);

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  : null;

export const sendEmail = async ({ to, subject, text, html }) => {
  if (!transporter) {
    return { delivered: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  const result = await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@astra.com',
    to,
    subject,
    text,
    html
  });

  return { delivered: true, messageId: result.messageId };
};

export const emailConfigured = Boolean(transporter);
