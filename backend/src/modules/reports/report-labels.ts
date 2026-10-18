import {
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from '../common/animal.js';
import { type HealthEventType } from '../common/health-event.js';
import { type LocationStatus } from '../common/location.js';
import { type MovementReason } from '../common/movement.js';

/**
 * Etiquetas en espanol para los documentos exportados (Excel y PDF).
 *
 * La base de datos y la API usan valores estables en ingles; los documentos
 * operativos de KolkaPig se leen en espanol. Estas tablas son la unica fuente de
 * traduccion de los enums del proyecto y se mantienen ALINEADAS con las del
 * frontend (`frontend/src/services/*.service.ts`): no se inventan valores.
 *
 * Una clave ausente (p. ej. un valor fuera del enum) NO se traduce: se devuelve
 * el valor tecnico entre parentesis para que el lector detecte el dato anomalo
 * en lugar de ocultarlo.
 */

export const REPORT_SEX_LABELS: Record<AnimalSex, string> = {
  male: 'Macho',
  female: 'Hembra',
  unknown: 'Sin definir',
};

export const REPORT_STATUS_LABELS: Record<AnimalStatus, string> = {
  active: 'Activo',
  sold: 'Vendido',
  dead: 'Fallecido',
  transferred_out: 'Transferido',
  missing: 'No localizado',
  inactive: 'Inactivo',
};

export const REPORT_ORIGIN_LABELS: Record<AnimalOrigin, string> = {
  born_on_farm: 'Nacido en la granja',
  purchased: 'Comprado',
  transferred_in: 'Recibido por transferencia',
  unknown: 'Origen desconocido',
};

export const REPORT_MOVEMENT_REASON_LABELS: Record<MovementReason, string> = {
  weaning: 'Destete',
  growth_stage: 'Cambio de etapa (crecimiento)',
  fattening: 'Engorde',
  breeding: 'Reproduccion',
  health_isolation: 'Aislamiento sanitario',
  sale: 'Venta (salida de la granja)',
  transfer: 'Traslado',
  management: 'Manejo',
  other: 'Otro',
};

export const REPORT_HEALTH_EVENT_TYPE_LABELS: Record<HealthEventType, string> = {
  observation: 'Observacion',
  symptom_report: 'Reporte de sintomas',
  documented_diagnosis: 'Diagnostico documentado',
  treatment: 'Tratamiento',
  vaccination: 'Vacunacion',
  deworming: 'Desparasitacion',
  mortality: 'Mortalidad',
  recovery: 'Recuperacion',
  other: 'Otro',
};

export const REPORT_LOCATION_STATUS_LABELS: Record<LocationStatus, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
};

/** Devuelve la etiqueta conocida o el valor tecnico si el enum es inesperado. */
function labelOf<T extends string>(
  labels: Record<T, string>,
  value: T | null | undefined,
  fallback = '—',
): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  return labels[value] ?? `(${value})`;
}

/** Etiqueta de sexo; `null` se muestra como «Sin registrar». */
export function sexLabel(value: AnimalSex | null | undefined): string {
  return labelOf(REPORT_SEX_LABELS, value, 'Sin registrar');
}

/** Etiqueta de estado; `null` se muestra como «Sin registrar». */
export function statusLabel(value: AnimalStatus | null | undefined): string {
  return labelOf(REPORT_STATUS_LABELS, value, 'Sin registrar');
}

/** Etiqueta de origen; `null` = «Sin registrar» (no registrado, no `unknown`). */
export function originLabel(value: AnimalOrigin | null | undefined): string {
  return value === null || value === undefined
    ? 'Sin registrar'
    : labelOf(REPORT_ORIGIN_LABELS, value);
}

export function movementReasonLabel(
  value: MovementReason | null | undefined,
): string {
  return labelOf(REPORT_MOVEMENT_REASON_LABELS, value, 'Sin motivo');
}

export function healthEventTypeLabel(
  value: HealthEventType | null | undefined,
): string {
  return labelOf(REPORT_HEALTH_EVENT_TYPE_LABELS, value, 'Sin tipo');
}

export function locationStatusLabel(
  value: LocationStatus | null | undefined,
): string {
  return labelOf(REPORT_LOCATION_STATUS_LABELS, value, 'Sin estado');
}
