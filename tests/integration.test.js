import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { generateSummary } from '../src/modules/ai/services/ai.service.js';

test('seeded customer can login and access profile', async () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('username:password')) {
    return;
  }

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'customer@example.com', password: 'customer123' });

  assert.equal(login.status, 200);
  assert.ok(login.body.data.accessToken);

  const profile = await request(app)
    .get('/api/v1/auth/profile')
    .set('Authorization', `Bearer ${login.body.data.accessToken}`);

  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.email, 'customer@example.com');
});

test('Gemini summary provider returns text when configured', async () => {
  if (!process.env.GEMINI_API_KEY) {
    return;
  }

  const summary = await generateSummary({
    astrologerName: 'Test Astrologer',
    topics: ['Career'],
    recommendations: ['Review career goals']
  });

  assert.equal(typeof summary, 'string');
  assert.ok(summary.length > 20);
});
