import type { Area } from '../../services/areas.service';
import type { Pen } from '../../services/pens.service';

/**
 * Utilidades de presentación del módulo de movimientos.
 *
 * La base y la API almacenan/devolvieron `moved_at` en UTC (especificación
 * maestra, sección 9). Aquí se muestra en la hora LOCAL del usuario, como pide
 * la propia especificación («mostrar hora local en interfaz cuando
 * corresponda»). Los filtros de fecha se convierten a ISO 8601 con zona antes de
 * enviarlos al backend, que exige ese formato.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Fecha y hora local legible (`DD/MM/AAAA HH:mm`) de un instante ISO/UTC. */
export function formatMovementDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Comprueba que un valor `datetime-local` es una fecha y hora reales. */
export function isValidLocalDateTime(value: string): boolean {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

/** Convierte `datetime-local` (hora local) a ISO 8601 con zona (`Z`). */
export function localDateTimeToIso(value: string): string {
  return new Date(value).toISOString();
}

/** Comprueba que un valor `date` es una fecha de calendario real. */
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Inicio del día local en ISO 8601 con zona (para `moved_from`). */
export function startOfDayIso(value: string): string | undefined {
  if (!isValidCalendarDate(value)) {
    return undefined;
  }
  return new Date(`${value}T00:00:00`).toISOString();
}

/** Fin del día local en ISO 8601 con zona (para `moved_to`). */
export function endOfDayIso(value: string): string | undefined {
  if (!isValidCalendarDate(value)) {
    return undefined;
  }
  return new Date(`${value}T23:59:59.999`).toISOString();
}

/**
 * Etiqueta legible de un corral: `Área · código · nombre (opcional)`. Si el área
 * aún no está en el catálogo, se muestra el código sin área.
 */
export function buildPenLabelMap(
  pens: readonly Pen[],
  areas: readonly Area[],
): Map<string, string> {
  const areaNameById = new Map<string, string>();
  for (const area of areas) {
    areaNameById.set(area.id, area.name);
  }

  const labels = new Map<string, string>();
  for (const pen of pens) {
    const areaName = areaNameById.get(pen.area_id);
    const namePart = pen.name ? ` · ${pen.name}` : '';
    labels.set(
      pen.id,
      areaName ? `${areaName} · ${pen.code}${namePart}` : `${pen.code}${namePart}`,
    );
  }
  return labels;
}
