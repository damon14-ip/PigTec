import type { OperationalRole } from '../auth/roles.js';
import {
  ForbiddenError,
  ForeignKeyError,
  NotFoundError,
  ValidationError,
} from '../common/data-errors.js';
import {
  DESTINATION_REQUIRED_REASONS,
  EXTERNAL_EXIT_REASONS,
  MOVEMENT_COMPATIBLE_ANIMAL_STATUSES,
  type MovementReason,
} from '../common/movement.js';
import type {
  ListMovementsFilter,
  Movement,
  MovementRepository,
} from './movements.repository.js';

/**
 * Identidad y rol del usuario que registra el movimiento. El rol se resuelve en
 * el servidor (nunca desde el cuerpo) y gobierna que motivos puede registrar.
 */
export interface MovementActor {
  id: string;
  role: OperationalRole;
}

/**
 * Roles autorizados por tipo de movimiento (especificacion maestra, matriz 5.1):
 * - Movimientos internos: admin, manager y operator.
 * - Aislamiento sanitario: ademas, veterinarian.
 * - Salida externa (venta o transferencia sin destino): solo admin y manager.
 *
 * `operator` no autoriza salidas externas; `veterinarian` no registra
 * movimientos internos (su rol es clinico).
 */
const INTERNAL_MOVEMENT_ROLES: readonly OperationalRole[] = [
  'admin',
  'manager',
  'operator',
];
const ISOLATION_MOVEMENT_ROLES: readonly OperationalRole[] = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
];
const EXTERNAL_MOVEMENT_ROLES: readonly OperationalRole[] = ['admin', 'manager'];

/**
 * Roles que pueden registrar un movimiento segun su motivo. `transfer` se
 * resuelve segun tenga o no corral destino (interno vs. salida externa).
 */
export function allowedMovementRoles(
  reason: MovementReason,
  hasDestination: boolean,
): readonly OperationalRole[] {
  if ((EXTERNAL_EXIT_REASONS as readonly string[]).includes(reason)) {
    return EXTERNAL_MOVEMENT_ROLES;
  }
  if (reason === 'transfer') {
    return hasDestination ? INTERNAL_MOVEMENT_ROLES : EXTERNAL_MOVEMENT_ROLES;
  }
  if (reason === 'health_isolation') {
    return ISOLATION_MOVEMENT_ROLES;
  }
  return INTERNAL_MOVEMENT_ROLES;
}

function admitsMovements(status: string): boolean {
  return (MOVEMENT_COMPATIBLE_ANIMAL_STATUSES as readonly string[]).includes(
    status,
  );
}

/**
 * Solicitud de registro de movimiento tal como llega ya validada por Zod. El
 * origen y el destino son opcionales: el servicio resuelve el origen con la
 * ubicacion vigente del porcino.
 */
export interface CreateMovementRequest {
  animal_id: string;
  reason: MovementReason;
  from_pen_id?: string | null;
  to_pen_id?: string | null;
  moved_at?: string;
  notes?: string | null;
}

export interface MovementService {
  list(filter: ListMovementsFilter, accessToken: string): Promise<Movement[]>;
  getById(id: string, accessToken: string): Promise<Movement>;
  listByAnimal(
    animalId: string,
    filter: ListMovementsFilter,
    accessToken: string,
  ): Promise<Movement[]>;
  create(
    input: CreateMovementRequest,
    actor: MovementActor,
    accessToken: string,
  ): Promise<Movement>;
}

/**
 * Logica de negocio de movimientos.
 *
 * El backend valida y responde con errores claros, pero NO actualiza `animals`:
 * la ubicacion, el estado y la fecha de salida los deriva el trigger
 * `apply_animal_movement` de PostgreSQL dentro de la misma transaccion. La
 * validacion del backend es una comprobacion anticipada; la base de datos sigue
 * siendo la autoridad final (migracion 005 refuerza las mismas reglas).
 */
export function createMovementService(
  repository: MovementRepository,
): MovementService {
  return {
    list(filter, accessToken) {
      return repository.list(filter, accessToken);
    },

    async getById(id, accessToken) {
      const movement = await repository.findById(id, accessToken);
      if (!movement) {
        throw new NotFoundError('movimiento');
      }
      return movement;
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

      // 1. El animal debe admitir movimientos (no estar vendido, muerto,
      //    transferido al exterior ni dado de baja).
      if (!admitsMovements(animal.status)) {
        throw new ValidationError(
          `el porcino no admite movimientos en estado ${animal.status}`,
        );
      }

      const reason = input.reason;
      const toPenId = input.to_pen_id ?? null;

      // 2. Coherencia del destino segun el motivo.
      if (
        (EXTERNAL_EXIT_REASONS as readonly string[]).includes(reason) &&
        toPenId !== null
      ) {
        throw new ValidationError('una venta no admite corral destino');
      }
      if (
        (DESTINATION_REQUIRED_REASONS as readonly string[]).includes(reason) &&
        toPenId === null
      ) {
        throw new ValidationError(`el motivo ${reason} exige corral destino`);
      }

      // 3. Autorizacion por accion (no solo por tabla).
      if (!allowedMovementRoles(reason, toPenId !== null).includes(actor.role)) {
        throw new ForbiddenError();
      }

      // 4. Coherencia del origen: si se informa, debe ser el corral actual; si
      //    se omite, se completa con la ubicacion vigente (trazabilidad).
      const fromPenId =
        input.from_pen_id === undefined
          ? animal.current_pen_id
          : input.from_pen_id;
      if (fromPenId !== animal.current_pen_id) {
        throw new ValidationError(
          'el corral de origen no coincide con la ubicacion actual del porcino',
        );
      }
      if (toPenId !== null && toPenId === fromPenId) {
        throw new ValidationError(
          'el corral de destino debe ser distinto del origen',
        );
      }

      // 5. El destino debe existir y estar operativo (corral y area activos).
      if (toPenId !== null) {
        const pen = await repository.findPen(toPenId, accessToken);
        if (!pen) {
          throw new ForeignKeyError('corral destino inexistente');
        }
        if (pen.status !== 'active') {
          throw new ValidationError('el corral destino no esta activo');
        }
        if (pen.area_status !== 'active') {
          throw new ValidationError('el area del corral destino no esta activa');
        }
      }

      return repository.create(
        {
          animal_id: input.animal_id,
          reason,
          from_pen_id: fromPenId,
          to_pen_id: toPenId,
          ...(input.moved_at !== undefined ? { moved_at: input.moved_at } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        actor.id,
        accessToken,
      );
    },
  };
}
