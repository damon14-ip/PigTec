import PDFDocument from 'pdfkit';
import {
  healthEventTypeLabel,
  movementReasonLabel,
  originLabel,
  sexLabel,
  statusLabel,
} from '../report-labels.js';
import type { ReportsSummary } from '../reports.service.js';
import {
  BRAND,
  describeFilters,
  formatCalendarDate,
  formatGeneratedAt,
  formatInstantUtc,
  formatMetric,
  formatPercent,
  orDash,
} from './export-format.js';
import {
  resolveAnimalCode,
  resolvePenLabel,
  type ReportExportData,
} from './export-data.js';
import type { PdfDocumentType } from './export.schemas.js';

/**
 * Generador de documentos PDF con PDFKit.
 *
 * Moderniza los formatos operativos de KolkaPig conservando su identidad
 * (encabezado, codigo KPG-RG y nombre del formato) con datos REALES. Cuando el
 * modelo de datos no permite reproducir integriamente un formato original, el
 * documento se identifica como «version adaptada de PigTec».
 *
 * Reglas de formato (S5-E2.1):
 * - Tamano A4 y orientacion VERTICAL por defecto; solo se usa horizontal cuando
 *   la tabla no puede representarse legiblemente en vertical (ver
 *   `resolvePdfLayout`). El informe general es A4 vertical.
 * - Todas las paginas llevan encabezado (KolkaPig/PigTec, titulo, periodo y
 *   fecha de generacion) y pie con numeracion («Pagina X de Y»).
 * - Los encabezados de tabla se dibujan SIEMPRE; si no hay registros se anade un
 *   estado vacio explicito debajo del encabezado.
 * - Cada celda se ajusta en varias lineas; el texto que aun excede el maximo se
 *   marca con puntos suspensivos (nunca se recorta en silencio).
 */

const FARM_NAME = 'Granja KolkaPig';
const SYSTEM_NAME = 'PigTec';
const MARGIN = 40;

/** Medidas de A4 en puntos (210 x 297 mm). */
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

/** Distancia del pie al borde inferior. */
const FOOTER_GAP = 34;
const FOOTER_FONT_SIZE = 8;

/** Alturas del encabezado institucional (misma en cualquier orientacion). */
const BRAND_HEIGHT = 24;
const BRAND_GAP = 8;
const TITLE_HEIGHT = 16;
const TITLE_GAP = 6;
const META_HEIGHT = 11;
const META_GAP = 6;
const HEADER_BOTTOM_Y =
  MARGIN + BRAND_HEIGHT + BRAND_GAP + TITLE_HEIGHT + TITLE_GAP + META_HEIGHT + META_GAP;
const CONTENT_TOP = HEADER_BOTTOM_Y + 8;

const TABLE_FONT_SIZE = 8;
const TABLE_HEADER_HEIGHT = 18;
const TABLE_ROW_MIN_HEIGHT = 14;
const TABLE_ROW_MAX_HEIGHT = 96;

/** Limite de filas impresas por documento (aviso explicito si se alcanza). */
export const MAX_PDF_ROWS = 2000;

export type PdfOrientation = 'portrait' | 'landscape';

/** Geometria de pagina resuelta para un documento. */
export interface PdfLayout {
  size: 'A4';
  orientation: PdfOrientation;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  contentWidth: number;
  footerY: number;
}

function buildLayout(orientation: PdfOrientation): PdfLayout {
  const pageWidth = orientation === 'portrait' ? A4_WIDTH : A4_HEIGHT;
  const pageHeight = orientation === 'portrait' ? A4_HEIGHT : A4_WIDTH;
  return {
    size: 'A4',
    orientation,
    pageWidth,
    pageHeight,
    margin: MARGIN,
    contentWidth: pageWidth - MARGIN * 2,
    footerY: pageHeight - FOOTER_GAP,
  };
}

/**
 * Elige la orientacion segun el ancho minimo que necesita la tabla:
 * A4 vertical por defecto; solo pasa a horizontal si el ancho minimo no cabe en
 * vertical (y aun asi cabe en horizontal). Es PURA y comprobable.
 */
export function resolvePdfLayout(minTableWidth: number): PdfLayout {
  const portrait = buildLayout('portrait');
  if (minTableWidth <= portrait.contentWidth) {
    return portrait;
  }
  return buildLayout('landscape');
}

