import { describe, expect, it } from 'vitest';
import { api, readE2EConfig, type E2EConfig } from './support/e2e.js';

/**
 * Sprint 4 - Integracion SOLO LECTURA (opt-in).
 *
 * Comprueba, contra un backend Fastify en ejecucion y con la identidad del JWT
 * aportado, que:
 *   - el backend y la cadena de autenticacion/RBAC responden;
 *   - los catalogos operativos son consultables (RLS con la identidad real);
 *   - sin JWT las rutas protegidas responden 401;
 *   - las entradas invalidas se rechazan en el ESQUEMA (400) sin tocar la base;
 *   - un rol sin permisos de escritura responde 403 (si se aporta su token).
 *
 * NINGUNA peticion de este archivo crea, modifica ni borra filas:
 *   - las peticiones POST/PATCH usan cuerpos que el esquema Zod rechaza (400)
 *     antes de llegar a la base, o un token `viewer` que el RBAC corta (403).
 *
 * Requiere:
 *   PIGTEC_E2E_BASE_URL  p. ej. http://127.0.0.1:3000
 *   PIGTEC_E2E_TOKEN     JWT de un usuario OPERATIVO ACTIVO
 * Opcional:
 *   PIGTEC_E2E_VIEWER_TOKEN  JWT de un usuario `viewer` activo
 *
 * Ejemplo (PowerShell), con el backend levantado (`npm run dev`):
 *   $env:PIGTEC_E2E_BASE_URL = 'http://127.0.0.1:3000'
 *   $env:PIGTEC_E2E_TOKEN    = '<jwt de un usuario operativo>'
 *   npm run test:integration
 */

const config = readE2EConfig();
const enabled = config !== null;

/** Configuracion garantizada: los tests solo corren cuando `enabled`. */
function cfg(): E2EConfig {
  if (!config) {
    throw new Error(
      'Faltan PIGTEC_E2E_BASE_URL y/o PIGTEC_E2E_TOKEN: la suite no deberia ejecutarse.',
    );
  }
  return config;
}

/** UUID valido y sintetico (no apunta a ningun registro real). */
const UUID_SINTETICO = '00000000-0000-4000-8000-0000000000aa';

const CATALOGOS = [
  '/animals?status=active',
  '/pens?status=active',
  '/areas?status=active',
  '/litters',
  '/health-events?limit=1',
  '/movements?limit=1',
] as const;

describe.skipIf(!enabled)('Sprint 4 - integracion SOLO LECTURA (opt-in)', () => {
  it('GET /health responde sin autenticacion', async () => {
    const response = await api(cfg(), '/health', { token: null });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /auth/me devuelve la identidad del JWT', async () => {
    const response = await api(cfg(), '/auth/me');
    expect(response.status).toBe(200);
    const body = response.body as { id?: unknown; email?: unknown };
    expect(typeof body.id).toBe('string');
    expect((body.id as string).length).toBeGreaterThan(0);
    // `email` es opcional en la respuesta; si viene, es un texto.
    if ('email' in body && body.email !== undefined) {
      expect(typeof body.email).toBe('string');
    }
  });

  it('GET /auth/profile devuelve un perfil ACTIVO con rol operativo', async () => {
    const response = await api(cfg(), '/auth/profile');
    expect(response.status).toBe(200);
    const body = response.body as { role?: unknown; is_active?: unknown };
    expect(body.is_active).toBe(true);
    expect(['admin', 'manager', 'operator', 'veterinarian']).toContain(
      body.role,
    );
  });

  it.each(CATALOGOS)(
    'el catalogo %s es consultable (RLS con la identidad real)',
    async (path) => {
      const response = await api(cfg(), path);
      expect(response.status, `${path} debe responder 200`).toBe(200);
      expect(
        Array.isArray(response.body),
        `${path} debe devolver un arreglo`,
      ).toBe(true);
    },
  );

  it.each(['/animals', '/litters', '/health-events', '/movements', '/auth/profile'])(
    'sin JWT, %s responde 401',
    async (path) => {
      const response = await api(cfg(), path, { token: null });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'unauthorized' });
    },
  );

  it('un JWT mal formado responde 401', async () => {
    const response = await api(cfg(), '/animals', { token: 'no-es-un-jwt' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('POST /animals rechaza animal_code y status (400, el esquema corta antes de la base)', async () => {
    const conCodigo = await api(cfg(), '/animals', {
      method: 'POST',
      body: { animal_code: 'PIG-999999', sex: 'male' },
    });
    expect(conCodigo.status).toBe(400);
    expect(conCodigo.body).toEqual({ error: 'invalid_body' });

    const conStatus = await api(cfg(), '/animals', {
      method: 'POST',
      body: { sex: 'male', status: 'dead' },
    });
    expect(conStatus.status).toBe(400);
    expect(conStatus.body).toEqual({ error: 'invalid_body' });
  });

  it('PATCH /animals rechaza animal_code (el codigo es inmutable por contrato)', async () => {
    const response = await api(cfg(), `/animals/${UUID_SINTETICO}`, {
      method: 'PATCH',
      body: { animal_code: 'PIG-000001' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_body' });
  });

  it('POST /litters y POST /health-events rechazan payloads invalidos (400)', async () => {
    const litterSinMadre = await api(cfg(), '/litters', {
      method: 'POST',
      body: { total_born: 1 },
    });
    expect(litterSinMadre.status).toBe(400);
    expect(litterSinMadre.body).toEqual({ error: 'invalid_body' });

    const eventoSinTitulo = await api(cfg(), '/health-events', {
      method: 'POST',
      body: { animal_id: UUID_SINTETICO, event_type: 'observation' },
    });
    expect(eventoSinTitulo.status).toBe(400);
    expect(eventoSinTitulo.body).toEqual({ error: 'invalid_body' });

    const detallesNoObjeto = await api(cfg(), '/health-events', {
      method: 'POST',
      body: {
        animal_id: UUID_SINTETICO,
        event_type: 'observation',
        title: 'detalle invalido',
        details: 'no-es-un-objeto',
      },
    });
    expect(detallesNoObjeto.status).toBe(400);
    expect(detallesNoObjeto.body).toEqual({ error: 'invalid_body' });
  });

  it('un rol sin permisos de escritura responde 403 (requiere PIGTEC_E2E_VIEWER_TOKEN)', async () => {
    const viewerToken = cfg().viewerToken;
    if (!viewerToken) {
      // Sin token de `viewer` no se inventa la comprobacion.
      expect(viewerToken).toBeNull();
      return;
    }

    const lectura = await api(cfg(), '/animals', { token: viewerToken });
    expect(lectura.status).toBe(403);
    expect(lectura.body).toEqual({ error: 'forbidden' });

    // El cuerpo es invalido a proposito: si el token no fuera de solo lectura,
    // el esquema responderia 400 (nunca 201), de modo que esta comprobacion
    // JAMAS crea un porcino.
    const escritura = await api(cfg(), '/animals', {
      method: 'POST',
      token: viewerToken,
      body: { animal_code: 'PIG-999999' },
    });
    expect(escritura.status).toBe(403);
    expect(escritura.body).toEqual({ error: 'forbidden' });
  });
});
