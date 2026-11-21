import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';

test('health endpoint responds successfully', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});

test('unknown route returns 404 JSON', async () => {
  const response = await request(app).get('/api/v1/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
});

test('login rejects missing credentials', async () => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({});
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});
