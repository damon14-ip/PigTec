import { describe, expect, it, vi } from 'vitest';
import zlib from 'node:zlib';
import ExcelJS from 'exceljs';
import {
  PDF_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
  createReportsExportService,
} from '../src/modules/reports/export/export.service.js';
import { loadReportExportData } from '../src/modules/reports/export/export-data.js';
import { buildExcelWorkbook } from '../src/modules/reports/export/excel.builder.js';
import {
  MAX_PDF_ROWS,
  buildPdfDocument,
  pdfDocumentCode,
  pdfDocumentLayout,
  pdfDocumentTitle,
  resolvePdfLayout,
} from '../src/modules/reports/export/pdf.builder.js';
import {
  PDF_DOCUMENT_TYPES,
  type PdfDocumentType,
} from '../src/modules/reports/export/export.schemas.js';
import {
  buildExportFilename,
  sanitizeCellText,
} from '../src/modules/reports/export/export-format.js';
import type { ReportsService } from '../src/modules/reports/reports.service.js';
import {
  EXPORT_TOKEN,
  makeExportRepository,
  makeSummary,
} from './support/reports-export-fixtures.js';

const SHEET_NAMES = [
  'Resumen general',
  'Porcinos',
  'Movimientos',
  'Camadas',
  'Sanidad',
  'Áreas y corrales',
  'Estadísticas',
];

/** Fila de encabezados reales de la tabla (tras el bloque de titulo). */
const HEADER_ROW = 5;

/** Encabezados esperados por hoja (deben ocupar celdas individuales). */
const EXPECTED_HEADERS: Record<string, string[]> = {
  'Resumen general': ['Indicador', 'Valor', 'Nota'],
  Porcinos: [
    'Código PigTec',
    'Arete',
    'Sexo',
    'Raza',
    'Nacimiento (dd/mm/aaaa)',
    'Origen',
    'Estado',
    'Corral actual',
    'Ingreso (dd/mm/aaaa)',
    'Salida (dd/mm/aaaa)',
  ],
  Movimientos: [
    'Fecha y hora (dd/mm/aaaa hh:mm, UTC)',
    'Porcino',
    'Motivo',
    'Corral de origen',
    'Corral de destino',
    'Notas',
  ],
  Camadas: [
    'Código de camada',
    'Parto (dd/mm/aaaa)',
    'Madre',
    'Padre',
    'Total nacidos',
    'Nacidos vivos',
    'Nacidos muertos',
  ],
  Sanidad: [
    'Fecha y hora (dd/mm/aaaa hh:mm, UTC)',
    'Porcino',
    'Tipo de evento',
    'Título',
    'Descripción',
    'Documentado por',
  ],
  'Áreas y corrales': [
    'Área',
    'Estado del área',
    'Corral',
    'Nombre del corral',
    'Capacidad',
    'Estado del corral',
  ],
  Estadísticas: ['Categoría', 'Valor', 'Conteo'],
};

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

/** Todos los valores de texto de una hoja (para comprobar saneado/mensajes). */
function collectStrings(sheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'string') {
        values.push(cell.value);
      }
    });
  });
  return values;
}

function sheetByName(
  workbook: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) {
    throw new Error(`No existe la hoja ${name}`);
  }
  return sheet;
}

/**
 * Numero de fila de la primera fila NO combinada cuya primera celda contiene
 * `text` (los titulos de seccion combinados se ignoran para no confundirlos con
 * los datos).
 */
function findRow(sheet: ExcelJS.Worksheet, text: string): number {
  let found = -1;
  sheet.eachRow((row, rowNumber) => {
    const cell = row.getCell(1);
    const value = cell.value;
    if (
      found === -1 &&
      !cell.isMerged &&
      typeof value === 'string' &&
      value.includes(text)
    ) {
      found = rowNumber;
    }
  });
  if (found === -1) {
    throw new Error(`No hay fila con "${text}" en ${sheet.name}`);
  }
  return found;
}

/**
 * Extrae la ultima fila del rango del autoFiltro (`A5:J7` -> `7`). Sirve para
 * comprobar que los mensajes y los totales quedan fuera del rango de filtrado.
 */
