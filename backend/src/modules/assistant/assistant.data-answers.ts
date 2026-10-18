import {
  isAnimalCode,
  type AnimalSex,
  type AnimalStatus,
} from '../common/animal.js';
import type { MovementReason } from '../common/movement.js';
import { normalizeForMatch } from './assistant.local-answers.js';
import type {
  AnimalLookupData,
  AnimalMovementsData,
  AnimalsSummaryData,
} from './assistant.tools.js';

/**
 * Reconocimiento DETERMINISTA de preguntas que requieren datos reales.
 *
 * No hay IA en este paso: se busca un patron claro (frase disparadora) y, si la
 * herramienta exige un codigo, se extrae y se valida `PIG-XXXXXX`. El diseno es
 * conservador, igual que las respuestas locales:
 * - Si no coincide ninguna herramienta, se devuelve `null` (la pregunta pasa al
 *   proveedor como conversacion normal).
 * - Si coinciden DOS o mas (pregunta ambigua/compuesta), se devuelve `null`
 *   para no arriesgar una respuesta incorrecta.
 * - Si la intencion es de datos pero el codigo falta o esta mal formado, se
 *   devuelve `invalid` (la ruta responde 400) en lugar de inventar.
 *
 * Este modulo NO consulta la base: solo reconoce y, despues, formatea el
 * resultado ya verificado que devuelve una herramienta autorizada.
 */

/** Pregunta reconocida. `invalid` describe un parametro ausente o mal formado. */
export type RecognizedDataQuery =
  | { kind: 'summary' }
  | { kind: 'lookup'; code: string }
  | { kind: 'movements'; code: string }
  | { kind: 'invalid'; reason: 'missing_code' | 'malformed_code' };

/**
 * Frases que expresan "movimientos de un porcino". Se exige una frase completa
 * (con limites de palabra) para no confundir preguntas de procedimiento
 * ("como registro un movimiento para un animal") con una consulta de datos.
 */
const MOVEMENT_PHRASES = [
  'movimientos de',
  'movimientos del',
  'movimientos recientes',
  'movimientos registrados',
  'movimientos tiene',
  'movimientos ha tenido',
  'ultimos movimientos',
  'ultimo movimiento',
  'historial de movimientos',
  'historial de movimiento',
  'registro de movimientos',
  'a donde se movio',
  'donde se movio',
] as const;

/** Frases que expresan "ubicacion / ficha de un porcino concreto". */
const LOOKUP_PHRASES = [
  'donde esta el porcino',
  'donde esta el animal',
  'donde esta la porcino',
  'donde se encuentra el porcino',
  'donde se encuentra el animal',
  'ubicacion del porcino',
  'ubicacion del animal',
  'ubicacion actual del porcino',
  'ubicacion actual del animal',
  'ubicado el porcino',
  'ubicado el animal',
  'buscar porcino',
  'buscar el porcino',
  'buscar animal',
  'buscar el animal',
  'consultar porcino',
  'consultar el porcino',
  'consultar animal',
  'informacion del porcino',
  'informacion del animal',
  'datos del porcino',
  'datos del animal',
  'ficha del porcino',
  'ficha del animal',
  'localizar porcino',
  'localizar animal',
] as const;

/** Verbos de ubicacion: validos con un codigo explicito aunque no digan "porcino". */
const LOCATION_VERBS = [
  'donde esta',
  'donde se encuentra',
  'ubicacion',
  'ubicado',
  'ubicada',
] as const;

/** Frases que expresan el resumen del inventario por estado. */
const SUMMARY_PHRASES = [
  'resumen de porcinos',
  'resumen de animales',
  'resumen de cerdos',
  'resumen del inventario',
  'resumen de inventario',
  'resumen del plantel',
  'cuantos porcinos',
  'cuantos animales',
  'cuantos cerdos',
  'total de porcinos',
  'total de animales',
  'total de cerdos',
  'inventario de porcinos',
  'inventario de animales',
  'inventario de cerdos',
  'porcinos por estado',
  'animales por estado',
  'cerdos por estado',
  'cantidad de porcinos',
  'cantidad de animales',
  'cantidad de cerdos',
] as const;

/** Codigo oficial con digitos, p. ej. `PIG-000123` o `PIG 123`. */
const CODE_WITH_DIGITS = /PIG[\s-]*(\d+)/i;
/** Mencion al token `PIG`, aun sin digitos (para distinguir "falta codigo"). */
const CODE_MENTION = /\bPIG\b/i;

function hasPhrase(padded: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => padded.includes(` ${phrase} `));
}

/**
 * Extrae el codigo oficial del mensaje CRUDO (antes de normalizar, para no
 * perder el guion). Devuelve si se menciono `PIG` y el codigo canonico valido
 * (o `null` si el formato no cumple `PIG-XXXXXX`).
 */
function extractCode(message: string): {
  mentioned: boolean;
  code: string | null;
} {
  const mentioned = CODE_MENTION.test(message);
  const match = CODE_WITH_DIGITS.exec(message);
  if (!match) {
    return { mentioned, code: null };
  }

  const candidate = `PIG-${match[1]}`;
  return { mentioned: true, code: isAnimalCode(candidate) ? candidate : null };
}

