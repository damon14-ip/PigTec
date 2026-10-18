import type { ReportsFilters } from '../reports.service.js';
import {
  healthEventTypeLabel,
  movementReasonLabel,
  originLabel,
  sexLabel,
} from '../report-labels.js';

/**
 * Utilidades de formato compartidas por el Excel y el PDF.
 *
 * Reglas de honestidad de datos (iguales que en `reports.service`):
 * - `0` es un conteo confirmado y se escribe como `0`.
 * - `null` es «no calculable» y se escribe como «No calculable» (nunca `0`).
 *
 * Identidad visual de KolkaPig (tomada de la paleta del frontend, sin
 * inventar colores): verde primario `#1f7a4d`, verde oscuro `#0f2e21` y
 * acento `#b7791f`.
 */

export const BRAND = {
  primary: 'FF1F7A4D',
  primaryDark: 'FF0F2E21',
  accent: 'FFB7791F',
  text: 'FF16211C',
  muted: 'FF5B6B64',
  border: 'FFE3E8E5',
  surfaceMuted: 'FFF8FAF9',
  white: 'FFFFFFFF',
} as const;

const ASCII_MAP: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
  Á: 'A',
  É: 'E',
  Í: 'I',
  Ó: 'O',
  Ú: 'U',
  Ü: 'U',
  Ñ: 'N',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Fecha de calendario `YYYY-MM-DD` (o prefijo de un instante) como `dd/mm/aaaa`. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Instante ISO 8601 como `dd/mm/aaaa hh:mm` en UTC.
 *
 * Se muestra en UTC (no en hora local) porque el backend no conoce la zona del
 * usuario y la API almacena instantes en UTC; los documentos lo indican en el
 * encabezado de columna. La conversion a `America/Lima` queda pendiente
 * transversal del proyecto.
 */
export function formatInstantUtc(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

/** Marca de generacion `dd/mm/aaaa hh:mm` (UTC). */
export function formatGeneratedAt(iso: string): string {
  return `${formatInstantUtc(iso)} UTC`;
}

/** Texto de una cifra: `null` = «No calculable» (nunca `0` por omision). */
export function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'No calculable' : String(value);
}

/** Tasa `0..1` como porcentaje con una decimal; `null` = «No calculable». */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'No calculable';
  }
  return `${(value * 100).toFixed(1).replace('.', ',')} %`;
}

/** Texto vacio o `null` como guion largo. */
export function orDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : value;
}

/** Descripcion legible de los filtros de categoria aplicados. */
export function describeFilters(filters: ReportsFilters): string {
  const parts: string[] = [];
  if (filters.movementReason) {
    parts.push(`Motivo de movimiento: ${movementReasonLabel(filters.movementReason)}`);
  }
  if (filters.healthEventType) {
    parts.push(
      `Tipo de evento sanitario: ${healthEventTypeLabel(filters.healthEventType)}`,
    );
  }
  if (filters.sex) {
    parts.push(`Sexo: ${sexLabel(filters.sex)}`);
  }
  if (filters.origin) {
    parts.push(`Origen: ${originLabel(filters.origin)}`);
  }
  return parts.length > 0
    ? parts.join(' · ')
    : 'Sin filtros de categoria (periodo completo).';
}

/**
 * Proteccion contra inyeccion de formulas: si un texto empieza por un caracter
 * que una hoja de calculo interpreta como formula (`=`, `+`, `-`, `@`) o por un
 * separador de control, se antepone una comilla simple para forzar que se trate
 * como texto. Es la mitigacion recomendada por OWASP para exportaciones CSV/XLSX.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function sanitizeCellText(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return FORMULA_PREFIXES.includes(value[0]) ? `'${value}` : value;
}

/** Convierte un texto en una porcion de nombre de archivo segura (ASCII). */
export function asciiSlug(value: string): string {
  return value
    .split('')
    .map((char) => ASCII_MAP[char] ?? char)
    .join('')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Nombre de archivo descriptivo con la fecha de generacion (`YYYY-MM-DD`). */
export function buildExportFilename(
  slug: string,
  extension: string,
  generatedAt: string,
): string {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(generatedAt)?.[1] ?? 'sin-fecha';
  return `PigTec_${asciiSlug(slug)}_${day}.${extension}`;
}
