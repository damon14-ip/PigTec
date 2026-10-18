import {
  isOperationalRole,
  OPERATIONAL_ROLES,
  type OperationalRole,
} from '../auth/roles.js';
import {
  ANIMAL_STATUSES,
  isAnimalCode,
  type AnimalStatus,
} from '../common/animal.js';
import type { MovementReason } from '../common/movement.js';
import type {
  Animal,
  AnimalLocation,
  AnimalRepository,
} from '../animals/animals.repository.js';
import type { MovementRepository } from '../movements/movements.repository.js';
import type { PenRepository } from '../pens/pens.repository.js';

/**
 * Catalogo explicito de herramientas de LECTURA del asistente PigTec.
 *
 * Una "herramienta" es una consulta acotada y predefinida sobre datos reales de
 * la granja. El asistente NO genera SQL, NO recibe acceso libre a Supabase y NO
 * puede escribir: solo puede invocar estas herramientas, que a su vez reutilizan
 * los repositorios del backend (mismas columnas y mismas reglas RLS con el JWT
 * del usuario).
 *
 * Herramientas iniciales:
 * 1. `animals_summary`  — resumen de porcinos por estado (conteo exacto).
 * 2. `animal_lookup`    — porcino por codigo oficial + ubicacion actual.
 * 3. `animal_movements` — movimientos recientes de un porcino por codigo.
 *
 * Reglas de seguridad aplicadas aqui (defensa en profundidad, ademas del
 * `preHandler` de la ruta):
 * - El rol se verifica ANTES de consultar; si no es operativo y autorizado para
 *   la herramienta, se lanza `forbidden` sin tocar la base.
 * - Los parametros se validan (el codigo debe ser `PIG-XXXXXX`).
 * - El numero de movimientos devuelto esta limitado por `MAX_MOVEMENTS`.
 */

export const ASSISTANT_TOOL_IDS = [
  'animals_summary',
  'animal_lookup',
  'animal_movements',
] as const;

export type AssistantToolId = (typeof ASSISTANT_TOOL_IDS)[number];

/**
 * Maximo de movimientos recientes devueltos por la herramienta. Evita listados
 * masivos: la conversacion es para una consulta puntual, no para exportar.
 */
export const MAX_MOVEMENTS = 5;

/**
 * Roles autorizados por herramienta. Hoy las tres son de solo lectura y estan
 * disponibles para los cuatro roles operativos activos; `viewer` nunca aparece
 * (ni siquiera se le autoriza en la ruta).
 */
export const ASSISTANT_TOOL_ROLES: Record<
  AssistantToolId,
  readonly OperationalRole[]
> = {
  animals_summary: OPERATIONAL_ROLES,
  animal_lookup: OPERATIONAL_ROLES,
  animal_movements: OPERATIONAL_ROLES,
};

/** Ficha publica de cada herramienta (util para pruebas y documentacion). */
export interface AssistantToolDefinition {
  id: AssistantToolId;
  description: string;
  allowedRoles: readonly OperationalRole[];
}

export const ASSISTANT_TOOL_CATALOG: readonly AssistantToolDefinition[] =
  ASSISTANT_TOOL_IDS.map((id) => ({
    id,
    allowedRoles: ASSISTANT_TOOL_ROLES[id],
    description: {
      animals_summary:
        'Resumen del inventario de porcinos por estado (conteo por estado).',
      animal_lookup:
        'Busca un porcino por su codigo oficial PIG-XXXXXX y devuelve su ubicacion actual.',
      animal_movements:
        'Movimientos recientes de un porcino identificado por su codigo oficial.',
    }[id],
  }));

/** Categorias de fallo controlado de una herramienta. */
export type AssistantToolFailure = 'invalid_input' | 'forbidden' | 'unavailable';

/**
 * Error controlado de una herramienta. El mensaje es generico a proposito:
 * nunca incluye el detalle de la base ni datos del usuario.
 */
export class AssistantToolError extends Error {
  readonly kind: AssistantToolFailure;

  constructor(kind: AssistantToolFailure) {
    super('No se pudo ejecutar la consulta de datos');
    this.name = 'AssistantToolError';
    this.kind = kind;
  }
}

/** Identidad y rol que ejecutan la herramienta (el rol sale del servidor). */
export interface AssistantToolContext {
  accessToken: string;
  actor: { role: OperationalRole };
}

export interface AnimalsSummaryData {
  /** Total de porcinos (suma de todos los estados). */
  total: number;
  /** Conteo por cada estado del enum `animal_status`, en orden canonico. */
  byStatus: ReadonlyArray<{ status: AnimalStatus; count: number }>;
}