/** Especificacion de columna: ancho minimo + peso para repartir el espacio. */
interface PdfColumnSpec {
  header: string;
  minWidth: number;
  weight: number;
  align?: 'left' | 'right';
}

interface PdfColumn extends PdfColumnSpec {
  width: number;
}

/** Reparte el ancho de contenido entre las columnas respetando su minimo. */
function resolveColumns(
  specs: PdfColumnSpec[],
  contentWidth: number,
): PdfColumn[] {
  const base = specs.reduce((sum, column) => sum + column.minWidth, 0);
  const totalWeight = specs.reduce((sum, column) => sum + column.weight, 0) || 1;
  const extra = Math.max(0, contentWidth - base);
  return specs.map((column) => ({
    ...column,
    width: column.minWidth + extra * (column.weight / totalWeight),
  }));
}

/** Ancho minimo de la tabla de un documento (suma de minimos de columna). */
function minTableWidth(specs: PdfColumnSpec[] | null): number {
  const columns = specs ?? INDICATOR_COLUMNS;
  return columns.reduce((sum, column) => sum + column.minWidth, 0);
}

function hexColor(argb: string): string {
  return `#${argb.slice(2)}`;
}

const COLORS = {
  primary: hexColor(BRAND.primary),
  primaryDark: hexColor(BRAND.primaryDark),
  accent: hexColor(BRAND.accent),
  text: hexColor(BRAND.text),
  muted: hexColor(BRAND.muted),
  border: hexColor(BRAND.border),
  surface: hexColor(BRAND.surfaceMuted),
  white: '#FFFFFF',
};

interface PdfDocumentDefinition {
  title: string;
  code: string | null;
  kind: string;
  /** Columnas de la tabla principal; `null` = informe general (varias tablas). */
  columns: PdfColumnSpec[] | null;
}

interface RenderContext {
  doc: PDFKit.PDFDocument;
  definition: PdfDocumentDefinition;
  /** Resumen del documento: alimenta la linea de periodo/generacion (cabecera). */
  summary: ReportsSummary;
  layout: PdfLayout;
  y: number;
}

/** Tablas de dos columnas del informe general (indicadores y distribuciones). */
const INDICATOR_COLUMNS: PdfColumnSpec[] = [
  { header: 'Indicador', minWidth: 220, weight: 3 },
  { header: 'Valor', minWidth: 110, weight: 1, align: 'right' },
];

const DISTRIBUTION_COLUMNS: PdfColumnSpec[] = [
  { header: 'Categoria', minWidth: 220, weight: 3 },
  { header: 'Conteo', minWidth: 110, weight: 1, align: 'right' },
];

/**
 * Columnas de cada reporte operativo. La MISMA especificacion alimenta la
 * eleccion de orientacion (`pdfDocumentLayout`) y el dibujo de la tabla, de modo
 * que no pueden quedar desalineadas.
 */
const ANIMAL_COLUMNS: PdfColumnSpec[] = [
  { header: 'Código PigTec', minWidth: 62, weight: 2 },
  { header: 'Arete', minWidth: 46, weight: 1 },
  { header: 'Sexo', minWidth: 38, weight: 1 },
  { header: 'Origen', minWidth: 74, weight: 2 },
  { header: 'Estado', minWidth: 52, weight: 1 },
  { header: 'Corral actual', minWidth: 92, weight: 2 },
  { header: 'Ingreso', minWidth: 52, weight: 1 },
];

const MOVEMENT_COLUMNS: PdfColumnSpec[] = [
  { header: 'Fecha y hora (UTC)', minWidth: 84, weight: 2 },
  { header: 'Porcino', minWidth: 56, weight: 1 },
  { header: 'Motivo', minWidth: 84, weight: 2 },
  { header: 'Corral de origen', minWidth: 92, weight: 2 },
  { header: 'Corral de destino', minWidth: 92, weight: 2 },
];

const HEALTH_COLUMNS: PdfColumnSpec[] = [
  { header: 'Fecha y hora (UTC)', minWidth: 84, weight: 2 },
  { header: 'Porcino', minWidth: 56, weight: 1 },
  { header: 'Tipo de evento', minWidth: 74, weight: 2 },
  { header: 'Título', minWidth: 104, weight: 2 },
  { header: 'Descripción', minWidth: 110, weight: 3 },
];

