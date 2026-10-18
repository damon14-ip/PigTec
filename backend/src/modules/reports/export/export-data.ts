import type { ReportsSummary } from '../reports.service.js';
import type {
  ExportAnimalFilter,
  ExportAnimalRow,
  ExportAreaRow,
  ExportHealthEventRow,
  ExportLitterRow,
  ExportMovementRow,
  ExportPenRow,
  ExportScan,
  ReportsExportRepository,
} from './export.repository.js';

/**
 * DTO que reune TODO lo que necesita un documento exportado: el resumen
 * agregado (para portadas, totales y hojas estadisticas) y las filas reales de
 * cada conjunto. Se construye una sola vez por peticion y se comparte entre el
 * generador de Excel y el de PDF.
 */
export interface ReportExportData {
  summary: ReportsSummary;
  animals: ExportScan<ExportAnimalRow>;
  movements: ExportScan<ExportMovementRow>;
  litters: ExportScan<ExportLitterRow>;
  healthEvents: ExportScan<ExportHealthEventRow>;
  areas: ExportScan<ExportAreaRow>;
  pens: ExportScan<ExportPenRow>;
  /** `id` de corral -> etiqueta `Area · codigo · nombre`. */
  penLabels: Map<string, string>;
  /** `id` de porcino -> `animal_code` (para etiquetar movimientos y camadas). */
  animalCodes: Map<string, string>;
  /** `true` si CUALQUIER conjunto alcanzo el tope y queda incompleto. */
  truncated: boolean;
}

/** Etiqueta legible de un corral con su area. */
function buildPenLabel(pen: ExportPenRow, areaName: string | undefined): string {
  const name = pen.name ? ` · ${pen.name}` : '';
  return areaName ? `${areaName} · ${pen.code}${name}` : `${pen.code}${name}`;
}

/**
 * Carga el resumen y las filas reales con el JWT del usuario. El resumen lo
 * calcula `reports.service` (conteos exactos); aqui solo se leen las filas que
 * los documentos imprimen, de forma paginada y acotada.
 *
 * Optimizacion: cuando NO hay filtro de inventario (`sex`/`origin`), la lista de
 * porcinos sirve tambien para resolver `id -> codigo`, evitando una segunda
 * exploracion del inventario.
 */
export async function loadReportExportData(
  repository: ReportsExportRepository,
  summary: ReportsSummary,
  accessToken: string,
): Promise<ReportExportData> {
  const { period, filters } = summary;

  const animalFilter: ExportAnimalFilter = {};
  if (filters.sex) {
    animalFilter.sex = filters.sex;
  }
  if (filters.origin) {
    animalFilter.origin = filters.origin;
  }
  const hasAnimalFilter = Boolean(filters.sex || filters.origin);

  const [animals, codeScan, movements, litters, healthEvents, areas, pens] =
    await Promise.all([
      repository.listAnimals(animalFilter, accessToken),
      hasAnimalFilter
        ? repository.listAnimalCodes(accessToken)
        : Promise.resolve(null),
      repository.listMovements(
        { from: period.fromIso, to: period.toIso },
        filters.movementReason,
        accessToken,
      ),
      repository.listLitters(
        { from: period.from, to: period.to },
        accessToken,
      ),
      repository.listHealthEvents(
        { from: period.fromIso, to: period.toIso },
        filters.healthEventType,
        accessToken,
      ),
      repository.listAreas(accessToken),
      repository.listPens(accessToken),
    ]);

  const animalCodes = new Map<string, string>();
  const codeSource = codeScan ?? animals;
  for (const row of codeSource.rows) {
    animalCodes.set(row.id, row.animal_code);
  }

  const areaNames = new Map(areas.rows.map((area) => [area.id, area.name]));
  const penLabels = new Map<string, string>();
  for (const pen of pens.rows) {
    penLabels.set(pen.id, buildPenLabel(pen, areaNames.get(pen.area_id)));
  }

  const truncated =
    animals.truncated ||
    (codeScan?.truncated ?? false) ||
    movements.truncated ||
    litters.truncated ||
    healthEvents.truncated ||
    areas.truncated ||
    pens.truncated;

  return {
    summary,
    animals,
    movements,
    litters,
    healthEvents,
    areas,
    pens,
    penLabels,
    animalCodes,
    truncated,
  };
}

/** Etiqueta de corral; `null` = sin corral (salida o no asignado). */
export function resolvePenLabel(
  data: ReportExportData,
  penId: string | null,
): string {
  if (penId === null) {
    return '—';
  }
  return data.penLabels.get(penId) ?? '(corral no visible)';
}

/** Codigo de porcino; si no es visible por RLS se indica de forma explicita. */
export function resolveAnimalCode(
  data: ReportExportData,
  animalId: string | null,
): string {
  if (animalId === null) {
    return '—';
  }
  return data.animalCodes.get(animalId) ?? '(porcino no visible)';
}
