import ExcelJS from 'exceljs';
import {
  healthEventTypeLabel,
  locationStatusLabel,
  movementReasonLabel,
  originLabel,
  sexLabel,
  statusLabel,
} from '../report-labels.js';
import {
  BRAND,
  describeFilters,
  formatCalendarDate,
  formatGeneratedAt,
  formatInstantUtc,
  formatMetric,
  formatPercent,
  orDash,
  sanitizeCellText,
} from './export-format.js';
import {
  resolveAnimalCode,
  resolvePenLabel,
  type ReportExportData,
} from './export-data.js';

/**
 * Generador del libro Excel integral (`.xlsx`) con ExcelJS.
 *
 * Hojas: Resumen general, Porcinos, Movimientos, Camadas, Sanidad, Areas y
 * corrales, y Estadisticas. Todas parten de datos REALES.
 *
 * Reglas de presentacion (S5-E2.1 y S5-E2.2):
 * - La fila de ENCABEZADOS reales de cada tabla se escribe SIEMPRE, aunque no
 *   haya registros, y cada encabezado ocupa su propia celda (nunca se fusiona
 *   con los datos).
 * - Cuando un conjunto esta vacio se anade una fila de mensaje COMBINADA y
 *   diferenciada (cursiva, color atenuado y relleno suave) para que no se
 *   confunda con un registro real.
 * - Los totales se escriben como etiqueta y valor en celdas separadas (columna 1
 *   y columna 2); nunca se concatenan dos campos en una sola celda. La altura de
 *   cada fila de totales se calcula con el ancho real de sus columnas y la
 *   envoltura del texto, de modo que una etiqueta larga no se corta ni se solapa.
 * - Los anchos de columna se calculan con el contenido real (encabezado, filas y
 *   totales) para evitar textos cortados y las celdas de texto envuelven
 *   (wrapText).
 * - Cada hoja lleva autoFiltro y panel congelado sobre su encabezado, sin tocar
 *   el bloque de titulo (celdas combinadas permitidas solo en el titulo). El
 *   rango del autoFiltro cubre solo las filas de datos reales: el mensaje «Sin
 *   registros», los totales y las notas quedan fuera y no se tratan como datos.
 * - Los textos libres se sanean contra inyeccion de formulas.
 */

const FARM_NAME = 'Granja KolkaPig';
const SYSTEM_NAME = 'PigTec · gestión y trazabilidad porcina';

/** Filas fijas del bloque de identidad; la tabla empieza en `HEADER_ROW`. */
const BRAND_ROW = 1;
const HEADING_ROW = 2;
const META_ROW = 3;
const SPACER_ROW = 4;
const HEADER_ROW = 5;

const HEADER_ROW_HEIGHT = 30;
const DATA_ROW_MIN_HEIGHT = 16;
const LINE_HEIGHT = 13.5;
const MIN_NOTE_HEIGHT = 18;
/** Margen vertical anadido a las filas medidas para que el texto no se corte. */
const ROW_HEIGHT_PADDING = 4;
/** Sobrescritura del ancho visual de una celda vacia al estimar alturas. */
const CHAR_WIDTH_FACTOR = 1.05;

/** Valor de celda admitido por el generador (los numeros no se sanean). */
type CellValue = string | number | null;

interface SheetColumn {
  header: string;
  /** Ancho minimo (caracteres) garantizado al calcular el ancho final. */
  minWidth: number;
  /** Ancho maximo; el contenido mas largo se envuelve en varias lineas. */
  maxWidth: number;
  align?: 'left' | 'right';
}

/** Bloque de filas con un titulo de seccion opcional (celda combinada). */
interface SheetSection {
  title?: string;
  rows: CellValue[][];
}

/** Fila de totales: etiqueta y valor en celdas separadas. */
interface SheetTotal {
  label: string;
  value: CellValue;
}

interface SheetDefinition {
  name: string;
  title: string;
  code: string | null;
  columns: SheetColumn[];
  sections: SheetSection[];
  totals?: SheetTotal[];
  /** Notas aclaratorias (celdas combinadas) tras los totales. */
  notes?: string[];
  emptyMessage: string;
  truncated: boolean;
}