export interface AnimalLookupData {
  code: string;
  found: boolean;
  animal: Animal | null;
  location: AnimalLocation | null;
}

/** Vista minima de un movimiento para la conversacion (sin datos personales). */
export interface MovementView {
  movedAt: string;
  reason: MovementReason;
  fromPenCode: string | null;
  toPenCode: string | null;
}

export interface AnimalMovementsData {
  code: string;
  found: boolean;
  movements: readonly MovementView[];
}

export interface AssistantToolDependencies {
  animalRepository: AnimalRepository;
  movementRepository: MovementRepository;
  penRepository: PenRepository;
}

/**
 * Fachada de las herramientas de lectura. Cada metodo valida la autorizacion y
 * los parametros antes de consultar, y devuelve datos ya estructurados (el
 * formateo en lenguaje natural vive en `assistant.data-answers.ts`).
 */
export interface AssistantTools {
  catalog: readonly AssistantToolDefinition[];
  summary(context: AssistantToolContext): Promise<AnimalsSummaryData>;
  lookup(code: string, context: AssistantToolContext): Promise<AnimalLookupData>;
  movements(
    code: string,
    context: AssistantToolContext,
  ): Promise<AnimalMovementsData>;
}

/** Verifica el rol ANTES de consultar; lanza `forbidden` si no procede. */
function assertAuthorized(
  id: AssistantToolId,
  role: OperationalRole,
): void {
  if (!isOperationalRole(role) || !ASSISTANT_TOOL_ROLES[id].includes(role)) {
    throw new AssistantToolError('forbidden');
  }
}

/** Normaliza y valida el codigo; `null` si no cumple `PIG-XXXXXX`. */
function validCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!isAnimalCode(normalized)) {
    throw new AssistantToolError('invalid_input');
  }
  return normalized;
}

/** Resuelve los codigos de corral de un conjunto acotado de ids (sin listados). */
async function loadPenCodes(
  ids: readonly string[],
  context: AssistantToolContext,
  penRepository: PenRepository,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const pen = await penRepository.findById(id, context.accessToken);
      return [id, pen?.code ?? null] as const;
    }),
  );

  const codes = new Map<string, string>();
  for (const [id, code] of entries) {
    if (code !== null) {
      codes.set(id, code);
    }
  }
  return codes;
}

export function createAssistantTools(
  dependencies: AssistantToolDependencies,
): AssistantTools {
  const { animalRepository, movementRepository, penRepository } = dependencies;

  return {
    catalog: ASSISTANT_TOOL_CATALOG,

    async summary(context) {
      assertAuthorized('animals_summary', context.actor.role);

      // Un conteo exacto por estado: nunca se descarga el inventario completo.
      const byStatus = await Promise.all(
        ANIMAL_STATUSES.map(async (status) => ({
          status,
          count: await animalRepository.countByStatus(
            status,
            context.accessToken,
          ),
        })),
      );
      const total = byStatus.reduce((sum, item) => sum + item.count, 0);

      return { total, byStatus };
    },

    async lookup(code, context) {
      assertAuthorized('animal_lookup', context.actor.role);
      const animalCode = validCode(code);

      const animal = await animalRepository.findByCode(
        animalCode,
        context.accessToken,
      );
      if (!animal) {
        return { code: animalCode, found: false, animal: null, location: null };
      }

      const location = await animalRepository.findLocation(
        animal.id,
        context.accessToken,
      );
      return { code: animalCode, found: true, animal, location };
    },

    async movements(code, context) {
      assertAuthorized('animal_movements', context.actor.role);
      const animalCode = validCode(code);

      const animal = await animalRepository.findByCode(
        animalCode,
        context.accessToken,
      );
      if (!animal) {
        return { code: animalCode, found: false, movements: [] };
      }

      const rows = await movementRepository.list(
        { animal_id: animal.id, limit: MAX_MOVEMENTS, offset: 0 },
        context.accessToken,
      );

      const penIds: string[] = [];
      for (const row of rows) {
        if (row.from_pen_id) {
          penIds.push(row.from_pen_id);
        }
        if (row.to_pen_id) {
          penIds.push(row.to_pen_id);
        }
      }
      const penCodes = await loadPenCodes(penIds, context, penRepository);

      return {
        code: animalCode,
        found: true,
        movements: rows.map((row) => ({
          movedAt: row.moved_at,
          reason: row.reason,
          fromPenCode: row.from_pen_id
            ? (penCodes.get(row.from_pen_id) ?? null)
            : null,
          toPenCode: row.to_pen_id
            ? (penCodes.get(row.to_pen_id) ?? null)
            : null,
        })),
      };
    },
  };
}