function autoFilterEndRow(sheet: ExcelJS.Worksheet): number {
  const match = /:[A-Z]+(\d+)\s*$/.exec(String(sheet.autoFilter));
  if (!match) {
    throw new Error(`Sin rango de autoFiltro en ${sheet.name}`);
  }
  return Number(match[1]);
}

/**
 * Extrae el texto legible de un PDF. Con `compress: false` los flujos quedan sin
 * comprimir; el decodificador de hex/literal cubre ambos casos.
 */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const pieces: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let stream: RegExpExecArray | null;
  while ((stream = streamRe.exec(raw)) !== null) {
    let content = stream[1];
    try {
      content = zlib
        .inflateSync(Buffer.from(content, 'latin1'))
        .toString('latin1');
    } catch {
      // Flujo sin comprimir.
    }
    const tokenRe = /<([0-9A-Fa-f]+)>|\(((?:[^()\\]|\\.)*)\)/g;
    let token: RegExpExecArray | null;
    while ((token = tokenRe.exec(content)) !== null) {
      if (token[1] !== undefined) {
        pieces.push(Buffer.from(token[1], 'hex').toString('latin1'));
      } else if (token[2] !== undefined) {
        pieces.push(token[2].replace(/\\([()\\])/g, '$1'));
      }
    }
    pieces.push('\n');
  }
  return pieces.join('');
}

/** Cajas de pagina declaradas en el PDF (`MediaBox`). */
function mediaBoxes(buffer: Buffer): { width: number; height: number }[] {
  const matches = buffer
    .toString('latin1')
    .matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g);
  return [...matches].map((match) => ({
    width: Number(match[1]),
    height: Number(match[2]),
  }));
}

async function exportData(options: Parameters<typeof makeExportRepository>[0] = {}) {
  return loadReportExportData(
    makeExportRepository(options),
    makeSummary(),
    EXPORT_TOKEN,
  );
}

describe('export-format: saneado anti-inyeccion de formulas', () => {
  it('antepone comilla a los prefijos peligrosos', () => {
    expect(sanitizeCellText('=1+1')).toBe("'=1+1");
    expect(sanitizeCellText('+34')).toBe("'+34");
    expect(sanitizeCellText('-2+3')).toBe("'-2+3");
    expect(sanitizeCellText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCellText('\tvalor')).toBe("'\tvalor");
    expect(sanitizeCellText('\rvalor')).toBe("'\rvalor");
  });

  it('no altera el texto normal ni la cadena vacia', () => {
    expect(sanitizeCellText('Landrace')).toBe('Landrace');
    expect(sanitizeCellText('')).toBe('');
  });

  it('construye un nombre de archivo ASCII con la fecha de generacion', () => {
    expect(
      buildExportFilename('Reportes KolkaPig', 'xlsx', '2026-10-18T12:00:00.000Z'),
    ).toBe('PigTec_Reportes_KolkaPig_2026-10-18.xlsx');
    expect(buildExportFilename('Gestión', 'pdf', 'sin fecha')).toBe(
      'PigTec_Gestion_sin-fecha.pdf',
    );
  });
});

describe('loadReportExportData: etiquetas y truncamiento', () => {
  it('resuelve etiquetas de corral con su area', async () => {
    const data = await loadReportExportData(
      makeExportRepository(),
      makeSummary(),
      EXPORT_TOKEN,
    );

    expect(data.penLabels.get('p1')).toBe('Gestación · C-1');
    expect(data.penLabels.get('p2')).toBe('Gestación · C-2 · Corral 2');
    expect(data.animalCodes.get('a1')).toBe('PIG-000001');
    expect(data.truncated).toBe(false);
  });

  it('marca truncamiento si cualquier exploracion se corta', async () => {
    const repository = makeExportRepository({
      movements: { rows: [], truncated: true },
    });
    const data = await loadReportExportData(
      repository,
      makeSummary(),
      EXPORT_TOKEN,
    );

    expect(data.truncated).toBe(true);
  });

  it('con filtros de inventario lee los codigos por separado', async () => {
    const repository = makeExportRepository();
    const summary = makeSummary({
      filters: {
        movementReason: 'sale',
        healthEventType: 'treatment',
        sex: 'female',
        origin: 'purchased',
      },
    });

    await loadReportExportData(repository, summary, EXPORT_TOKEN);

    expect(repository.listAnimals).toHaveBeenCalledWith(
      { sex: 'female', origin: 'purchased' },
      EXPORT_TOKEN,
    );
    expect(repository.listAnimalCodes).toHaveBeenCalledWith(EXPORT_TOKEN);
    expect(repository.listMovements).toHaveBeenCalledWith(
      { from: summary.period.fromIso, to: summary.period.toIso },
      'sale',
      EXPORT_TOKEN,
    );
    expect(repository.listHealthEvents).toHaveBeenCalledWith(
      { from: summary.period.fromIso, to: summary.period.toIso },
      'treatment',
      EXPORT_TOKEN,
    );
    expect(repository.listLitters).toHaveBeenCalledWith(
      { from: summary.period.from, to: summary.period.to },
      EXPORT_TOKEN,
    );
  });

  it('sin filtros de inventario reutiliza la lista de porcinos (una sola lectura)', async () => {
    const repository = makeExportRepository();

    await loadReportExportData(repository, makeSummary(), EXPORT_TOKEN);

    expect(repository.listAnimalCodes).not.toHaveBeenCalled();
  });
});