/** Longitud en caracteres que ocupa un valor dentro de una celda. */
function cellLength(value: CellValue): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return String(value).length;
}

/**
 * Numero de lineas que ocupa un texto al envolverse por palabras dentro de una
 * celda de `widthChars` caracteres. Reproduce la envoltura de Excel para poder
 * fijar la altura de la fila y evitar que el texto se corte entre filas.
 */
function wrappedLineCount(text: string, widthChars: number): number {
  const limit = Math.max(1, Math.floor(widthChars * CHAR_WIDTH_FACTOR));
  let lines = 0;
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let used = 0; // caracteres ocupados en la linea actual (sin espacio final)
    for (const word of words) {
      const wordLines = Math.ceil(word.length / limit);
      if (used > 0 && used + 1 + word.length <= limit) {
        used += 1 + word.length;
        continue;
      }
      if (used > 0) {
        lines += 1;
      }
      if (wordLines === 1) {
        used = word.length;
      } else {
        // Palabra mas larga que la celda: se parte en varias lineas.
        lines += wordLines - 1;
        used = word.length % limit === 0 ? limit : word.length % limit;
      }
    }
    lines += 1;
  }
  return Math.max(1, lines);
}

/** Altura de fila que garantiza `lines` lineas de texto sin recortes. */
function heightForLines(lines: number): number {
  return Math.max(
    DATA_ROW_MIN_HEIGHT,
    Math.ceil(lines * LINE_HEIGHT + ROW_HEIGHT_PADDING),
  );
}

/** Todas las filas de todas las secciones (para medir y detectar vacio). */
function sectionRows(definition: SheetDefinition): CellValue[][] {
  return definition.sections.flatMap((section) => section.rows);
}

/**
 * Ancho final de una columna: el mayor entre el encabezado y los datos de esa
 * posicion, acotado entre `minWidth` y `maxWidth` (el excedente se envuelve).
 */
function resolveColumnWidth(
  column: SheetColumn,
  index: number,
  rows: CellValue[][],
): number {
  let longest = column.header.length;
  for (const row of rows) {
    longest = Math.max(longest, cellLength(row[index] ?? null));
  }
  return Math.min(Math.max(longest + 2, column.minWidth), column.maxWidth);
}

/** Escribe la cabecera de identidad KolkaPig (solo el titulo usa combinadas). */
function writeTitleBlock(
  ws: ExcelJS.Worksheet,
  columnCount: number,
  title: string,
  code: string | null,
  data: ReportExportData,
): void {
  const { summary } = data;

  ws.mergeCells(BRAND_ROW, 1, BRAND_ROW, columnCount);
  const brand = ws.getCell(BRAND_ROW, 1);
  brand.value = `${FARM_NAME}  ·  ${SYSTEM_NAME}`;
  brand.font = { bold: true, size: 12, color: { argb: BRAND.white } };
  brand.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BRAND.primaryDark },
  };
  brand.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(BRAND_ROW).height = 24;

  ws.mergeCells(HEADING_ROW, 1, HEADING_ROW, columnCount);
  const heading = ws.getCell(HEADING_ROW, 1);
  heading.value = code ? `${title}  ·  Formato ${code}` : title;
  heading.font = { bold: true, size: 14, color: { argb: BRAND.text } };
  heading.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BRAND.surfaceMuted },
  };
  heading.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(HEADING_ROW).height = 22;

  ws.mergeCells(META_ROW, 1, META_ROW, columnCount);
  const meta = ws.getCell(META_ROW, 1);
  meta.value =
    `${describeFilters(summary.filters)}   |   ` +
    `Periodo: ${formatCalendarDate(summary.period.from)} - ${formatCalendarDate(summary.period.to)} (UTC)   |   ` +
    `Generado: ${formatGeneratedAt(summary.generatedAt)}`;
  meta.font = { size: 10, italic: true, color: { argb: BRAND.muted } };
  meta.alignment = { vertical: 'middle', horizontal: 'left' };

  ws.getRow(SPACER_ROW).height = 6;
}

