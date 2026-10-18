import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  CorsConfigError,
  normalizeOrigin,
  parseAllowedOrigins,
} from '../src/config/cors.js';

const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
const DISALLOWED_ORIGIN = 'http://sitio-no-autorizado.example';

describe('normalizeOrigin', () => {
  it('acepta un origen http/https y lo devuelve en forma canonica', () => {
    expect(normalizeOrigin('http://127.0.0.1:5173')).toBe(ALLOWED_ORIGIN);
    expect(normalizeOrigin('  http://127.0.0.1:5173  ')).toBe(ALLOWED_ORIGIN);
    expect(normalizeOrigin('http://127.0.0.1:5173/')).toBe(ALLOWED_ORIGIN);
    expect(normalizeOrigin('https://app.example.com')).toBe(
      'https://app.example.com',
    );
  });

  it('rechaza el comodin "*"', () => {
    expect(normalizeOrigin('*')).toBeNull();
  });

  it('rechaza valores sin protocolo, con ruta, consulta, fragmento o credenciales', () => {
    expect(normalizeOrigin('127.0.0.1:5173')).toBeNull();
    expect(normalizeOrigin('ftp://127.0.0.1:5173')).toBeNull();
    expect(normalizeOrigin('http://127.0.0.1:5173/app')).toBeNull();
    expect(normalizeOrigin('http://127.0.0.1:5173?a=1')).toBeNull();
    expect(normalizeOrigin('http://127.0.0.1:5173#frag')).toBeNull();
    expect(normalizeOrigin('http://usuario:clave@127.0.0.1:5173')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('parseAllowedOrigins', () => {
  it('divide por comas, recorta espacios, normaliza y elimina duplicados', () => {
    expect(
      parseAllowedOrigins(
        ' http://127.0.0.1:5173 , https://app.example.com , http://127.0.0.1:5173/ ',
      ),
    ).toEqual(['http://127.0.0.1:5173', 'https://app.example.com']);
  });

  it('lanza CorsConfigError sin incluir el valor invalido cuando una entrada es invalida', () => {
    const entry = 'valor-invalido-con-secreto';
    let caught: unknown;
    try {
      parseAllowedOrigins(entry);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CorsConfigError);
    expect((caught as Error).message).toContain('CORS_ALLOWED_ORIGINS');
    expect((caught as Error).message).not.toContain(entry);
  });

  it('lanza error si la lista queda vacia', () => {
    expect(() => parseAllowedOrigins('   ')).toThrowError(CorsConfigError);
  });
});

describe('CORS en la aplicacion', () => {
  const app = buildApp({ logger: false, corsAllowedOrigins: [ALLOWED_ORIGIN] });

  afterAll(async () => {
    await app.close();
  });

  it('responde con Access-Control-Allow-Origin a una peticion simple del origen autorizado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('responde al preflight OPTIONS del origen autorizado e incluye metodos y Authorization', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/auth/profile',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(
      String(response.headers['access-control-allow-headers']).toLowerCase(),
    ).toContain('authorization');
  });

  it('NO autoriza un origen no permitido en una peticion simple', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: DISALLOWED_ORIGIN },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('NO autoriza el preflight de un origen no permitido', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/auth/profile',
      headers: {
        origin: DISALLOWED_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('no relaja la autenticacion: una ruta protegida sigue exigiendo token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/profile',
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('fail-closed: sin origenes configurados no se autoriza ninguno', async () => {
    const closed = buildApp({ logger: false });

    try {
      const response = await closed.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: ALLOWED_ORIGIN },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await closed.close();
    }
  });
});