const LITTER_COLUMNS: PdfColumnSpec[] = [
  { header: 'Código de camada', minWidth: 92, weight: 3 },
  { header: 'Parto', minWidth: 58, weight: 1 },
  { header: 'Madre', minWidth: 58, weight: 1 },
  { header: 'Padre', minWidth: 58, weight: 1 },
  { header: 'Total nacidos', minWidth: 50, weight: 1, align: 'right' },
  { header: 'Nacidos vivos', minWidth: 50, weight: 1, align: 'right' },
];

/**
 * Dibuja el encabezado institucional al inicio de cada pagina: marca, titulo,
 * codigo KPG-RG y linea de periodo/generacion.
 */
function drawPageHeader(ctx: RenderContext): void {
  const { doc, definition, layout } = ctx;
  const width = layout.contentWidth;

  doc.save();
  doc.rect(MARGIN, MARGIN, width, BRAND_HEIGHT).fill(COLORS.primaryDark);
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`${FARM_NAME} · ${SYSTEM_NAME}`, MARGIN + 8, MARGIN + 7, {
      width: width * 0.55,
      lineBreak: false,
    });
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(
      definition.code ? `Formato ${definition.code}` : definition.kind.toUpperCase(),
      MARGIN + width * 0.55,
      MARGIN + 8,
      { width: width * 0.45 - 8, align: 'right', lineBreak: false },
    );
  doc.restore();

  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(definition.title, MARGIN, MARGIN + BRAND_HEIGHT + BRAND_GAP, {
      width,
      lineBreak: false,
    });

  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(8)
    .text(docHeaderMeta(ctx), MARGIN, MARGIN + BRAND_HEIGHT + BRAND_GAP + TITLE_HEIGHT + TITLE_GAP, {
      width,
      lineBreak: false,
    });

  doc
    .save()
    .moveTo(MARGIN, HEADER_BOTTOM_Y)
    .lineTo(MARGIN + width, HEADER_BOTTOM_Y)
    .strokeColor(COLORS.primary)
    .lineWidth(1)
    .stroke()
    .restore();

  ctx.y = CONTENT_TOP;
}

/** Linea de periodo y generacion que aparece en el encabezado de cada pagina. */
function docHeaderMeta(ctx: RenderContext): string {
  const { summary } = ctx;
  return (
    `Periodo: ${formatCalendarDate(summary.period.from)} - ${formatCalendarDate(summary.period.to)} (UTC)` +
    `   ·   Generado: ${formatGeneratedAt(summary.generatedAt)}`
  );
}

/** Avanza a una nueva pagina y redibuja el encabezado. */
function addPage(ctx: RenderContext): void {
  ctx.doc.addPage();
  drawPageHeader(ctx);
}

/** Escribe un bloque de metadatos (filtros aplicados) en el cuerpo. */
function drawMetadata(ctx: RenderContext, comment: string): void {
  const { doc, layout } = ctx;
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(comment, MARGIN, ctx.y, { width: layout.contentWidth });
  ctx.y += doc.heightOfString(comment, { width: layout.contentWidth }) + 8;
}

function moveDown(ctx: RenderContext, amount: number): void {
  ctx.y += amount;
}

/** Escribe una fila de totales, aviso o nota dentro del ancho de contenido. */
function drawNote(
  ctx: RenderContext,
  text: string,
  options: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    fill?: string;
    size?: number;
  } = {},
): void {
  const { doc, layout } = ctx;
  const size = options.size ?? 9;
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const height = doc.heightOfString(text, { width: layout.contentWidth }) + 6;
  if (ctx.y + height > ctx.layout.footerY - 10) {
    addPage(ctx);
  }
  if (options.fill) {
    doc.save();
    doc
      .rect(MARGIN, ctx.y - 2, layout.contentWidth, height)
      .fill(options.fill);
    doc.restore();
  }
  doc
    .fillColor(options.color ?? COLORS.text)
    .font(options.bold ? 'Helvetica-Bold' : (options.italic ? 'Helvetica-Oblique' : 'Helvetica'))
    .fontSize(size)
    .text(text, MARGIN, ctx.y, { width: layout.contentWidth });
  ctx.y += height;
}