/** Escribe SIEMPRE la fila de encabezados reales (una celda por campo). */
function writeHeaderRow(
  ws: ExcelJS.Worksheet,
  columns: SheetColumn[],
): void {
  const header = ws.getRow(HEADER_ROW);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, size: 11, color: { argb: BRAND.white } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BRAND.primary },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: column.align ?? 'left',
      wrapText: true,
    };
    cell.border = {
      bottom: { style: 'thin', color: { argb: BRAND.primaryDark } },
    };
  });
  header.height = HEADER_ROW_HEIGHT;
}

/** Escribe una fila de datos: cada campo en su columna, sin concatenar. */
function writeDataRow(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
  row: CellValue[],
  columns: SheetColumn[],
): void {
  const excelRow = ws.getRow(rowIndex);
  columns.forEach((column, index) => {
    const value = row[index] ?? null;
    const cell = excelRow.getCell(index + 1);
    if (typeof value === 'number') {
      cell.value = value;
      cell.alignment = {
        vertical: 'top',
        horizontal: 'right',
        wrapText: true,
      };
    } else if (value === null) {
      cell.value = '';
      cell.alignment = { vertical: 'top', horizontal: 'left' };
    } else {
      // Saneado anti-formula solo sobre texto libre.
      cell.value = sanitizeCellText(value);
      cell.alignment = {
        vertical: 'top',
        horizontal: column.align ?? 'left',
        wrapText: true,
      };
    }
    cell.font = { size: 10, color: { argb: BRAND.text } };
    cell.border = {
      bottom: { style: 'hair', color: { argb: BRAND.border } },
    };
  });
}

/**
 * Ancho combinado (en caracteres) de la tabla, para estimar la altura de una
 * fila combinada sin que Excel recorte el texto.
 */
function totalChars(columns: SheetColumn[]): number {
  return columns.reduce((sum, column) => sum + column.minWidth, 0);
}

/** Estima la altura necesaria para un texto en una fila combinada. */
function noteHeight(text: string, columns: SheetColumn[]): number {
  const perLine = Math.max(20, Math.floor(totalChars(columns) * CHAR_WIDTH_FACTOR));
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  return Math.max(MIN_NOTE_HEIGHT, lines * LINE_HEIGHT);
}

/** Escribe una fila de mensaje/nota combinada (no es un registro de la tabla). */
function writeMergedNote(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
  columnCount: number,
  text: string,
  options: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    fill?: string;
    height?: number;
  } = {},
): number {
  ws.mergeCells(rowIndex, 1, rowIndex, columnCount);
  const cell = ws.getCell(rowIndex, 1);
  cell.value = sanitizeCellText(text);
  cell.font = {
    size: 10,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    color: { argb: options.color ?? BRAND.text },
  };
  cell.alignment = {
    vertical: 'middle',
    horizontal: 'left',
    wrapText: true,
  };
  if (options.fill) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: options.fill },
    };
  }
  ws.getRow(rowIndex).height = options.height ?? MIN_NOTE_HEIGHT;
  return rowIndex + 1;
}

/**
 * Escribe una fila de totales: etiqueta en la columna 1 y valor en la columna 2,
 * siempre en celdas separadas. La altura se calcula con el ancho REAL de cada
 * columna y la envoltura del texto, de modo que una etiqueta larga (como «Total
 * de eventos sanitarios exportados» en la hoja Sanidad) no se corte ni se solape
 * con la fila siguiente, y el valor quede alineado con su etiqueta.
 */
