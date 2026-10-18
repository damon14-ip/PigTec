import type { AnimalStatus } from '../../services/dashboard.service';

/**
 * Etiquetas y colores compartidos por los graficos del dashboard.
 *
 * Las etiquetas usan los mismos terminos que el resto de la interfaz y las
 * respuestas de datos del asistente, para no introducir vocabulario nuevo.
 * Los colores mantienen la identidad verde de PigTec y reservan tonos propios
 * para los estados de baja (vendido, fallecido, transferido).
 */
export const STATUS_LABELS: Record<AnimalStatus, string> = {
  active: 'Activos',
  sold: 'Vendidos',
  dead: 'Fallecidos',
  transferred_out: 'Transferidos',
  missing: 'No localizados',
  inactive: 'Dados de baja',
};

export const STATUS_COLORS: Record<AnimalStatus, string> = {
  active: '#1f7a4d',
  sold: '#4c9a76',
  dead: '#b42318',
  transferred_out: '#1c5fb0',
  missing: '#b7791f',
  inactive: '#8a9a92',
};

const MONTH_ABBREVIATIONS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

/** Convierte `YYYY-MM` en una etiqueta breve, p. ej. `oct 2026`. */
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  const index = Number(monthNumber) - 1;
  const abbreviation = MONTH_ABBREVIATIONS[index] ?? month;
  return `${abbreviation} ${year}`;
}

/** Formatea una tasa 0..1 como porcentaje entero; `null` si no es calculable. */
export function formatPercent(rate: number | null): string | null {
  if (rate === null) {
    return null;
  }
  return `${Math.round(rate * 100)}%`;
}
