import { beforeAll, describe, expect, it } from 'vitest';
import { api, newRunId, readE2EConfig, type E2EConfig } from './support/e2e.js';

/**
 * Sprint 4 - Integracion CON ESCRITURA (opt-in explicito).
 *
 * !!! ADVERTENCIA: ESTA SUITE MUTA DATOS EN PigTecBD !!!
 *
 * Doble candado para ejecutarla:
 *   1. PIGTEC_E2E_BASE_URL + PIGTEC_E2E_TOKEN  -> habilita la integracion.
 *   2. PIGTEC_E2E_WRITE=1                      -> autoriza la ESCRITURA.
 *
 * El token debe ser de un usuario ACTIVO con rol `admin` o `manager` (el alta
 * de porcinos, areas y corrales exige ese rol).
 *
 * QUE CREA (PERMANENTE; no se puede deshacer por HTTP):
 *   - 1 area sintetica y 2 corrales activos (marcados `[PRUEBA E2E Sprint4]`).
 *   - PORCINOS con codigo PIG autogenerado y arete `E2E4-<runId>-*`.
 *   - 1 movimiento interno (historial INMUTABLE: la migracion 005 lo bloquea).
 *   - 1 camada sintetica.
 *   - 1 evento de observacion y 1 de mortalidad (historial INMUTABLE).
 * Los movimientos y los eventos sanitarios NO se borran: NO uses este guion en
 * produccion ni con cuentas reales. Requiere autorizacion explicita.
 *
 * Ejemplo (PowerShell), con el backend levantado (`npm run dev`):
 *   $env:PIGTEC_E2E_BASE_URL = 'http://127.0.0.1:3000'
 *   $env:PIGTEC_E2E_TOKEN    = '<jwt de un admin o manager activo>'
 *   $env:PIGTEC_E2E_WRITE    = '1'
 *   npm run test:integration
 */

const config = readE2EConfig();
const enabled = config !== null && config.writeEnabled;
const RUN_ID = newRunId();

/** UUID valido y sintetico que no corresponde a ningun registro real. */
const UUID_CORRAL_INEXISTENTE = '00000000-0000-4000-8000-0000000000ff';
/** UUID valido y sintetico que no corresponde a ninguna madre real. */
const UUID_MADRE_INEXISTENTE = '00000000-0000-4000-8000-0000000000ab';

function cfg(): E2EConfig {
  if (!config) {
    throw new Error(
      'Faltan PIGTEC_E2E_BASE_URL y/o PIGTEC_E2E_TOKEN: la suite no deberia ejecutarse.',
    );
  }
  return config;
}

interface IdBody {
  id: string;
}

interface AnimalBody {
  id: string;
  animal_code: string;
  created_by: string | null;
  status: string;
  current_pen_id: string | null;
  exit_date: string | null;
}

interface MovementBody {
  id: string;
  animal_id: string;
  from_pen_id: string | null;
  to_pen_id: string | null;
  recorded_by: string | null;
}

interface LitterBody {
  id: string;
  mother_id: string | null;
  father_id: string | null;
  total_born: number | null;
  born_alive: number | null;
  stillborn: number | null;
}

interface HealthEventBody {
  id: string;
  animal_id: string;
  event_type: string;
  recorded_by: string | null;
}

const MARCA = `[PRUEBA E2E Sprint4]`;

const state = {
  userId: '',
  role: '',
  areaId: '',
  penA: '',
  penB: '',
  femaleId: '',
  femaleCode: '',
  maleId: '',
  mortalityId: '',
};

