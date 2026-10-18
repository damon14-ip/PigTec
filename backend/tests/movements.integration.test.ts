import { describe, expect, it } from 'vitest';

/**
 * Prueba de INTEGRACION de movimientos contra un backend Fastify en ejecucion
 * (y, por tanto, contra PigTecBD con la identidad del usuario del token).
 *
 * DESHABILITADA POR DEFECTO. Solo se ejecuta si existen las tres variables:
 *   PIGTEC_E2E_BASE_URL   p. ej. http://127.0.0.1:3000
 *   PIGTEC_E2E_TOKEN      JWT de un usuario OPERATIVO real (admin/manager/operator)
 *   PIGTEC_E2E_WRITE=1    confirmacion explicita: esta suite MUTA DATOS.
 * Opcional:
 *   PIGTEC_E2E_RESTORE=1  devuelve el animal a su corral original al terminar.
 *
 * ADVERTENCIAS (leer antes de ejecutar):
 *   - MUTA DATOS: el primer test cambia `current_pen_id` del animal elegido y
 *     crea una fila en `animal_movements`, que es HISTORIAL INMUTABLE (005):
 *     esa fila NO se puede borrar ni editar. Usar datos SINTETICOS.
 *   - Usa el JWT real de un usuario operativo; nunca `service_role` ni el rol de
 *     propietario de la base. No crea usuarios ni cuentas.
 *   - No verifica RLS por si misma: valida el flujo HTTP real (backend -> trigger
 *     -> animals.current_pen_id).
 *
 * Ejemplo (PowerShell), con el backend levantado (`npm run dev`):
 *   $env:PIGTEC_E2E_BASE_URL = 'http://127.0.0.1:3000'
 *   $env:PIGTEC_E2E_TOKEN    = '<jwt de un operator>'
 *   $env:PIGTEC_E2E_WRITE    = '1'
 *   npm run test:integration
 */

const BASE_URL = process.env.PIGTEC_E2E_BASE_URL;
const TOKEN = process.env.PIGTEC_E2E_TOKEN;
const RESTORE = process.env.PIGTEC_E2E_RESTORE === '1';
/** Doble candado: sin PIGTEC_E2E_WRITE=1 no se ejecuta (esta suite MUTA datos). */
const ENABLED =
  Boolean(BASE_URL && TOKEN) && process.env.PIGTEC_E2E_WRITE === '1';

interface AnimalRow {
  id: string;
  status: string;
  current_pen_id: string | null;
}

interface PenRow {
  id: string;
  status: string;
}

interface MovementRow {
  id: string;
  animal_id: string;
  from_pen_id: string | null;
  to_pen_id: string | null;
  reason: string;
  recorded_by: string | null;
}

async function api(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

describe.skipIf(!ENABLED)('movements: integracion real (opt-in)', () => {
  it('un movimiento interno valido registra historial y actualiza la ubicacion', async () => {
    const animalsResponse = await api('/animals?status=active');
    expect(animalsResponse.status).toBe(200);
    const animals = animalsResponse.body as AnimalRow[];
    const animal = animals.find((a) => a.current_pen_id !== null);
    if (!animal) {
      throw new Error(
        'Se necesita al menos un porcino activo con corral asignado (datos sinteticos).',
      );
    }

    const pensResponse = await api('/pens?status=active');
    expect(pensResponse.status).toBe(200);
    const pens = pensResponse.body as PenRow[];
    const destination = pens.find((p) => p.id !== animal.current_pen_id);
    if (!destination) {
      throw new Error(
        'Se necesita un segundo corral activo distinto del actual (datos sinteticos).',
      );
    }

    const originalPen = animal.current_pen_id;

    const created = await api('/movements', {
      method: 'POST',
      body: {
        animal_id: animal.id,
        reason: 'management',
        to_pen_id: destination.id,
      },
    });
    expect(created.status).toBe(201);
    const movement = created.body as MovementRow;
    expect(movement.animal_id).toBe(animal.id);
    expect(movement.to_pen_id).toBe(destination.id);
    expect(movement.recorded_by).not.toBeNull();

    // El trigger `apply_animal_movement` deriva la ubicacion en la misma
    // transaccion; el backend NO la toca.
    const after = await api(`/animals/${animal.id}`);
    expect(after.status).toBe(200);
    expect((after.body as AnimalRow).current_pen_id).toBe(destination.id);

    const history = await api(`/animals/${animal.id}/movements`);
    expect(history.status).toBe(200);
    expect((history.body as MovementRow[]).some((m) => m.id === movement.id)).toBe(
      true,
    );

    if (RESTORE && originalPen) {
      const restore = await api('/movements', {
        method: 'POST',
        body: {
          animal_id: animal.id,
          reason: 'management',
          from_pen_id: destination.id,
          to_pen_id: originalPen,
        },
      });
      expect(restore.status).toBe(201);
    }
  });

  it('un movimiento interno sin destino es rechazado', async () => {
    const animalsResponse = await api('/animals?status=active');
    const animal = (animalsResponse.body as AnimalRow[])[0];
    if (!animal) {
      throw new Error('Se necesita al menos un porcino activo (datos sinteticos).');
    }

    const response = await api('/movements', {
      method: 'POST',
      body: { animal_id: animal.id, reason: 'management' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_request' });
  });

  it('un movimiento al mismo corral actual es rechazado', async () => {
    const animalsResponse = await api('/animals?status=active');
    const animal = (animalsResponse.body as AnimalRow[]).find(
      (a) => a.current_pen_id !== null,
    );
    if (!animal || !animal.current_pen_id) {
      throw new Error(
        'Se necesita un porcino activo con corral para esta comprobacion.',
      );
    }

    const response = await api('/movements', {
      method: 'POST',
      body: {
        animal_id: animal.id,
        reason: 'management',
        to_pen_id: animal.current_pen_id,
      },
    });
    expect(response.status).toBe(400);
  });
});