/** Dibuja la cabecera de una tabla y actualiza `ctx.y`. */
function drawTableHeader(ctx: RenderContext, columns: PdfColumn[]): void {
  const { doc, layout } = ctx;
  // La altura crece si algun encabezado necesita varias lineas (nunca se corta).
  doc.font('Helvetica-Bold').fontSize(TABLE_FONT_SIZE);
  let headerHeight = TABLE_HEADER_HEIGHT;
  for (const column of columns) {
    headerHeight = Math.max(
      headerHeight,
      doc.heightOfString(column.header, { width: column.width - 8 }) + 8,
    );
  }

  let x = MARGIN;
  doc.save();
  doc.rect(MARGIN, ctx.y, layout.contentWidth, headerHeight).fill(COLORS.primary);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(TABLE_FONT_SIZE);
  for (const column of columns) {
    doc.text(column.header, x + 4, ctx.y + 5, {
      width: column.width - 8,
      align: column.align ?? 'left',
    });
    x += column.width;
  }
  doc.restore();
  ctx.y += headerHeight;
}

/**
 * Dibuja una tabla paginada. `rows` son valores ya formateados como texto.
 * La cabecera se dibuja SIEMPRE; si no hay filas se muestra un estado vacio.
 */
function drawTable(
  ctx: RenderContext,
  specs: PdfColumnSpec[],
  rows: string[][],
  emptyMessage: string,
): void {
  const { doc, layout } = ctx;
  const columns = resolveColumns(specs, layout.contentWidth);

  drawTableHeader(ctx, columns);

  if (rows.length === 0) {
    drawNote(ctx, `Sin registros: ${emptyMessage}`, {
      italic: true,
      color: COLORS.muted,
      size: 8.5,
    });
    return;
  }

  const visible = rows.slice(0, MAX_PDF_ROWS);

  for (const row of visible) {
    doc.font('Helvetica').fontSize(TABLE_FONT_SIZE);
    // Altura de la fila segun el texto mas alto (evita recortes silenciosos).
    let rowHeight = TABLE_ROW_MIN_HEIGHT;
    row.forEach((cell, index) => {
      const column = columns[index];
      const measured = doc.heightOfString(cell, {
        width: column.width - 8,
        align: column.align ?? 'left',
      });
      rowHeight = Math.max(
        rowHeight,
        Math.min(measured + 6, TABLE_ROW_MAX_HEIGHT),
      );
    });

    if (ctx.y + rowHeight > layout.footerY - 6) {
      addPage(ctx);
      drawTableHeader(ctx, columns);
    }

    // Nunca se dibuja una fila mas alta que el espacio disponible: el resto se
    // marca con puntos suspensivos por celda.
    rowHeight = Math.max(
      TABLE_ROW_MIN_HEIGHT,
      Math.min(rowHeight, layout.footerY - 6 - ctx.y),
    );

    doc.save();
    doc.rect(MARGIN, ctx.y, layout.contentWidth, rowHeight).fill(COLORS.surface);
    doc.restore();

    let x = MARGIN;
    row.forEach((cell, index) => {
      const column = columns[index];
      doc
        .fillColor(COLORS.text)
        .font('Helvetica')
        .fontSize(TABLE_FONT_SIZE)
        .text(cell, x + 4, ctx.y + 3, {
          width: column.width - 8,
          height: rowHeight - 4,
          align: column.align ?? 'left',
          ellipsis: true,
        });
      x += column.width;
    });
    ctx.y += rowHeight;

    doc
      .save()
      .moveTo(MARGIN, ctx.y)
      .lineTo(MARGIN + layout.contentWidth, ctx.y)
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .stroke()
      .restore();
  }

  if (rows.length > visible.length) {
    moveDown(ctx, 6);
    drawNote(
      ctx,
      `Aviso: se muestran los ${visible.length} registros mas recientes de ${rows.length}. ` +
        'El conjunto supera el limite de impresion del PDF; use el Excel integral para el detalle completo.',
      { bold: true, color: COLORS.accent, size: 8.5 },
    );
  }
}