function writeTotalRow(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
  total: SheetTotal,
  columns: SheetColumn[],
  widths: number[],
): number {
  const row = ws.getRow(rowIndex);

  const labelText = sanitizeCellText(total.label);
  const label = row.getCell(1);
  label.value = labelText;
  label.font = { size: 10, bold: true, color: { argb: BRAND.text } };
  label.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  label.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BRAND.surfaceMuted },
  };

  const value = row.getCell(2);
  let valueText: string;
  if (typeof total.value === 'number') {
    value.value = total.value;
    value.alignment = { vertical: 'middle', horizontal: 'right' };
    valueText = String(total.value);
  } else {
    valueText = total.value === null ? '' : sanitizeCellText(String(total.value));
    value.value = valueText;
    value.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  }
  value.font = { size: 10, bold: true, color: { argb: BRAND.text } };
  value.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BRAND.surfaceMuted },
  };
  // Separacion visual entre la etiqueta y su valor.
  value.border = { left: { style: 'thin', color: { argb: BRAND.border } } };

  const labelLines = wrappedLineCount(
    labelText,
    widths[0] ?? columns[0]?.minWidth ?? 20,
  );
  const valueLines = wrappedLineCount(
    valueText,
    widths[1] ?? columns[1]?.minWidth ?? 14,
  );
  row.height = heightForLines(Math.max(labelLines, valueLines));

  return rowIndex + 1;
}

function buildSheet(
  wb: ExcelJS.Workbook,
  definition: SheetDefinition,
  data: ReportExportData,
): void {
  const ws = wb.addWorksheet(definition.name, {
    properties: { tabColor: { argb: BRAND.primary } },
  });

  const rows = sectionRows(definition);
  const columnCount = definition.columns.length;
  const totals = definition.totals ?? [];

  // Medicion de anchos: encabezado, filas reales y etiquetas/valores de los
  // totales (asi una etiqueta larga ensancha su columna hasta el maximo y, si
  // aun no cabe, se envuelve con una altura de fila suficiente).
  const measureRows: CellValue[][] = [...rows];
  for (const total of totals) {
    measureRows.push([total.label, total.value]);
  }
  const widths = definition.columns.map((column, index) =>
    resolveColumnWidth(column, index, measureRows),
  );
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });

  writeTitleBlock(ws, columnCount, definition.title, definition.code, data);
  // Los encabezados reales SIEMPRE se escriben, aunque no haya registros.
  writeHeaderRow(ws, definition.columns);

  // Panel congelado sobre el encabezado; el autoFiltro se fija al final para
  // abarcar SOLO las filas de datos reales.
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

  let nextRow = HEADER_ROW + 1;
  let lastDataRow = HEADER_ROW;

  if (rows.length === 0) {
    // Mensaje de conjunto vacio: fila combinada y diferenciada, nunca un
    // registro silencioso con celdas vacias.
    nextRow = writeMergedNote(
      ws,
      nextRow,
      columnCount,
      definition.emptyMessage,
      {
        italic: true,
        color: BRAND.muted,
        fill: BRAND.surfaceMuted,
        height: noteHeight(definition.emptyMessage, definition.columns),
      },
    );
  }

  for (const section of definition.sections) {
    // Un titulo de seccion sin filas no se escribe (evita encabezados huerfanos).
    if (section.rows.length === 0) {
      continue;
    }
    if (section.title) {
      const height = noteHeight(section.title, definition.columns);
      nextRow = writeMergedNote(
        ws,
        nextRow,
        columnCount,
        section.title,
        { bold: true, fill: BRAND.surfaceMuted, height },
      );
    }
    for (const row of section.rows) {
      writeDataRow(ws, nextRow, row, definition.columns);
      lastDataRow = nextRow;
      nextRow += 1;
    }
  }

  if (totals.length > 0) {
    nextRow += 1; // separacion visual entre la tabla y los totales
    nextRow = writeMergedNote(
      ws,
      nextRow,
      columnCount,
      'Totales del conjunto',
      { bold: true, fill: BRAND.surfaceMuted },
    );
    for (const total of totals) {
      nextRow = writeTotalRow(
        ws,
        nextRow,
        total,
        definition.columns,
        widths,
      );
    }
  }

  for (const note of definition.notes ?? []) {
    nextRow = writeMergedNote(ws, nextRow, columnCount, note, {
      italic: true,
      color: BRAND.muted,
      height: noteHeight(note, definition.columns),
    });
  }

  if (definition.truncated) {
    const warning =
      'Aviso: este conjunto alcanzó el límite de exportación y puede estar incompleto. Las cifras son parciales.';
    nextRow = writeMergedNote(ws, nextRow, columnCount, warning, {
      bold: true,
      color: BRAND.accent,
      fill: BRAND.surfaceMuted,
      height: noteHeight(warning, definition.columns),
    });
  }

  // AutoFiltro sobre el encabezado y SOLO las filas de datos reales. El mensaje
  // «Sin registros», la banda de totales, las notas y el aviso de truncamiento
  // quedan FUERA del rango: al filtrar nunca se tratan como registros.
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: Math.max(HEADER_ROW, lastDataRow), column: columnCount },
  };
}

function buildResumenSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const { summary } = data;
  const columns: SheetColumn[] = [
    { header: 'Indicador', minWidth: 34, maxWidth: 48 },
    { header: 'Valor', minWidth: 14, maxWidth: 22, align: 'right' },
    { header: 'Nota', minWidth: 30, maxWidth: 52 },
  ];

  const activeAnimals =
    summary.animals.byStatus.find((item) => item.value === 'active')?.count ?? 0;

  const rows: CellValue[][] = [
    ['Porcinos registrados (inventario)', summary.animals.total, 'Total del inventario con los filtros aplicados.'],
    ['Porcinos activos', activeAnimals, 'Estado «Activo».'],
    ['Corrales activos', summary.pens.total, 'Corrales con estado «Activo».'],
    ['Corrales ocupados', formatMetric(summary.pens.occupied), 'Corrales activos con al menos un porcino.'],
    ['Ocupación de corrales', formatPercent(summary.pens.occupancyRate), 'Corrales ocupados / corrales activos.'],
    ['Capacidad registrada', formatMetric(summary.pens.capacity.total), 'Suma de capacidades de los corrales activos.'],
    ['Porcinos alojados', formatMetric(summary.pens.capacity.housedAnimals), 'Porcinos activos con corral asignado.'],
    ['Utilización de capacidad', formatPercent(summary.pens.capacity.usageRate), summary.pens.capacity.partial ? 'No se calcula: la capacidad está incompleta.' : 'Porcinos alojados / capacidad registrada.'],
    ['Movimientos del periodo', summary.movements.total, `Meses del periodo: ${summary.period.months.length}.`],
    ['Eventos sanitarios del periodo', summary.healthEvents.total, 'Eventos registrados en el periodo.'],
    ['Camadas del periodo', summary.litters.total, 'Camadas con parto en el periodo.'],
    ['Total de nacidos', formatMetric(summary.litters.totalBorn), 'Suma de los conteos presentes.'],
    ['Nacidos vivos', formatMetric(summary.litters.bornAlive), 'Suma de los conteos presentes.'],
    ['Nacidos muertos', formatMetric(summary.litters.stillborn), 'Suma de los conteos presentes.'],
    ['Promedio de nacidos vivos por camada', summary.litters.averageBornAlive === null ? 'No calculable' : summary.litters.averageBornAlive.toFixed(1), summary.litters.complete ? 'Solo con todas las camadas completas.' : 'No se calcula: faltan conteos o hubo truncamiento.'],
  ];

  buildSheet(
    wb,
    {
      name: 'Resumen general',
      title: 'Resumen general de la granja',
      code: null,
      columns,
      sections: [{ rows }],
      emptyMessage: 'Sin registros: no hay datos del resumen para el periodo seleccionado.',
      truncated: data.truncated,
    },
    data,
  );
}

function buildPorcinosSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const columns: SheetColumn[] = [
    { header: 'Código PigTec', minWidth: 15, maxWidth: 18 },
    { header: 'Arete', minWidth: 12, maxWidth: 18 },
    { header: 'Sexo', minWidth: 10, maxWidth: 14 },
    { header: 'Raza', minWidth: 14, maxWidth: 22 },
    { header: 'Nacimiento (dd/mm/aaaa)', minWidth: 18, maxWidth: 22 },
    { header: 'Origen', minWidth: 20, maxWidth: 26 },
    { header: 'Estado', minWidth: 12, maxWidth: 16 },
    { header: 'Corral actual', minWidth: 22, maxWidth: 32 },
    { header: 'Ingreso (dd/mm/aaaa)', minWidth: 18, maxWidth: 22 },
    { header: 'Salida (dd/mm/aaaa)', minWidth: 18, maxWidth: 22 },
  ];

  const rows: CellValue[][] = data.animals.rows.map((animal) => [
    animal.animal_code,
    orDash(animal.ear_tag_code),
    sexLabel(animal.sex),
    orDash(animal.breed),
    formatCalendarDate(animal.birth_date),
    originLabel(animal.origin),
    statusLabel(animal.status),
    resolvePenLabel(data, animal.current_pen_id),
    formatCalendarDate(animal.entry_date),
    formatCalendarDate(animal.exit_date),
  ]);

  buildSheet(
    wb,
    {
      name: 'Porcinos',
      title: 'Inventario de porcinos',
      code: 'KPG-RG-14',
      columns,
      sections: [{ rows }],
      totals: [
        { label: 'Total de porcinos exportados', value: data.animals.rows.length },
      ],
      emptyMessage:
        'Sin registros: no hay porcinos para los filtros aplicados.',
      truncated: data.animals.truncated,
    },
    data,
  );
}

function buildMovimientosSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const columns: SheetColumn[] = [
    { header: 'Fecha y hora (dd/mm/aaaa hh:mm, UTC)', minWidth: 24, maxWidth: 28 },
    { header: 'Porcino', minWidth: 15, maxWidth: 18 },
    { header: 'Motivo', minWidth: 22, maxWidth: 30 },
    { header: 'Corral de origen', minWidth: 22, maxWidth: 32 },
    { header: 'Corral de destino', minWidth: 22, maxWidth: 32 },
    { header: 'Notas', minWidth: 24, maxWidth: 44 },
  ];

  const rows: CellValue[][] = data.movements.rows.map((movement) => [
    formatInstantUtc(movement.moved_at),
    resolveAnimalCode(data, movement.animal_id),
    movementReasonLabel(movement.reason),
    resolvePenLabel(data, movement.from_pen_id),
    resolvePenLabel(data, movement.to_pen_id),
    orDash(movement.notes),
  ]);

  buildSheet(
    wb,
    {
      name: 'Movimientos',
      title: 'Registro de movimientos',
      code: 'KPG-RG-15',
      columns,
      sections: [{ rows }],
      totals: [
        { label: 'Total de movimientos exportados', value: data.movements.rows.length },
      ],
      emptyMessage:
        'Sin registros: no hay movimientos en el periodo. Ajusta las fechas o el motivo para ver resultados.',
      truncated: data.movements.truncated,
    },
    data,
  );
}

function buildCamadasSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const columns: SheetColumn[] = [
    { header: 'Código de camada', minWidth: 18, maxWidth: 22 },
    { header: 'Parto (dd/mm/aaaa)', minWidth: 16, maxWidth: 20 },
    { header: 'Madre', minWidth: 14, maxWidth: 18 },
    { header: 'Padre', minWidth: 14, maxWidth: 18 },
    { header: 'Total nacidos', minWidth: 13, maxWidth: 16, align: 'right' },
    { header: 'Nacidos vivos', minWidth: 13, maxWidth: 16, align: 'right' },
    { header: 'Nacidos muertos', minWidth: 14, maxWidth: 17, align: 'right' },
  ];

  const rows: CellValue[][] = data.litters.rows.map((litter) => [
    orDash(litter.litter_code),
    formatCalendarDate(litter.birth_date),
    resolveAnimalCode(data, litter.mother_id),
    resolveAnimalCode(data, litter.father_id),
    // Un conteo ausente no es cero: se marca «No calculable».
    formatMetric(litter.total_born),
    formatMetric(litter.born_alive),
    formatMetric(litter.stillborn),
  ]);

  const complete = data.summary.litters.complete;
  const totals: SheetTotal[] = [
    { label: 'Total de camadas exportadas', value: data.litters.rows.length },
    // Los nacidos solo se presentan como total cuando el periodo esta completo;
    // si faltan conteos o hubo truncamiento se marca «No calculable» (nunca una
    // suma parcial como si fuera un total confirmado).
    {
      label: 'Nacidos (total)',
      value: complete ? formatMetric(data.summary.litters.totalBorn) : 'No calculable',
    },
    {
      label: 'Nacidos vivos',
      value: complete ? formatMetric(data.summary.litters.bornAlive) : 'No calculable',
    },
    {
      label: 'Nacidos muertos',
      value: complete ? formatMetric(data.summary.litters.stillborn) : 'No calculable',
    },
  ];

  const notes = complete
    ? []
    : ['Nacidos: no calculable porque faltan conteos o la exploración se truncó.'];

  buildSheet(
    wb,
    {
      name: 'Camadas',
      title: 'Registro de camadas',
      code: 'KPG-RG-03',
      columns,
      sections: [{ rows }],
      totals,
      notes,
      emptyMessage: 'Sin registros: no hay camadas con parto en el periodo.',
      truncated: data.litters.truncated,
    },
    data,
  );
}

function buildSanidadSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const columns: SheetColumn[] = [
    { header: 'Fecha y hora (dd/mm/aaaa hh:mm, UTC)', minWidth: 24, maxWidth: 28 },
    { header: 'Porcino', minWidth: 15, maxWidth: 18 },
    { header: 'Tipo de evento', minWidth: 20, maxWidth: 28 },
    { header: 'Título', minWidth: 24, maxWidth: 36 },
    { header: 'Descripción', minWidth: 28, maxWidth: 48 },
    { header: 'Documentado por', minWidth: 18, maxWidth: 24 },
  ];

  const rows: CellValue[][] = data.healthEvents.rows.map((event) => [
    formatInstantUtc(event.occurred_at),
    resolveAnimalCode(data, event.animal_id),
    healthEventTypeLabel(event.event_type),
    event.title,
    orDash(event.description),
    orDash(event.documented_by),
  ]);

  buildSheet(
    wb,
    {
      name: 'Sanidad',
      title: 'Registro sanitario y tratamientos',
      code: 'KPG-RG-07',
      columns,
      sections: [{ rows }],
      totals: [
        { label: 'Total de eventos sanitarios exportados', value: data.healthEvents.rows.length },
      ],
      emptyMessage: 'Sin registros: no hay eventos sanitarios en el periodo.',
      truncated: data.healthEvents.truncated,
    },
    data,
  );
}

function buildAreasSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const columns: SheetColumn[] = [
    { header: 'Área', minWidth: 20, maxWidth: 30 },
    { header: 'Estado del área', minWidth: 14, maxWidth: 18 },
    { header: 'Corral', minWidth: 12, maxWidth: 18 },
    { header: 'Nombre del corral', minWidth: 18, maxWidth: 28 },
    { header: 'Capacidad', minWidth: 12, maxWidth: 16, align: 'right' },
    { header: 'Estado del corral', minWidth: 16, maxWidth: 20 },
  ];

  const areaById = new Map(data.areas.rows.map((area) => [area.id, area]));
  const rows: CellValue[][] = data.pens.rows.map((pen) => {
    const area = areaById.get(pen.area_id);
    return [
      area ? area.name : '(área no visible)',
      area ? locationStatusLabel(area.status) : '—',
      pen.code,
      orDash(pen.name),
      pen.capacity === null ? 'No registrada' : pen.capacity,
      locationStatusLabel(pen.status),
    ];
  });

  // Areas sin corrales (no se pierden al exportar el catalogo completo).
  const pensByArea = new Set(data.pens.rows.map((pen) => pen.area_id));
  for (const area of data.areas.rows) {
    if (!pensByArea.has(area.id)) {
      rows.push([area.name, locationStatusLabel(area.status), '—', '—', null, 'Sin corrales']);
    }
  }

  const capacityValues = data.pens.rows
    .map((pen) => pen.capacity)
    .filter((capacity): capacity is number => capacity !== null);
  const capacityTotal = capacityValues.reduce((sum, value) => sum + value, 0);

  const totals: SheetTotal[] = [
    { label: 'Áreas exportadas', value: data.areas.rows.length },
    { label: 'Corrales exportados', value: data.pens.rows.length },
  ];
  if (capacityValues.length > 0) {
    totals.push({ label: 'Capacidad total registrada', value: capacityTotal });
    totals.push({
      label: 'Corrales con capacidad registrada',
      value: capacityValues.length,
    });
  } else {
    totals.push({ label: 'Capacidad total registrada', value: 'No registrada' });
  }

  buildSheet(
    wb,
    {
      name: 'Áreas y corrales',
      title: 'Áreas y corrales',
      code: null,
      columns,
      sections: [{ rows }],
      totals,
      emptyMessage: 'Sin registros: no hay áreas ni corrales registrados.',
      truncated: data.areas.truncated || data.pens.truncated,
    },
    data,
  );
}

