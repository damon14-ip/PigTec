import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  const app = buildApp({ logger: false });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con { status: "ok" }', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('responde con cabecera content-type JSON', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['content-type']).toContain('application/json');
  });
});