describe('buildExcelWorkbook: libro integral con datos reales', () => {
  it('incluye las siete hojas en el orden previsto', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(SHEET_NAMES);
  });

  it('sanea las formulas de las celdas de texto libre', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );
    const values = workbook.worksheets.flatMap(collectStrings);

    expect(values).toContain("'=1+1");
    expect(values).toContain("'@SUM(A1)");
    expect(values).toContain('\'=HYPERLINK("http://malicioso")');
    expect(values).not.toContain('=1+1');
    expect(values.some((value) => value.startsWith('=HYPERLINK'))).toBe(false);
  });

  it('escribe encabezados reales en celdas individuales y con autoFiltro/congelado', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    for (const name of SHEET_NAMES) {
      const sheet = sheetByName(workbook, name);
      const expected = EXPECTED_HEADERS[name];
      const header = sheet.getRow(HEADER_ROW);

      expected.forEach((headerText, index) => {
        const cell = header.getCell(index + 1);
        expect(cell.value).toBe(headerText);
        // El encabezado NUNCA se fusiona con titulos ni datos.
        expect(cell.isMerged).toBe(false);
      });

      // AutoFiltro sobre el encabezado y panel congelado en la misma fila.
      expect(String(sheet.autoFilter)).toMatch(/^A5:/);
      const view = sheet.views[0] as
        | { state?: string; ySplit?: number }
        | undefined;
      expect(view?.state).toBe('frozen');
      expect(view?.ySplit).toBe(HEADER_ROW);
    }
  });

  it('mantiene los encabezados y muestra el estado vacio sin filas de datos', async () => {
    const empty = { rows: [], truncated: false };
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(
        await exportData({
          animals: empty,
          movements: empty,
          litters: empty,
          healthEvents: empty,
          areas: empty,
          pens: empty,
        }),
      ),
    );

    for (const name of SHEET_NAMES) {
      if (name === 'Resumen general' || name === 'Estadísticas') {
        continue; // Se alimentan del resumen agregado, no de filas de detalle.
      }
      const sheet = sheetByName(workbook, name);
      const expected = EXPECTED_HEADERS[name];

      // Los encabezados siguen exactamente donde estaban.
      expected.forEach((headerText, index) => {
        expect(sheet.getCell(HEADER_ROW, index + 1).value).toBe(headerText);
      });

      // El mensaje de conjunto vacio existe, esta fusionado en una sola celda
      // anclada en la columna A y no puede confundirse con un registro real.
      const messageRow = HEADER_ROW + 1;
      const message = sheet.getCell(messageRow, 1);
      expect(typeof message.value).toBe('string');
      expect(String(message.value)).toContain('Sin registros');
      expect(message.isMerged).toBe(true);
      expect(message.master.address).toBe(`A${messageRow}`);
    }
  });

  it('escribe una fila de aviso cuando la hoja esta vacia', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(
        await exportData({ animals: { rows: [], truncated: false } }),
      ),
    );

    const porcinos = collectStrings(sheetByName(workbook, 'Porcinos'));
    expect(
      porcinos.some((value) => value.includes('Sin registros')),
    ).toBe(true);
  });

  it('escribe totales con la etiqueta y el valor en celdas separadas', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    const porcinos = sheetByName(workbook, 'Porcinos');
    const row = findRow(porcinos, 'Total de porcinos exportados');
    // El campo no se concatena: la etiqueta no incluye el valor.
    expect(porcinos.getCell(row, 1).value).toBe('Total de porcinos exportados');
    expect(row).toBeGreaterThan(HEADER_ROW);
    expect(porcinos.getCell(row, 2).value).toBe(2);

    const movimientos = sheetByName(workbook, 'Movimientos');
    const movRow = findRow(movimientos, 'Total de movimientos exportados');
    expect(movimientos.getCell(movRow, 2).value).toBe(2);
  });

  it('dimensiona la fila del total para que la etiqueta larga no se corte', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    // Sanidad: la etiqueta (37 caracteres) es mayor que el ancho de la columna A
    // (28), por lo que se envuelve en dos lineas; la fila debe ser alta y no
    // cortar el texto entre filas.
    const sanidad = sheetByName(workbook, 'Sanidad');
    const row = findRow(sanidad, 'Total de eventos sanitarios exportados');
    const label = sanidad.getCell(row, 1);

    expect(label.value).toBe('Total de eventos sanitarios exportados');
    expect(label.isMerged).toBe(false);
    expect(label.alignment?.wrapText).toBe(true);
    expect(label.alignment?.vertical).toBe('middle');
    expect(sanidad.getColumn(1).width).toBeLessThan(37);
    expect(sanidad.getRow(row).height).toBeGreaterThanOrEqual(30);

    // El valor vive en su propia celda, alineado a la derecha y centrado.
    const value = sanidad.getCell(row, 2);
    expect(value.alignment?.horizontal).toBe('right');
    expect(value.alignment?.vertical).toBe('middle');
    expect(value.border?.left?.style).toBeDefined();
  });

  it('presenta el total 0 de Sanidad sin recortar la etiqueta ni desalinear el valor', async () => {
    const data = await exportData({
      healthEvents: { rows: [], truncated: false },
    });
    const workbook = await loadWorkbook(await buildExcelWorkbook(data));
    const sanidad = sheetByName(workbook, 'Sanidad');
    const row = findRow(sanidad, 'Total de eventos sanitarios exportados');

    // El valor es el 0 real (no un guion ni una cadena).
    expect(sanidad.getCell(row, 2).value).toBe(0);
    expect(sanidad.getCell(row, 2).alignment?.horizontal).toBe('right');
    // La fila crece para envolver la etiqueta completa.
    expect(sanidad.getRow(row).height).toBeGreaterThanOrEqual(30);
    // El mensaje vacio sigue arriba y su propia fila no es la del total.
    expect(String(sanidad.getCell(HEADER_ROW + 1, 1).value)).toContain(
      'Sin registros',
    );
  });

  it('considera las etiquetas de los totales al calcular el ancho de las columnas', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    // Sin los totales, la columna A de Camadas mediria 18; la etiqueta
    // «Total de camadas exportadas» la ensancha hasta su maximo (22).
    expect(sheetByName(workbook, 'Camadas').getColumn(1).width).toBe(22);
  });

  it('mantiene el mensaje Sin registros fuera del rango del autoFiltro', async () => {
    const empty = { rows: [], truncated: false };
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(
        await exportData({
          animals: empty,
          movements: empty,
          litters: empty,
          healthEvents: empty,
          areas: empty,
          pens: empty,
        }),
      ),
    );

    for (const name of SHEET_NAMES) {
      if (name === 'Resumen general' || name === 'Estadísticas') {
        continue; // Se alimentan del resumen agregado, no de filas de detalle.
      }
      const sheet = sheetByName(workbook, name);
      // Sin filas, el autoFiltro abarca solo el encabezado: el mensaje de estado
      // vacio (fila 6) queda fuera y no se puede tratar como registro.
      expect(autoFilterEndRow(sheet)).toBe(HEADER_ROW);
      expect(HEADER_ROW + 1).toBeGreaterThan(autoFilterEndRow(sheet));
    }
  });

  it('limita el autoFiltro a las filas de datos reales (totales fuera)', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    const sanidad = sheetByName(workbook, 'Sanidad');
    const end = autoFilterEndRow(sanidad);
    // Una unica fila de datos en Sanidad.
    expect(end).toBe(HEADER_ROW + 1);
    // La banda de totales (fila combinada) y la fila del total quedan por debajo
    // del rango del autoFiltro.
    const band = sanidad.getCell(end + 2, 1);
    expect(band.isMerged).toBe(true);
    expect(String(band.value)).toBe('Totales del conjunto');
    expect(
      findRow(sanidad, 'Total de eventos sanitarios exportados'),
    ).toBeGreaterThan(end);
  });

  it('distingue cero, dato desconocido y valor no calculable', async () => {
    const summary = makeSummary({
      animals: {
        total: 1,
        byStatus: [{ value: 'active', count: 0 }],
        bySex: [],
        byOrigin: [],
      },
      litters: {
        total: 0,
        truncated: false,
        complete: false,
        totalBorn: null,
        bornAlive: null,
        stillborn: null,
        averageBornAlive: null,
        recent: [],
      },
    });
    const data = await loadReportExportData(
      makeExportRepository(),
      summary,
      EXPORT_TOKEN,
    );
    const workbook = await loadWorkbook(await buildExcelWorkbook(data));

    const resumen = sheetByName(workbook, 'Resumen general');
    expect(resumen.getCell(findRow(resumen, 'Porcinos activos'), 2).value).toBe(0);
    expect(
      resumen.getCell(
        findRow(resumen, 'Promedio de nacidos vivos por camada'),
        2,
      ).value,
    ).toBe('No calculable');

    // Un dato de texto ausente se muestra con guion, no con cero.
    expect(collectStrings(sheetByName(workbook, 'Porcinos'))).toContain('—');

    // Un conteo ausente (camada sin conteos) no se confunde con cero.
    expect(collectStrings(sheetByName(workbook, 'Camadas'))).toContain(
      'No calculable',
    );
  });

  it('no concatena varios campos en una celda (mes y conteo separados)', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    const estadisticas = sheetByName(workbook, 'Estadísticas');
    const row = findRow(estadisticas, 'Movimientos por mes');
    expect(estadisticas.getCell(row, 1).value).toBe('Movimientos por mes');
    expect(estadisticas.getCell(row, 2).value).toBe('2026-06');
    expect(estadisticas.getCell(row, 3).value).toBe(2);
  });

  it('conserva los filtros aplicados en la linea de metadatos', async () => {
    const summary = makeSummary({
      filters: {
        movementReason: 'sale',
        healthEventType: 'treatment',
        sex: 'female',
        origin: 'purchased',
      },
    });
    const data = await loadReportExportData(
      makeExportRepository(),
      summary,
      EXPORT_TOKEN,
    );
    const workbook = await loadWorkbook(await buildExcelWorkbook(data));

    const meta = String(sheetByName(workbook, 'Porcinos').getCell(3, 1).value);
    expect(meta).toContain('Motivo de movimiento: Venta (salida de la granja)');
    expect(meta).toContain('Tipo de evento sanitario: Tratamiento');
    expect(meta).toContain('Sexo: Hembra');
    expect(meta).toContain('Origen: Comprado');
  });

  it('escribe etiquetas resueltas y areas sin corrales', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(await exportData()),
    );

    const porcinos = collectStrings(sheetByName(workbook, 'Porcinos'));
    expect(porcinos).toContain('Gestación · C-1');

    const movimientos = collectStrings(sheetByName(workbook, 'Movimientos'));
    expect(movimientos).toContain('PIG-000001');
    expect(movimientos).toContain('Destete');

    const camadas = collectStrings(sheetByName(workbook, 'Camadas'));
    // La madre se resuelve; un padre no visible se marca de forma explicita.
    expect(camadas).toContain('PIG-000001');
    expect(camadas).toContain('(porcino no visible)');

    const areas = collectStrings(sheetByName(workbook, 'Áreas y corrales'));
    expect(areas).toContain('Cuarentena');
    expect(areas).toContain('Sin corrales');
  });

  it('avisa del truncamiento en la hoja afectada', async () => {
    const workbook = await loadWorkbook(
      await buildExcelWorkbook(
        await exportData({ animals: { rows: [], truncated: true } }),
      ),
    );

    const porcinos = collectStrings(sheetByName(workbook, 'Porcinos'));
    expect(
      porcinos.some((value) => value.includes('alcanzó el límite de exportación')),
    ).toBe(true);
  });

  it('escribe un mensaje explicito cuando un conjunto esta vacio', async () => {
    const empty = { rows: [], truncated: false };
    const repository = makeExportRepository({
      animals: empty,
      movements: empty,
      litters: empty,
      healthEvents: empty,
      areas: empty,
      pens: empty,
    });
    const data = await loadReportExportData(
      repository,
      makeSummary({
        animals: { total: 0, byStatus: [], bySex: [], byOrigin: [] },
        litters: {
          total: 0,
          truncated: false,
          complete: true,
          totalBorn: 0,
          bornAlive: 0,
          stillborn: 0,
          averageBornAlive: null,
          recent: [],
        },
        healthEvents: { total: 0, byType: [] },
        movements: { total: 0, byMonth: [], byReason: [] },
      }),
      EXPORT_TOKEN,
    );
    const workbook = await loadWorkbook(await buildExcelWorkbook(data));

    expect(
      collectStrings(sheetByName(workbook, 'Porcinos')).some((value) =>
        value.includes('no hay porcinos para los filtros aplicados'),
      ),
    ).toBe(true);
    expect(
      collectStrings(sheetByName(workbook, 'Movimientos')).some((value) =>
        value.includes('no hay movimientos en el periodo'),
      ),
    ).toBe(true);
    expect(
      collectStrings(sheetByName(workbook, 'Sanidad')).some((value) =>
        value.includes('no hay eventos sanitarios en el periodo'),
      ),
    ).toBe(true);
  });
});

