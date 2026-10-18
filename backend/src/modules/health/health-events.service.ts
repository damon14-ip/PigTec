import type { OperationalRole } from '../auth/roles.js';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../common/data-errors.js';
import {
  CLINICAL_EVENT_TYPES,
  HEALTH_EVENT_COMPATIBLE_ANIMAL_STATUSES,
  MORTALITY_EVENT_TYPE,
  OBSERVATION_EVENT_TYPES,
  type HealthEventType,
} from '../common/health-event.js';
import type {
  HealthEvent,
  HealthEventRepository,
  ListHealthEventsFilter,
} from './health-events.repository.js';

/**
 * Identidad y rol del usuario que registra el evento. El rol se resuelve en el
 * servidor (nunca desde el cuerpo) y gobierna que tipos de evento puede
 * registrar.
 */
export interface HealthEventActor {
  id: string;
  role: OperationalRole;
}

/**
 * Matriz de permisos por TIPO de evento (especificacion maestra, 5.1 y 5.2).
 *
 * - Observacion/sintomas (`observation`, `symptom_report`, `other`): cualquier
 *   rol operativo activo (admin, manager, operator, veterinarian).
 * - Clinicos (`documented_diagnosis`, `treatment`, `vaccination`, `deworming`,
 *   `recovery`): solo `veterinarian`. La facultad clinica NO se infiere de
 *   admin/manager (principio de menor privilegio, 5.1); su incorporacion queda
 *   pendiente de la "politica clinica" (decision pendiente, 5.1 y 13).
 * - Mortalidad (`mortality`): admin, manager y veterinarian ("con validacion",
 *   5.1). El `operator` no registra mortalidad.
 *
 * DECISION PENDIENTE (documentada): la especificacion deja "segun politica
 * clinica definida" para admin/manager en diagnosticos/tratamientos/vacunas.
 * Hasta que se defina, se adopta el criterio mas restrictivo (solo
 * veterinarian) y queda sujeto a confirmacion del responsable.
 */
const OPERATIONAL_EVENT_ROLES: readonly OperationalRole[] = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
];
const CLINICAL_EVENT_ROLES: readonly OperationalRole[] = ['veterinarian'];
const MORTALITY_EVENT_ROLES: readonly OperationalRole[] = [
  'admin',
  'manager',
  'veterinarian',
];

/** Roles autorizados a registrar un evento segun su tipo. */
export function allowedHealthEventRoles(
  eventType: HealthEventType,
): readonly OperationalRole[] {
  if ((CLINICAL_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return CLINICAL_EVENT_ROLES;
  }
  if (eventType === MORTALITY_EVENT_TYPE) {
    return MORTALITY_EVENT_ROLES;
  }
  if ((OBSERVATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return OPERATIONAL_EVENT_ROLES;
  }
  // Tipo desconocido: no se autoriza (fail-closed). No deberia ocurrir porque el
  // esquema de validacion lo rechaza antes.
  return [];
}

function admitsHealthEvents(status: string): boolean {
  return (HEALTH_EVENT_COMPATIBLE_ANIMAL_STATUSES as readonly string[]).includes(
    status,
  );
}

/**
 * Solicitud de registro de evento sanitario tal como llega ya validada por Zod.
 */
export interface CreateHealthEventRequest {
  animal_id: string;
  event_type: HealthEventType;
  title: string;
  occurred_at?: string;
  description?: string | null;
  documented_by?: string | null;
  details?: Record<string, unknown>;
  attachment_url?: string | null;
}

export interface HealthEventService {
  list(
    filter: ListHealthEventsFilter,
    accessToken: string,
  ): Promise<HealthEvent[]>;
  getById(id: string, accessToken: string): Promise<HealthEvent>;
  listByAnimal(
    animalId: string,
    filter: ListHealthEventsFilter,
    accessToken: string,
  ): Promise<HealthEvent[]>;
  create(
    input: CreateHealthEventRequest,
    actor: HealthEventActor,
    accessToken: string,
  ): Promise<HealthEvent>;
}

/**
 * Logica de negocio de eventos sanitarios.
 *
 * El backend valida y responde con errores claros, pero NO actualiza `animals`:
 * si el evento es de mortalidad, el estado (`dead`), la fecha de salida y el
 * corral los deriva el trigger `apply_mortality_event` de PostgreSQL dentro de
 * la misma transaccion. La validacion del backend es una comprobacion
 * anticipada; la base de datos sigue siendo la autoridad final (la politica RLS
 * de la migracion 007 refuerza los mismos permisos por tipo de evento).
 */
export function createHealthEventService(
  repository: HealthEventRepository,
): HealthEventService {
  return {
    list(filter, accessToken) {
      return repository.list(filter, accessToken);
    },

    async getById(id, accessToken) {
      const event = await repository.findById(id, accessToken);
      if (!event) {
        throw new NotFoundError('evento sanitario');
      }
      return event;
    },

    async listByAnimal(animalId, filter, accessToken) {
      const animal = await repository.findAnimal(animalId, accessToken);
      if (!animal) {
        throw new NotFoundError('porcino');
      }
      return repository.list({ ...filter, animal_id: animalId }, accessToken);
    },

    async create(input, actor, accessToken) {
      const animal = await repository.findAnimal(input.animal_id, accessToken);
      if (!animal) {
        throw new NotFoundError('porcino');
      }

      // 1. El porcino debe admitir operaciones sanitarias (no estar vendido,
      //    muerto, transferido al exterior ni dado de baja). En particular,
      //    impide registrar una segunda mortalidad sobre un porcino ya muerto.
      if (!admitsHealthEvents(animal.status)) {
        throw new ValidationError(
          `el porcino no admite eventos sanitarios en estado ${animal.status}`,
        );
      }

      // 2. Autorizacion por accion (no solo por tabla).
      if (
        !allowedHealthEventRoles(input.event_type).includes(actor.role)
      ) {
        throw new ForbiddenError();
      }

      // 3. El autor del historial se deriva del usuario autenticado.
      return repository.create(
        {
          animal_id: input.animal_id,
          event_type: input.event_type,
          title: input.title,
          ...(input.occurred_at !== undefined
            ? { occurred_at: input.occurred_at }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.documented_by !== undefined
            ? { documented_by: input.documented_by }
            : {}),
          ...(input.details !== undefined ? { details: input.details } : {}),
          ...(input.attachment_url !== undefined
            ? { attachment_url: input.attachment_url }
            : {}),
        },
        actor.id,
        accessToken,
      );
    },
  };
}