describe.skipIf(!enabled)(
  'Sprint 4 - integracion CON ESCRITURA (opt-in explicito, MUTA PigTecBD)',
  () => {
    beforeAll(async () => {
      const me = await api(cfg(), '/auth/me');
      if (me.status !== 200) {
        throw new Error(
          'PIGTEC_E2E_TOKEN no es un JWT valido (GET /auth/me). No se escribe nada.',
        );
      }
      state.userId = (me.body as IdBody).id;

      const profile = await api(cfg(), '/auth/profile');
      if (profile.status !== 200) {
        throw new Error(
          'El token debe ser de un usuario operativo ACTIVO (GET /auth/profile). No se escribe nada.',
        );
      }
      state.role = (profile.body as { role: string }).role;
      if (state.role !== 'admin' && state.role !== 'manager') {
        throw new Error(
          `Las pruebas de escritura requieren rol admin o manager; el token es "${state.role}". No se escribe nada.`,
        );
      }

      // Catalogo sintetico: area propia de la corrida + dos corrales activos.
      const area = await api(cfg(), '/areas', {
        method: 'POST',
        body: {
          name: `${MARCA} Area ${RUN_ID}`,
          description: 'Dato SINTETICO de pruebas de integracion.',
        },
      });
      expect(area.status, 'crear area sintetica').toBe(201);
      state.areaId = (area.body as IdBody).id;

      const penA = await api(cfg(), '/pens', {
        method: 'POST',
        body: {
          area_id: state.areaId,
          code: `E2E-${RUN_ID}-A`,
          name: `${MARCA} Corral A`,
        },
      });
      expect(penA.status, 'crear corral sintetico A').toBe(201);
      state.penA = (penA.body as IdBody).id;

      const penB = await api(cfg(), '/pens', {
        method: 'POST',
        body: {
          area_id: state.areaId,
          code: `E2E-${RUN_ID}-B`,
          name: `${MARCA} Corral B`,
        },
      });
      expect(penB.status, 'crear corral sintetico B').toBe(201);
      state.penB = (penB.body as IdBody).id;
    });

    it('1. POST /animals sin animal_code responde 201, genera PIG-XXXXXX y guarda created_by del JWT', async () => {
      const female = await api(cfg(), '/animals', {
        method: 'POST',
        body: {
          sex: 'female',
          origin: 'born_on_farm',
          current_pen_id: state.penA,
          ear_tag_code: `E2E-${RUN_ID}-H`,
          notes: `${MARCA} Hembra ${RUN_ID}`,
        },
      });
      expect(female.status).toBe(201);
      const body = female.body as AnimalBody;
      expect(body.animal_code).toMatch(/^PIG-\d{6}$/);
      expect(body.created_by).toBe(state.userId);
      expect(body.status).toBe('active');
      expect(body.current_pen_id).toBe(state.penA);
      state.femaleId = body.id;
      state.femaleCode = body.animal_code;

      const male = await api(cfg(), '/animals', {
        method: 'POST',
        body: {
          sex: 'male',
          origin: 'born_on_farm',
          ear_tag_code: `E2E-${RUN_ID}-M`,
          notes: `${MARCA} Macho ${RUN_ID}`,
        },
      });
      expect(male.status).toBe(201);
      const maleBody = male.body as AnimalBody;
      state.maleId = maleBody.id;

      // El codigo es unico y no lo elige el cliente.
      expect(maleBody.animal_code).toMatch(/^PIG-\d{6}$/);
      expect(maleBody.animal_code).not.toBe(state.femaleCode);
    });

    it('2. POST /movements valido cambia current_pen_id via trigger y registra historial', async () => {
      if (!state.femaleId) {
        throw new Error('Prerrequisito: la prueba 1 debe crear la hembra.');
      }

      const created = await api(cfg(), '/movements', {
        method: 'POST',
        body: {
          animal_id: state.femaleId,
          reason: 'management',
          to_pen_id: state.penB,
          notes: `${MARCA} Traslado ${RUN_ID}`,
        },
      });
      expect(created.status).toBe(201);
      const movement = created.body as MovementBody;
      expect(movement.animal_id).toBe(state.femaleId);
      expect(movement.from_pen_id).toBe(state.penA);
      expect(movement.to_pen_id).toBe(state.penB);
      expect(movement.recorded_by).toBe(state.userId);

      // El trigger `apply_animal_movement` deriva la ubicacion; el backend no la toca.
      const after = await api(cfg(), `/animals/${state.femaleId}`);
      expect(after.status).toBe(200);
      expect((after.body as AnimalBody).current_pen_id).toBe(state.penB);

      const history = await api(cfg(), `/animals/${state.femaleId}/movements`);
      expect(history.status).toBe(200);
      expect(
        (history.body as MovementBody[]).some((m) => m.id === movement.id),
      ).toBe(true);
    });

    it('3. POST /movements invalido se rechaza y NO altera al animal', async () => {
      if (!state.femaleId) {
        throw new Error('Prerrequisito: la prueba 1 debe crear la hembra.');
      }

      const before = await api(cfg(), `/animals/${state.femaleId}/movements`);
      expect(before.status).toBe(200);
      const beforeIds = (before.body as MovementBody[]).map((m) => m.id).sort();

      // (a) El destino no puede ser el corral actual.
      const mismoCorral = await api(cfg(), '/movements', {
        method: 'POST',
        body: {
          animal_id: state.femaleId,
          reason: 'management',
          to_pen_id: state.penB,
        },
      });
      expect(mismoCorral.status).toBe(400);
      expect(mismoCorral.body).toEqual({ error: 'invalid_request' });

      // (b) El origen informado no coincide con la ubicacion actual.
      const origenIncoherente = await api(cfg(), '/movements', {
        method: 'POST',
        body: {
          animal_id: state.femaleId,
          reason: 'management',
          from_pen_id: state.penA,
          to_pen_id: state.penA,
        },
      });
      expect(origenIncoherente.status).toBe(400);

      // (c) El corral destino no existe.
      const destinoInexistente = await api(cfg(), '/movements', {
        method: 'POST',
        body: {
          animal_id: state.femaleId,
          reason: 'management',
          to_pen_id: UUID_CORRAL_INEXISTENTE,
        },
      });
      expect(destinoInexistente.status).toBe(422);
      expect(destinoInexistente.body).toEqual({ error: 'invalid_reference' });

      // El animal no cambio de ubicacion...
      const animal = await api(cfg(), `/animals/${state.femaleId}`);
      expect((animal.body as AnimalBody).current_pen_id).toBe(state.penB);

      // ...ni se anadio historial.
      const after = await api(cfg(), `/animals/${state.femaleId}/movements`);
      const afterIds = (after.body as MovementBody[]).map((m) => m.id).sort();
      expect(afterIds).toEqual(beforeIds);
    });

    it('4. POST /litters registra la camada con madre hembra y padre macho validos', async () => {
      if (!state.femaleId || !state.maleId) {
        throw new Error('Prerrequisito: la prueba 1 debe crear hembra y macho.');
      }

      const created = await api(cfg(), '/litters', {
        method: 'POST',
        body: {
          mother_id: state.femaleId,
          father_id: state.maleId,
          total_born: 10,
          born_alive: 8,
          stillborn: 2,
          notes: `${MARCA} Camada ${RUN_ID}`,
        },
      });
      expect(created.status).toBe(201);
      const litter = created.body as LitterBody;
      expect(litter.mother_id).toBe(state.femaleId);
      expect(litter.father_id).toBe(state.maleId);
      expect(litter.total_born).toBe(10);
      expect(litter.born_alive).toBe(8);
      expect(litter.stillborn).toBe(2);

      const detail = await api(cfg(), `/litters/${litter.id}`);
      expect(detail.status).toBe(200);

      const offspring = await api(cfg(), `/litters/${litter.id}/offspring`);
      expect(offspring.status).toBe(200);
      expect(offspring.body).toEqual([]);
    });

    it('5. POST /litters rechaza cantidades incoherentes y sexos incorrectos', async () => {
      // born_alive no puede superar total_born (misma regla que el CHECK de la base).
      const cantidades = await api(cfg(), '/litters', {
        method: 'POST',
        body: {
          mother_id: state.femaleId,
          total_born: 10,
          born_alive: 11,
        },
      });
      expect(cantidades.status).toBe(400);
      expect(cantidades.body).toEqual({ error: 'invalid_request' });

      // La madre debe ser hembra.
      const madreMacho = await api(cfg(), '/litters', {
        method: 'POST',
        body: { mother_id: state.maleId },
      });
      expect(madreMacho.status).toBe(400);

      // El padre debe ser macho.
      const padreHembra = await api(cfg(), '/litters', {
        method: 'POST',
        body: { mother_id: state.femaleId, father_id: state.femaleId },
      });
      expect(padreHembra.status).toBe(400);

      // La madre indicada debe existir y ser visible.
      const madreInexistente = await api(cfg(), '/litters', {
        method: 'POST',
        body: { mother_id: UUID_MADRE_INEXISTENTE },
      });
      expect(madreInexistente.status).toBe(422);
      expect(madreInexistente.body).toEqual({ error: 'invalid_reference' });
    });

    it('6. POST /health-events registra un evento sanitario valido', async () => {
      const created = await api(cfg(), '/health-events', {
        method: 'POST',
        body: {
          animal_id: state.femaleId,
          event_type: 'observation',
          title: `${MARCA} Observacion ${RUN_ID}`,
          description: 'Dato sintetico de integracion.',
          details: { run: RUN_ID },
        },
      });
      expect(created.status).toBe(201);
      const event = created.body as HealthEventBody;
      expect(event.animal_id).toBe(state.femaleId);
      expect(event.event_type).toBe('observation');
      expect(event.recorded_by).toBe(state.userId);

      const history = await api(cfg(), `/animals/${state.femaleId}/health-events`);
      expect(history.status).toBe(200);
      expect(
        (history.body as HealthEventBody[]).some((e) => e.id === event.id),
      ).toBe(true);
    });

    it('7. POST /health-events de mortalidad deriva status=dead y campos derivados', async () => {
      const created = await api(cfg(), '/animals', {
        method: 'POST',
        body: {
          sex: 'unknown',
          origin: 'unknown',
          notes: `${MARCA} Mortalidad ${RUN_ID}`,
        },
      });
      expect(created.status).toBe(201);
      state.mortalityId = (created.body as AnimalBody).id;

      const mortality = await api(cfg(), '/health-events', {
        method: 'POST',
        body: {
          animal_id: state.mortalityId,
          event_type: 'mortality',
          title: `${MARCA} Mortalidad ${RUN_ID}`,
        },
      });
      expect(mortality.status).toBe(201);

      // El trigger `apply_mortality_event` deriva el estado y los campos de salida.
      const after = await api(cfg(), `/animals/${state.mortalityId}`);
      expect(after.status).toBe(200);
      const animal = after.body as AnimalBody;
      expect(animal.status).toBe('dead');
      expect(animal.exit_date).not.toBeNull();
      expect(animal.current_pen_id).toBeNull();

      // Un porcino muerto no admite un segundo evento sanitario.
      const segunda = await api(cfg(), '/health-events', {
        method: 'POST',
        body: {
          animal_id: state.mortalityId,
          event_type: 'mortality',
          title: `${MARCA} Segunda mortalidad`,
        },
      });
      expect(segunda.status).toBe(400);
      expect(segunda.body).toEqual({ error: 'invalid_request' });
    });

    it('8. seguridad: sin JWT 401, animal_code inmutable y rol sin escritura 403', async () => {
      const sinToken = await api(cfg(), '/animals', {
        method: 'POST',
        token: null,
        body: { sex: 'male' },
      });
      expect(sinToken.status).toBe(401);

      // La API rechaza `animal_code` en la actualizacion (esquema estricto) y el
      // codigo permanece intacto.
      const patch = await api(cfg(), `/animals/${state.femaleId}`, {
        method: 'PATCH',
        body: { animal_code: 'PIG-999999' },
      });
      expect(patch.status).toBe(400);
      expect(patch.body).toEqual({ error: 'invalid_body' });

      const after = await api(cfg(), `/animals/${state.femaleId}`);
      expect((after.body as AnimalBody).animal_code).toBe(state.femaleCode);

      const viewerToken = cfg().viewerToken;
      if (viewerToken) {
        const viewerWrite = await api(cfg(), '/animals', {
          method: 'POST',
          token: viewerToken,
          body: { animal_code: 'PIG-999999' },
        });
        expect(viewerWrite.status).toBe(403);
        expect(viewerWrite.body).toEqual({ error: 'forbidden' });
      }
    });
  },
);