describe('buildPdfDocument: documentos con identidad KolkaPig', () => {
  it('genera un PDF valido para cada tipo', async () => {
    const data = await exportData();

    for (const type of PDF_DOCUMENT_TYPES) {
      const buffer = await buildPdfDocument(type, data);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buffer.length).toBeGreaterThan(1000);
    }
  });

  it('asigna codigos KPG-RG solo a los formatos operativos', () => {
    const expected: Record<PdfDocumentType, string | null> = {
      general: null,
      animals: 'KPG-RG-14',
      movements: 'KPG-RG-15',
      health: 'KPG-RG-07',
      litters: 'KPG-RG-03',
    };
    for (const type of PDF_DOCUMENT_TYPES) {
      expect(pdfDocumentCode(type)).toBe(expected[type]);
      expect(pdfDocumentTitle(type).length).toBeGreaterThan(0);
    }
  });

  it('usa A4 vertical para el informe general y para los reportes individuales', () => {
    for (const type of PDF_DOCUMENT_TYPES) {
      const layout = pdfDocumentLayout(type);
      expect(layout.size).toBe('A4');
      expect(layout.orientation).toBe('portrait');
      expect(layout.pageWidth).toBeCloseTo(595.28, 1);
      expect(layout.pageHeight).toBeCloseTo(841.89, 1);
      expect(layout.pageWidth).toBeLessThan(layout.pageHeight);
    }
  });

  it('solo usa A4 horizontal cuando la tabla no cabe en vertical', () => {
    expect(resolvePdfLayout(300).orientation).toBe('portrait');
    const landscape = resolvePdfLayout(1000);
    expect(landscape.orientation).toBe('landscape');
    expect(landscape.pageWidth).toBeCloseTo(841.89, 1);
    expect(landscape.pageHeight).toBeCloseTo(595.28, 1);
    expect(landscape.pageWidth).toBeGreaterThan(landscape.pageHeight);
  });

  it('declara un MediaBox A4 vertical en el PDF general', async () => {
    const buffer = await buildPdfDocument('general', await exportData());
    const boxes = mediaBoxes(buffer);

    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.width).toBeCloseTo(595.28, 1);
      expect(box.height).toBeCloseTo(841.89, 1);
      expect(box.width).toBeLessThan(box.height);
    }
  });

  it('incluye encabezado con titulo, periodo, generacion y numeracion de pagina', async () => {
    const text = pdfText(
      await buildPdfDocument('animals', await exportData(), { compress: false }),
    );

    expect(text).toContain('Granja KolkaPig');
    expect(text).toContain('Inventario de porcinos');
    expect(text).toContain('KPG-RG-14');
    expect(text).toContain('Periodo:');
    expect(text).toContain('Generado:');
    expect(text).toContain('Pagina 1 de');
  });

  it('conserva el encabezado de la tabla y muestra el estado vacio', async () => {
    const text = pdfText(
      await buildPdfDocument(
        'animals',
        await exportData({ animals: { rows: [], truncated: false } }),
        { compress: false },
      ),
    );

    // Encabezados reales presentes aunque no haya filas.
    expect(text).toContain('Código PigTec');
    expect(text).toContain('Corral actual');
    expect(text).toContain('Sin registros');
  });

  it('genera el PDF aunque el conjunto de filas este vacio', async () => {
    const data = await exportData({ animals: { rows: [], truncated: false } });

    const buffer = await buildPdfDocument('animals', data);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('declara un tope de filas imprimibles en el PDF', () => {
    expect(MAX_PDF_ROWS).toBe(2000);
  });

  it('respeta los filtros aplicados en el cuerpo del documento', async () => {
    const summary = makeSummary({
      filters: {
        movementReason: 'sale',
        healthEventType: null,
        sex: null,
        origin: null,
      },
    });
    const data = await loadReportExportData(
      makeExportRepository(),
      summary,
      EXPORT_TOKEN,
    );

    const text = pdfText(
      await buildPdfDocument('movements', data, { compress: false }),
    );
    expect(text).toContain('Venta (salida de la granja)');
  });
});