/** Pie de pagina con marca y numeracion en cada pagina del documento. */
function stampFooters(doc: PDFKit.PDFDocument, layout: PdfLayout): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const half = layout.contentWidth / 2;
  for (let index = 0; index < total; index += 1) {
    doc.switchToPage(range.start + index);
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(FOOTER_FONT_SIZE)
      .text(`${SYSTEM_NAME} · ${FARM_NAME}`, MARGIN, layout.footerY, {
        width: half,
        align: 'left',
        lineBreak: false,
      });
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(FOOTER_FONT_SIZE)
      .text(`Pagina ${index + 1} de ${total}`, MARGIN + half, layout.footerY, {
        width: half,
        align: 'right',
        lineBreak: false,
      });
  }
}

const ADAPTED_NOTE =
  'Version adaptada de PigTec: reproduce los campos disponibles en el modelo de datos actual; ' +
  'no incluye campos del formato original que no estan registrados en el sistema.';

const TRUNCATED_NOTE =
  'Aviso de datos parciales: alguna exploracion de detalle alcanzo el limite de filas. ' +
  'Los totales del resumen son exactos, pero las tablas de detalle pueden estar incompletas; ' +
  'use el Excel integral para el detalle completo.';

function commentForSummary(summary: ReportsSummary): string {
  return `Filtros: ${describeFilters(summary.filters)}`;
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

function buildGeneral(ctx: RenderContext, data: ReportExportData): void {
  const { summary } = data;
  const activeAnimals =
    summary.animals.byStatus.find((item) => item.value === 'active')?.count ?? 0;

  drawMetadata(ctx, commentForSummary(summary));
  moveDown(ctx, 2);

  if (data.truncated) {
    drawNote(ctx, TRUNCATED_NOTE, {
      bold: true,
      color: COLORS.accent,
      size: 8.5,
    });
    moveDown(ctx, 4);
  }

  const indicators: string[][] = [
    ['Porcinos registrados', String(summary.animals.total)],
    ['Porcinos activos', String(activeAnimals)],
    ['Corrales activos', String(summary.pens.total)],
    ['Corrales ocupados', formatMetric(summary.pens.occupied)],
    ['Ocupación de corrales', formatPercent(summary.pens.occupancyRate)],
    ['Capacidad registrada', formatMetric(summary.pens.capacity.total)],
    ['Porcinos alojados', formatMetric(summary.pens.capacity.housedAnimals)],
    ['Utilización de capacidad', formatPercent(summary.pens.capacity.usageRate)],
    ['Movimientos del periodo', String(summary.movements.total)],
    ['Eventos sanitarios del periodo', String(summary.healthEvents.total)],
    ['Camadas del periodo', String(summary.litters.total)],
    ['Total de nacidos', formatMetric(summary.litters.totalBorn)],
    ['Nacidos vivos', formatMetric(summary.litters.bornAlive)],
    ['Nacidos muertos', formatMetric(summary.litters.stillborn)],
    [
      'Promedio de nacidos vivos por camada',
      summary.litters.averageBornAlive === null
        ? 'No calculable'
        : summary.litters.averageBornAlive.toFixed(1),
    ],
  ];

  drawTable(ctx, INDICATOR_COLUMNS, indicators, 'Sin datos para el periodo.');

  if (summary.pens.capacity.partial || summary.pens.truncated) {
    moveDown(ctx, 4);
    drawNote(
      ctx,
      'Nota: la ocupacion y la utilizacion de capacidad se muestran como «No calculable» ' +
        'porque la capacidad registrada esta incompleta o la exploracion de corrales se trunco; ' +
        'no son totales confirmados.',
      { italic: true, color: COLORS.muted, size: 8.5 },
    );
  }

  const distributions: { title: string; rows: string[][]; empty: string }[] = [
    {
      title: 'Distribución del inventario por estado',
      rows: summary.animals.byStatus.map((item) => [
        statusLabel(item.value),
        String(item.count),
      ]),
      empty: 'Sin porcinos registrados.',
    },
    {
      title: 'Distribución por sexo',
      rows: summary.animals.bySex.map((item) => [
        sexLabel(item.value),
        String(item.count),
      ]),
      empty: 'Sin porcinos registrados.',
    },
    {
      title: 'Distribución por origen',
      rows: summary.animals.byOrigin.map((item) => [
        originLabel(item.value),
        String(item.count),
      ]),
      empty: 'Sin porcinos registrados.',
    },
    {
      title: 'Movimientos por motivo',
      rows: summary.movements.byReason.map((item) => [
        movementReasonLabel(item.value),
        String(item.count),
      ]),
      empty: 'Sin movimientos en el periodo.',
    },
    {
      title: 'Movimientos por mes',
      rows: summary.movements.byMonth.map((item) => [
        item.month,
        String(item.count),
      ]),
      empty: 'Sin movimientos en el periodo.',
    },
    {
      title: 'Eventos sanitarios por tipo',
      rows: summary.healthEvents.byType.map((item) => [
        healthEventTypeLabel(item.value),
        String(item.count),
      ]),
      empty: 'Sin eventos sanitarios en el periodo.',
    },
  ];

  for (const distribution of distributions) {
    moveDown(ctx, 8);
    drawNote(ctx, distribution.title, { bold: true });
    drawTable(ctx, DISTRIBUTION_COLUMNS, distribution.rows, distribution.empty);
  }

  moveDown(ctx, 8);
  drawNote(ctx, ADAPTED_NOTE, { color: COLORS.muted, size: 8.5 });
}

function buildAnimals(ctx: RenderContext, data: ReportExportData): void {
  drawMetadata(ctx, commentForSummary(data.summary));
  if (data.animals.truncated) {
    drawNote(ctx, TRUNCATED_NOTE, { bold: true, color: COLORS.accent, size: 8.5 });
  }
  const rows = data.animals.rows.map((animal) => [
    animal.animal_code,
    orDash(animal.ear_tag_code),
    sexLabel(animal.sex),
    originLabel(animal.origin),
    statusLabel(animal.status),
    resolvePenLabel(data, animal.current_pen_id),
    formatCalendarDate(animal.entry_date),
  ]);
  drawTable(ctx, ANIMAL_COLUMNS, rows, 'no hay porcinos para los filtros aplicados.');
  moveDown(ctx, 8);
  drawNote(ctx, `Total de porcinos exportados: ${data.animals.rows.length}`, { bold: true });
  drawNote(ctx, ADAPTED_NOTE, { color: COLORS.muted, size: 8.5 });
}

function buildMovements(ctx: RenderContext, data: ReportExportData): void {
  drawMetadata(ctx, commentForSummary(data.summary));
  if (data.movements.truncated) {
    drawNote(ctx, TRUNCATED_NOTE, { bold: true, color: COLORS.accent, size: 8.5 });
  }
  const rows = data.movements.rows.map((movement) => [
    formatInstantUtc(movement.moved_at),
    resolveAnimalCode(data, movement.animal_id),
    movementReasonLabel(movement.reason),
    resolvePenLabel(data, movement.from_pen_id),
    resolvePenLabel(data, movement.to_pen_id),
  ]);
  drawTable(ctx, MOVEMENT_COLUMNS, rows, 'no hay movimientos en el periodo.');
  moveDown(ctx, 8);
  drawNote(ctx, `Total de movimientos exportados: ${data.movements.rows.length}`, {
    bold: true,
  });
  drawNote(ctx, ADAPTED_NOTE, { color: COLORS.muted, size: 8.5 });
}

function buildHealth(ctx: RenderContext, data: ReportExportData): void {
  drawMetadata(ctx, commentForSummary(data.summary));
  if (data.healthEvents.truncated) {
    drawNote(ctx, TRUNCATED_NOTE, { bold: true, color: COLORS.accent, size: 8.5 });
  }
  const rows = data.healthEvents.rows.map((event) => [
    formatInstantUtc(event.occurred_at),
    resolveAnimalCode(data, event.animal_id),
    healthEventTypeLabel(event.event_type),
    event.title,
    orDash(event.description),
  ]);
  drawTable(ctx, HEALTH_COLUMNS, rows, 'no hay eventos sanitarios en el periodo.');
  moveDown(ctx, 8);
  drawNote(ctx, `Total de eventos sanitarios exportados: ${data.healthEvents.rows.length}`, {
    bold: true,
  });
  drawNote(ctx, ADAPTED_NOTE, { color: COLORS.muted, size: 8.5 });
}

function buildLitters(ctx: RenderContext, data: ReportExportData): void {
  drawMetadata(ctx, commentForSummary(data.summary));
  if (data.litters.truncated) {
    drawNote(ctx, TRUNCATED_NOTE, { bold: true, color: COLORS.accent, size: 8.5 });
  }
  const rows = data.litters.rows.map((litter) => [
    orDash(litter.litter_code),
    formatCalendarDate(litter.birth_date),
    resolveAnimalCode(data, litter.mother_id),
    resolveAnimalCode(data, litter.father_id),
    formatMetric(litter.total_born),
    formatMetric(litter.born_alive),
  ]);
  drawTable(ctx, LITTER_COLUMNS, rows, 'no hay camadas con parto en el periodo.');
  moveDown(ctx, 8);
  drawNote(ctx, `Total de camadas exportadas: ${data.litters.rows.length}`, { bold: true });
  if (data.summary.litters.complete) {
    drawNote(
      ctx,
      `Nacidos (total / vivos / muertos): ${formatMetric(data.summary.litters.totalBorn)} / ` +
        `${formatMetric(data.summary.litters.bornAlive)} / ${formatMetric(data.summary.litters.stillborn)}`,
      { bold: true },
    );
  } else {
    drawNote(
      ctx,
      'Nacidos: no calculable porque faltan conteos o la exploracion se trunco.',
      { bold: true },
    );
  }
  drawNote(ctx, ADAPTED_NOTE, { color: COLORS.muted, size: 8.5 });
}

const DEFINITIONS: Record<PdfDocumentType, PdfDocumentDefinition> = {
  general: {
    title: 'Informe general de la granja',
    code: null,
    kind: 'informe gerencial',
    columns: null,
  },
  animals: {
    title: 'Inventario de porcinos',
    code: 'KPG-RG-14',
    kind: 'registro operativo',
    columns: ANIMAL_COLUMNS,
  },
  movements: {
    title: 'Registro de movimientos',
    code: 'KPG-RG-15',
    kind: 'registro operativo',
    columns: MOVEMENT_COLUMNS,
  },
  health: {
    title: 'Registro sanitario y tratamientos',
    code: 'KPG-RG-07',
    kind: 'registro operativo',
    columns: HEALTH_COLUMNS,
  },
  litters: {
    title: 'Registro de camadas',
    code: 'KPG-RG-03',
    kind: 'registro operativo',
    columns: LITTER_COLUMNS,
  },
};

/** Geometria (A4 + orientacion) que usara el documento indicado. */
export function pdfDocumentLayout(type: PdfDocumentType): PdfLayout {
  return resolvePdfLayout(minTableWidth(DEFINITIONS[type].columns));
}

export interface BuildPdfOptions {
  /**
   * Comprime los flujos del PDF (por defecto `true`). Las pruebas lo desactivan
   * para poder leer el texto del documento sin descomprimir binarios.
   */
  compress?: boolean;
}

/** Construye el documento PDF solicitado y devuelve el binario. */
export function buildPdfDocument(
  type: PdfDocumentType,
  data: ReportExportData,
  options: BuildPdfOptions = {},
): Promise<Buffer> {
  const definition = DEFINITIONS[type];
  const layout = pdfDocumentLayout(type);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: layout.orientation,
      margin: MARGIN,
      bufferPages: true,
      compress: options.compress ?? true,
      info: {
        Title: `${definition.title} · ${FARM_NAME}`,
        Author: 'PigTec',
        Subject: definition.code ? `Formato ${definition.code}` : definition.kind,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
      const ctx: RenderContext = {
        doc,
        definition,
        summary: data.summary,
        layout,
        y: MARGIN,
      };
      drawPageHeader(ctx);

      switch (type) {
        case 'general':
          buildGeneral(ctx, data);
          break;
        case 'animals':
          buildAnimals(ctx, data);
          break;
        case 'movements':
          buildMovements(ctx, data);
          break;
        case 'health':
          buildHealth(ctx, data);
          break;
        case 'litters':
          buildLitters(ctx, data);
          break;
      }

      stampFooters(doc, layout);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('No se pudo generar el PDF'));
    }
  });
}

/** Titulo legible del documento (para pruebas y nombres de archivo). */
export function pdfDocumentTitle(type: PdfDocumentType): string {
  return DEFINITIONS[type].title;
}

/** Codigo KPG-RG del documento, o `null` si es un informe gerencial. */
export function pdfDocumentCode(type: PdfDocumentType): string | null {
  return DEFINITIONS[type].code;
}
