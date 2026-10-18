/**
 * Utilidades de fecha compartidas por los módulos de camadas y sanidad.
 *
 * La base y la API almacenan las marcas de tiempo en UTC (especificación
 * maestra, sección 9) y las fechas de calendario como `YYYY-MM-DD`. Aquí se
 * muestran en la hora LOCAL del usuario y se convierten los valores de los
 * controles `date`/`datetime-local` al formato que exige el backend (ISO 8601
 * con zona horaria para instantes; `YYYY-MM-DD` para fechas de calendario).
 *
 * El módulo de movimientos conserva sus propios helpers (`components/movements/
 * labels.ts`); no se refactorizó para no introducir regresiones fuera del
 * alcance de esta etapa. Estas funciones son el equivalente reutilizable para
 * los módulos nuevos.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Fecha de calendario `YYYY-MM-DD` mostrada como `DD/MM/AAAA` (local). */
export function formatCalendarDate(value: string | null): string {
  if (!value || !DATE_PATTERN.test(value)) {
    return value ?? '—';
  }
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

/** Instante ISO/UTC mostrado como `DD/MM/AAAA HH:mm` en hora local. */
export function formatDateTimeLocal(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
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

/** Inicio del día local en ISO 8601 con zona (para límites `*_from`). */
export function startOfLocalDayIso(value: string): string | undefined {
  if (!isValidCalendarDate(value)) {
    return undefined;
  }
  return new Date(`${value}T00:00:00`).toISOString();
}

/** Fin del día local en ISO 8601 con zona (para límites `*_to`). */
export function endOfLocalDayIso(value: string): string | undefined {
  if (!isValidCalendarDate(value)) {
    return undefined;
  }
  return new Date(`${value}T23:59:59.999`).toISOString();
}