function buildEstadisticasSheet(wb: ExcelJS.Workbook, data: ReportExportData): void {
  const { summary } = data;
  const columns: SheetColumn[] = [
    { header: 'Categoría', minWidth: 30, maxWidth: 44 },
    { header: 'Valor', minWidth: 16, maxWidth: 30 },
    { header: 'Conteo', minWidth: 10, maxWidth: 14, align: 'right' },
  ];

  // Los titulos de seccion son filas combinadas propias (no registros con
  // celdas vacias); cada dato ocupa su columna, sin duplicar el mes en dos.
  const sections: SheetSection[] = [
    {
      title: 'Distribución por estado',
      rows: summary.animals.byStatus.map((item) => [
        'Porcinos por estado',
        statusLabel(item.value),
        item.count,
      ]),
    },
    {
      title: 'Distribución por sexo',
      rows: summary.animals.bySex.map((item) => [
        'Porcinos por sexo',
        sexLabel(item.value),
        item.count,
      ]),
    },
    {
      title: 'Distribución por origen',
      rows: summary.animals.byOrigin.map((item) => [
        'Porcinos por origen',
        originLabel(item.value),
        item.count,
      ]),
    },
    {
      title: 'Movimientos por motivo',
      rows: summary.movements.byReason.map((item) => [
        'Movimientos por motivo',
        movementReasonLabel(item.value),
        item.count,
      ]),
    },
    {
      title: 'Movimientos por mes',
      rows: summary.movements.byMonth.map((item) => [
        'Movimientos por mes',
        item.month,
        item.count,
      ]),
    },
    {
      title: 'Eventos sanitarios por tipo',
      rows: summary.healthEvents.byType.map((item) => [
        'Eventos por tipo',
        healthEventTypeLabel(item.value),
        item.count,
      ]),
    },
  ];

  buildSheet(
    wb,
    {
      name: 'Estadísticas',
      title: 'Estadísticas del periodo',
      code: null,
      columns,
      sections,
      totals: [
        { label: 'Total de porcinos (inventario)', value: summary.animals.total },
        { label: 'Total de movimientos (periodo)', value: summary.movements.total },
        { label: 'Total de eventos sanitarios (periodo)', value: summary.healthEvents.total },
        { label: 'Total de camadas (periodo)', value: summary.litters.total },
      ],
      emptyMessage:
        'Sin registros: no hay datos para calcular estadísticas del periodo.',
      truncated: data.truncated,
    },
    data,
  );
}

/** Construye el libro integral. Devuelve el binario `.xlsx`. */
export async function buildExcelWorkbook(
  data: ReportExportData,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PigTec';
  wb.created = new Date(data.summary.generatedAt);
  wb.company = FARM_NAME;

  buildResumenSheet(wb, data);
  buildPorcinosSheet(wb, data);
  buildMovimientosSheet(wb, data);
  buildCamadasSheet(wb, data);
  buildSanidadSheet(wb, data);
  buildAreasSheet(wb, data);
  buildEstadisticasSheet(wb, data);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