/**
 * Reconoce la consulta de datos, si la hay. Nunca lanza y nunca inventa: ante
 * cualquier duda devuelve `null` (la pregunta continua por la via conversacional).
 */
export function recognizeDataQuery(message: string): RecognizedDataQuery | null {
  const normalized = normalizeForMatch(message);
  if (normalized === '') {
    return null;
  }

  const padded = ` ${normalized} `;
  const { mentioned, code } = extractCode(message);

  const wantsMovements = hasPhrase(padded, MOVEMENT_PHRASES);
  const wantsLookup =
    hasPhrase(padded, LOOKUP_PHRASES) ||
    (mentioned && hasPhrase(padded, LOCATION_VERBS));
  const wantsSummary = hasPhrase(padded, SUMMARY_PHRASES);

  const matches = [wantsMovements, wantsLookup, wantsSummary].filter(
    Boolean,
  ).length;

  // Cero coincidencias: no es una consulta de datos. Dos o mas: ambigua.
  if (matches !== 1) {
    return null;
  }

  if (wantsSummary) {
    return { kind: 'summary' };
  }

  const kind = wantsMovements ? 'movements' : 'lookup';
  if (!mentioned) {
    return { kind: 'invalid', reason: 'missing_code' };
  }
  if (code === null) {
    return { kind: 'invalid', reason: 'malformed_code' };
  }

  return { kind, code };
}

/* -------------------------------------------------------------------------- */
/* Formateo de respuestas (datos ya verificados)                              */
/* -------------------------------------------------------------------------- */

/** Etiquetas plurales de estado para el resumen. */
const STATUS_PLURALS: Record<AnimalStatus, string> = {
  active: 'activos',
  sold: 'vendidos',
  dead: 'fallecidos',
  transferred_out: 'transferidos al exterior',
  missing: 'no localizados',
  inactive: 'dados de baja',
};

/** Etiquetas singulares de estado para la ficha de un porcino. */
const STATUS_SINGULARS: Record<AnimalStatus, string> = {
  active: 'activo',
  sold: 'vendido',
  dead: 'fallecido',
  transferred_out: 'transferido al exterior',
  missing: 'no localizado',
  inactive: 'dado de baja',
};

const SEX_LABELS: Record<AnimalSex, string> = {
  male: 'macho',
  female: 'hembra',
  unknown: 'no determinado',
};

const REASON_LABELS: Record<MovementReason, string> = {
  weaning: 'destete',
  growth_stage: 'etapa de crecimiento',
  fattening: 'engorde',
  breeding: 'reproducción',
  health_isolation: 'aislamiento sanitario',
  sale: 'venta',
  transfer: 'transferencia',
  management: 'manejo',
  other: 'otro',
};

/** Respuesta del resumen del inventario. */
export function formatSummary(data: AnimalsSummaryData): string {
  if (data.total === 0) {
    return 'No se encontraron porcinos registrados en el sistema.';
  }

  const lines = data.byStatus.map(
    ({ status, count }) => `- ${STATUS_PLURALS[status]}: ${count}`,
  );

  return [
    `Inventario de porcinos por estado (total: ${data.total}):`,
    ...lines,
  ].join('\n');
}

/** Respuesta de la ubicacion de un porcino por codigo. */
export function formatLookup(data: AnimalLookupData): string {
  if (!data.found || !data.animal) {
    return `No se encontró ningún porcino con el código ${data.code}. Verifica el código e inténtalo de nuevo.`;
  }

  const animal = data.animal;
  const parts = [
    `Porcino ${animal.animal_code}:`,
    `sexo ${SEX_LABELS[animal.sex]},`,
    `estado ${STATUS_SINGULARS[animal.status]}.`,
  ];

  const pen = data.location?.pen ?? null;
  if (pen) {
    const areaName = pen.area?.name ?? null;
    parts.push(
      areaName
        ? `Ubicación actual: área "${areaName}", corral "${pen.code}".`
        : `Ubicación actual: corral "${pen.code}" (área no disponible).`,
    );
  } else {
    parts.push('Sin corral asignado actualmente.');
  }

  return parts.join(' ');
}

/** Respuesta de los movimientos recientes de un porcino por codigo. */
export function formatMovements(data: AnimalMovementsData): string {
  if (!data.found) {
    return `No se encontró ningún porcino con el código ${data.code}. Verifica el código e inténtalo de nuevo.`;
  }

  if (data.movements.length === 0) {
    return `El porcino ${data.code} no tiene movimientos registrados.`;
  }

  const lines = data.movements.map((movement) => {
    const date = movement.movedAt.slice(0, 10);
    const reason = REASON_LABELS[movement.reason];
    if (movement.toPenCode === null) {
      return `- ${date}: ${reason} (salida de la granja)`;
    }
    const from = movement.fromPenCode ?? 'sin corral';
    return `- ${date}: ${reason} (${from} → ${movement.toPenCode})`;
  });

  return [
    `Movimientos recientes del porcino ${data.code} (últimos ${data.movements.length}):`,
    ...lines,
  ].join('\n');
}
