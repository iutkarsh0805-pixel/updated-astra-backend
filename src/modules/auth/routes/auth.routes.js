import express from 'express';
import { register, login, refresh, logout, verify, getProfile } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { validateRegistration, validateLogin } from '../../../utils/validators.js';

const router = express.Router();

// Public routes
router.post('/register', validateRegistration, register);
router.post('/login', validateLogin, login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected routes
router.get('/verify', requireAuth, verify);
router.get('/profile', requireAuth, getProfile);

// OAuth callback
router.get('/google/callback', (req, res) => {
  res.redirect(`/api/v1/meetings/google/callback${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
});

export default router;