describe('createReportsExportService: archivo, filtros e identidad', () => {
  function makeService() {
    const summary = makeSummary();
    const repository = makeExportRepository();
    const summaryService: ReportsService = {
      getSummary: vi.fn(async () => summary),
    };
    return {
      summary,
      repository,
      summaryService,
      service: createReportsExportService({ repository, summaryService }),
    };
  }

  it('genera el Excel con nombre descriptivo y su tipo MIME', async () => {
    const { service, summaryService, repository } = makeService();

    const file = await service.getExcel({}, EXPORT_TOKEN);

    expect(file.contentType).toBe(XLSX_CONTENT_TYPE);
    expect(file.filename).toBe('PigTec_Reportes_KolkaPig_2026-10-18.xlsx');
    expect(file.buffer.length).toBeGreaterThan(0);
    expect(summaryService.getSummary).toHaveBeenCalledWith({}, EXPORT_TOKEN);
    expect(repository.listAnimals).toHaveBeenCalledWith({}, EXPORT_TOKEN);
  });

  it('genera el PDF del tipo indicado con su codigo en el nombre', async () => {
    const { service } = makeService();

    const file = await service.getPdf({ type: 'health' }, EXPORT_TOKEN);

    expect(file.contentType).toBe(PDF_CONTENT_TYPE);
    expect(file.filename).toMatch(/^PigTec_KPG-RG-07_/);
    expect(file.filename.endsWith('_2026-10-18.pdf')).toBe(true);
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('usa el nombre del informe general sin codigo', async () => {
    const { service } = makeService();

    const file = await service.getPdf({ type: 'general' }, EXPORT_TOKEN);

    expect(file.filename).toBe('PigTec_Informe_general_2026-10-18.pdf');
  });

  it('propaga los filtros del resumen al repositorio de detalle', async () => {
    const summary = makeSummary({
      filters: {
        movementReason: 'sale',
        healthEventType: 'treatment',
        sex: 'female',
        origin: null,
      },
    });
    const repository = makeExportRepository();
    const service = createReportsExportService({
      repository,
      summaryService: { getSummary: vi.fn(async () => summary) },
    });

    await service.getExcel({}, EXPORT_TOKEN);

    expect(repository.listAnimals).toHaveBeenCalledWith(
      { sex: 'female' },
      EXPORT_TOKEN,
    );
  });

  it('propaga el fallo del resumen sin generar archivo', async () => {
    const service = createReportsExportService({
      repository: makeExportRepository(),
      summaryService: {
        getSummary: vi.fn(async () => {
          throw new Error('resumen no disponible');
        }),
      },
    });

    await expect(service.getExcel({}, EXPORT_TOKEN)).rejects.toThrow(
      'resumen no disponible',
    );
  });
});
