# Sprint 5 — S5-E2: exportaciones Excel y PDF del módulo de reportes

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; **no se realizaron escrituras en Supabase** (ni
`INSERT`/`UPDATE`/`DELETE`); no se llamó a Groq; no se ejecutaron pruebas E2E
contra la base real.

## Alcance

Añadir **exportaciones profesionales** al módulo `/reports`, generadas en el
**backend con el JWT del usuario y RLS** (nunca en el navegador ni con
`service_role`) y descargadas **bajo demanda**:

- un **Excel integral** (`.xlsx`) con siete hojas;
- **documentos PDF** que modernizan los formatos operativos de KolkaPig
  conservando su identidad y su código KPG-RG.

Las exportaciones respetan los **mismos filtros** que `GET /reports/summary` y el
**rol operativo activo**. No se almacena ningún archivo en buckets ni en disco.
No se tocaron los módulos operativos ni el asistente IA.

## Decisiones de diseño

### Generación en el backend, descarga bajo demanda

El archivo se construye **en memoria** en el servidor con `ExcelJS` y `PDFKit` y
se devuelve como descarga (`Content-Disposition: attachment`). El navegador solo
solicita la descarga e inicia el guardado (`URL.createObjectURL`). Ventajas:

- el JWT del usuario llega al backend y **PostgreSQL aplica RLS** (el frontend
  nunca ve más de lo autorizado);
- **no** hay `service_role` en ningún punto;
- no se persisten documentos.

### Un repositorio de lectura dedicado, paginado y acotado

Se añadió `ReportsExportRepository`, **separado** del repositorio agregado de
S5-E1, que lee las **filas reales** que imprimen los documentos. Cada consulta
crea un cliente PostgREST **por petición con el JWT verificado** y pagina hasta
agotar el conjunto o alcanzar el tope:

| Tope | Valor | Efecto |
| --- | --- | --- |
| `MAX_EXPORT_ROWS` | 20000 | Por conjunto de filas; si se alcanza, `truncated = true` |
| `MAX_EXPORT_CATALOG` | 2000 | Áreas y corrales |
| `PAGE_SIZE` | 500 | Tamaño de página de PostgREST |
| `MAX_PDF_ROWS` | 2000 | Filas impresas por documento PDF (aviso explícito) |

**Nunca hay truncamiento silencioso:** si una exploración se corta, el documento
lo advierte en la hoja/tabla afectada. La prueba de paginación verifica que la
exploración **lee más allá de la primera página** (501 filas → dos peticiones
`range`).

### Excel con siete hojas

`Resumen general`, `Porcinos`, `Movimientos`, `Camadas`, `Sanidad`,
`Áreas y corrales` y `Estadísticas`. Cada hoja lleva:

- **cabecera de identidad** KolkaPig (franja oscura + nombre «Granja KolkaPig ·
  PigTec»), **título + código KPG-RG** cuando aplica y línea de metadatos
  (filtros, periodo y generación en UTC);
- cabecera de tabla fija (`autoFilter` + panel congelado);
- **filas reales**, **totales** y, si procede, el **aviso de truncamiento**;
- un **mensaje explícito** cuando el conjunto está vacío (nunca una tabla muda).

### Saneado anti-inyección de fórmulas

Todo **texto libre** se sanea antes de escribirse (`sanitizeCellText`): si empieza
por `=`, `+`, `-`, `@`, tabulador o retorno de carro, se antepone una **comilla
simple** (mitigación OWASP para CSV/XLSX). Los **números** no se sanean. Una
prueba **relee el `.xlsx` con ExcelJS** y confirma que `=1+1`, `@SUM(A1)` y
`=HYPERLINK(...)` quedan inertes.

### Documentos PDF

Cinco documentos con identidad KolkaPig, encabezado/pie en cada página y
paginación («Página X de Y»):

| Tipo (`type`) | Título | Código |
| --- | --- | --- |
| `general` | Informe general de la granja | — (informe gerencial) |
| `animals` | Inventario de porcinos | KPG-RG-14 |
| `movements` | Registro de movimientos | KPG-RG-15 |
| `health` | Registro sanitario y tratamientos | KPG-RG-07 |
| `litters` | Registro de camadas | KPG-RG-03 |

Cada documento incluye periodo/filtros/generación, datos reales, totales y un
mensaje explícito si no hay datos. Cuando el modelo de datos no cubre todos los
campos del formato original, el documento se identifica como **«versión adaptada
de PigTec»**. Si un conjunto supera `MAX_PDF_ROWS`, se imprimen los registros más
recientes y se añade un **aviso** que remite al Excel integral (sin truncar en
silencio).

### Fechas en UTC

Las fechas de calendario se muestran `dd/mm/aaaa` y los instantes
`dd/mm/aaaa hh:mm` **en UTC**, con la columna rotulada como tal. La conversión a
`America/Lima` es un **pendiente transversal** del proyecto (el backend no conoce
la zona del usuario).

## Endpoints backend

- `GET /reports/export/excel` — Excel integral con los filtros del resumen.
- `GET /reports/export/pdf?type=general|animals|movements|health|litters` —
  documento PDF (por defecto `general`).

Ambos exigen **rol operativo activo** (admin, manager, operator, veterinarian);
sin token → `401`; `viewer` o inactivo → `403`; filtro no válido → `400`; fallo
del repositorio o ausencia de repositorio → `503` (fail-closed). Las cabeceras
incluyen `Content-Type`, `Content-Disposition` con el nombre del archivo,
`Cache-Control: no-store` y `X-Content-Type-Options: nosniff`. Los filtros son
**los mismos** que `GET /reports/summary` (`reportsQuerySchema`), sin inventar
criterios.

## UI implementada (`/reports`)

- **Botón «Descargar Excel»** y **selector de tipo + «Descargar PDF»**.
- Estados de **generación** («Generando el archivo…»), **descarga iniciada** y
  **error** (mensaje traducido por `describeApiError`).
- Las exportaciones se **deshabilitan** con un rango de fechas invertido y
  mientras hay una generación en curso.
- Se aplican los **filtros vigentes** de la pantalla; se conserva la referencia
  documental de KolkaPig al final.

### Cliente HTTP

`ApiClient` incorpora **`getFile?`** (OPCIONAL, para no romper los dobles de
prueba que construyen un `ApiClient` como objeto literal). Descarga el `Blob`,
parsea el nombre de `Content-Disposition` (incluida la forma RFC 5987
`filename*=UTF-8''…`) y reutiliza el manejo de errores (`401`/red/código del
backend). El servicio de exportaciones exige `getFile` y, si falta, falla con un
error claro (`download_unavailable`).

## Archivos

**Backend — creados**

- `backend/src/modules/reports/export/export.repository.ts`: repositorio de
  lectura paginado/acotado (tipos, topes, implementación Supabase y por defecto
  fail-closed).
- `backend/src/modules/reports/export/export-data.ts`: `ReportExportData`,
  `loadReportExportData`, `resolvePenLabel`, `resolveAnimalCode`.
- `backend/src/modules/reports/export/export-format.ts`: marca, fechas/números,
  `sanitizeCellText` y `buildExportFilename`.
- `backend/src/modules/reports/export/excel.builder.ts`: `buildExcelWorkbook`.
- `backend/src/modules/reports/export/pdf.builder.ts`: `buildPdfDocument`,
  `pdfDocumentTitle/Code`, `MAX_PDF_ROWS`.
- `backend/src/modules/reports/export/export.service.ts`: `createReportsExportService`,
  tipos MIME.
- `backend/src/modules/reports/export/export.schemas.ts`: `PDF_DOCUMENT_TYPES` y
  esquemas de consulta.
- `backend/src/modules/reports/export/export.routes.ts`: rutas de descarga.
- `backend/src/modules/reports/report-labels.ts`: etiquetas es-ES de los enums.
- `backend/tests/reports-export.service.test.ts` (**21 pruebas**).
- `backend/tests/reports-export.repository.test.ts` (**7 pruebas**).
- `backend/tests/reports-export.test.ts` (**20 pruebas**).
- `backend/tests/support/reports-export-fixtures.ts`: fixtures compartidas.
- `docs/progreso/20_SPRINT_5_S5E2_EXPORTACIONES.md`: este documento.

**Backend — modificados**

- `backend/src/app.ts`: opción `reportsExportRepository` y registro de
  `reportsExportRoutes`.
- `backend/src/server.ts`: creación de
  `createSupabaseReportsExportRepository(dataClient)` con el cliente por identidad.
- `backend/src/modules/reports/export/excel.builder.ts`: **corrección** — las
  filas de totales escribían solo la etiqueta y **perdían el valor**; ahora
  muestran «Etiqueta: valor».
- `backend/package.json` / `package-lock.json`: dependencias `exceljs`,
  `pdfkit` y `@types/pdfkit`.

**Frontend — creados**

- `frontend/src/services/reports-export.service.ts` (+ `.test.ts`): tipos de PDF,
  etiquetas, `exportReportsExcel/Pdf`, `triggerDownload`.
- `docs/progreso/20_SPRINT_5_S5E2_EXPORTACIONES.md`.

**Frontend — modificados**

- `frontend/src/lib/http.ts` (+ `.test.ts`): `FileDownload`, `getFile?` y parseo
  de `Content-Disposition`.
- `frontend/src/pages/ReportsPage.tsx` (+ `.test.tsx`): sección de exportaciones
  funcional (botones, selector, estados y descarga).
- `docs/progreso/00_INDICE_Y_CONVENCIONES.md`: índice y estado del Sprint 5.

No se añadieron estilos nuevos: se reutilizan `toolbar`, `field`, `card` y
`alert`.

## Pruebas automatizadas (con mocks; sin datos reales)

- `backend/tests/reports-export.service.test.ts` (**21**): saneado de fórmulas
  (todos los prefijos peligrosos); nombre de archivo ASCII; etiquetas de corral
  con su área; propagación de filtros y reutilización de la lista de porcinos;
  siete hojas en orden; **fórmulas inertes leídas del `.xlsx`**; totales,
  etiquetas y áreas sin corrales; aviso de truncamiento; mensajes de conjunto
  vacío; PDF válido (`%PDF-`) para cada tipo; códigos KPG-RG; PDF vacío; tope
  `MAX_PDF_ROWS`; nombre/tipo de archivo del Excel y del PDF; fallo del resumen.
- `backend/tests/reports-export.repository.test.ts` (**7**): **paginación real**
  (501 filas → dos `range`); **tope `MAX_EXPORT_ROWS`** con truncamiento; tope de
  catálogos; identidad JWT; forma de fila inesperada → `DataAccessError`; error de
  PostgREST → `DataAccessError`; sin operaciones de escritura; repositorio por
  defecto fail-closed.
- `backend/tests/reports-export.test.ts` (**20**): `401` sin token; `403` para
  `viewer` e inactivo; `200` para los cuatro roles operativos; Excel con
  `Content-Type`/`Content-Disposition`/firma ZIP; identidad RLS; filtros; PDF por
  defecto (informe general) y con código KPG-RG-14; `400` por tipo/enum/campo
  inválidos y por rango invertido; `503` sin repositorio y ante fallo; solo
  lectura.
- `frontend/src/lib/http.test.ts` (**18**, +6 nuevas): `getFile` con nombre/tipo;
  forma RFC 5987; sin `Content-Disposition`; `401` con aviso; código del backend;
  fallo de red.
- `frontend/src/services/reports-export.service.test.ts` (**10**): URL del Excel
  con y sin filtros; nombre de reserva; `ApiError`; PDF con `type` siempre
  presente y combinado con filtros; etiquetas con código; cliente sin `getFile`;
  `triggerDownload` (crea enlace, hace clic, revoca).
- `frontend/src/pages/ReportsPage.test.tsx` (**14**, +6 nuevas): Excel con
  filtros aplicados; PDF del tipo elegido; estado de generación; error del
  backend; navegador sin soporte; exportaciones deshabilitadas con rango
  invertido.

## Verificación

- **Backend**: `tsc -p tsconfig.json --noEmit` **OK**;
  `vitest run` = **31 archivos / 562 pruebas OK, 3 archivos / 30 omitidas**
  (integración real *opt-in*, desactivadas por defecto);
  `tsc -p tsconfig.build.json` **OK**.
- **Frontend**: `tsc --noEmit` **OK**; `vitest run` = **26 archivos / 339 pruebas
  OK**; `vite build` **OK** (aviso de tamaño de chunk, preexistente).

> El repositorio tiene cambios sin confirmar de etapas anteriores; estas pruebas
> se ejecutaron contra el estado actual del árbol de trabajo, no contra un commit.

## Limitaciones y pendientes

- **UTC vs. hora local**: los documentos muestran fechas/horas en UTC; falta
  alinear la presentación con `America/Lima` (pendiente transversal).
- **Tope de filas PDF**: 2000 filas por documento con aviso; el detalle completo
  se obtiene del Excel integral.
- **Columnas no cubiertas por el modelo**: los formatos KolkaPig más amplios que
  el modelo de datos se marcan como «versión adaptada de PigTec»; no se inventan
  campos.
- **Coste de generación**: con granjas muy grandes, el Excel puede tardar unos
  segundos (se genera en memoria, sin streaming).
- Se detiene aquí la etapa **S5-E2** y se espera revisión; **no se avanza** a la
  siguiente tarea sin aprobación.

## Pasos para validar manualmente (solo lectura)

1. Levantar backend y frontend con credenciales de desarrollo.
2. `/reports`: pulsar «Descargar Excel» y comprobar las **siete hojas**, la
   cabecera KolkaPig y las cifras reales.
3. Aplicar filtros (p. ej. motivo de movimiento y rango de fechas) y verificar
   que el archivo descargado respeta esos filtros.
4. Elegir cada tipo de PDF y comprobar el código KPG-RG, el periodo, los totales y
   la paginación.
5. Confirmar que sin datos en el periodo los documentos muestran el **mensaje de
   conjunto vacío** (no tablas mudas).
6. Confirmar con `viewer` (o usuario inactivo) que las descargas responden `403`,
   y sin sesión `401`.
7. Verificar que el resto de módulos y el asistente IA siguen funcionando (sin
   regresiones).

---

# S5-E2.1 — Corrección de formato de las exportaciones

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; **no se realizaron escrituras en Supabase**; no se llamó a
Groq ni se ejecutaron pruebas E2E contra la base real.

Corrige los problemas de presentación detectados en la revisión visual. Se tocó
**solo la capa de generación de documentos** (Excel y PDF) y las pruebas.

## Excel (`excel.builder.ts`)

- **Encabezados siempre visibles:** la fila de encabezados reales de la tabla
  (fila 5, una celda por campo, sin fusionar) se escribe en **todas** las hojas
  aunque el conjunto esté vacío. Antes, una hoja vacía fusionaba esa fila y perdía
  los encabezados.
- **Estado vacío que no parece un registro:** cuando no hay filas se añade un
  mensaje **combinado** en una sola celda anclada en la columna A (`Sin
  registros: …`), en cursiva y con relleno suave; no ocupa las demás columnas y
  no puede confundirse con un dato.
- **Totales sin concatenar:** antes se escribía `Etiqueta: valor` en una sola
  celda; ahora la etiqueta va en la columna 1 y el **valor en la columna 2**, y los
  totales compuestos (nacidos total/vivos/muertos) se separan en filas
  independientes.
- **Sin campos concatenados en Estadísticas:** los títulos de sección son filas
  combinadas propias (no registros con celdas vacías) y el mes de «Movimientos por
  mes» ya no se duplica en dos columnas.
- **Anchos y ajuste de texto:** el ancho de cada columna se calcula con el
  encabezado y los datos reales (acotado por mínimo/máximo) y las celdas de datos
  usan `wrapText`, de modo que ningún texto queda cortado.
- **AutoFiltro y panel congelado** en el encabezado de **todas** las hojas (antes
  solo aparecían con datos), sin tocar el bloque de título.
- Se mantienen el bloque de identidad verde de KolkaPig, los códigos KPG-RG, los
  filtros, las fechas con su zona (UTC), el saneado anti-fórmulas, el aviso de
  truncamiento y la distinción entre `0`, dato desconocido (`—`) y «No
  calculable».

## PDF (`pdf.builder.ts`)

- **A4 vertical por defecto:** el informe general es A4 vertical (210 × 297 mm) y
  los reportes individuales también, porque sus tablas caben legiblemente en
  vertical. La orientación se resuelve con `resolvePdfLayout(anchoMinimo)`: pasa a
  **horizontal solo si la tabla no cabe en vertical**. Antes **todo** se generaba
  en A4 apaisado.
- **Encabezado en cada página** con marca `KolkaPig · PigTec`, título, código
  KPG-RG (o tipo de informe), periodo y fecha de generación; pie con marca y
  **numeración «Página X de Y»**.
- **Tablas que se adaptan al ancho:** las columnas se definen por ancho mínimo y
  peso y se reparten el ancho de contenido (una sola fuente por reporte, compartida
  entre la elección de orientación y el dibujo). Los encabezados de tabla crecen en
  altura si necesitan varias líneas.
- **Encabezados siempre visibles aunque el conjunto esté vacío:** `drawTable`
  dibuja la cabecera y, debajo, un estado vacío explícito (`Sin registros: …`).
- **Sin desbordes:** cada fila se mide, salta de página cuando hace falta y, si un
  texto excede el máximo, se marca con puntos suspensivos (nunca se recorta en
  silencio).
- **Datos parciales:** cuando una exploración de detalle se trunca aparece un aviso
  al inicio del documento y otro al final de la tabla, y la ocupación/utilización
  de capacidad incompletas se muestran como «No calculable» (no como totales
  confirmados).

## Pruebas añadidas (backend)

`backend/tests/reports-export.service.test.ts` pasa de **21 a 34 pruebas**. Nuevas:

- Encabezados reales en **celdas individuales** en las siete hojas, con autoFiltro
  y panel congelado.
- Hoja vacía: encabezados intactos + mensaje `Sin registros` combinado en A y
  ninguna otra columna ocupada.
- Totales con etiqueta y valor en celdas separadas.
- Distinción entre `0`, `—` y «No calculable».
- Mes y conteo sin concatenar en Estadísticas.
- Filtros aplicados visibles en la línea de metadatos y en el cuerpo del PDF.
- **PDF general A4 vertical** por `pdfDocumentLayout` y por el `MediaBox` real del
  archivo; `resolvePdfLayout` solo usa horizontal cuando no cabe en vertical.
- El PDF vacío conserva el encabezado de la tabla y muestra el estado vacío (texto
  extraído del PDF con `compress: false`).
- Encabezado con título, periodo, generación y numeración de página.

## Verificación

- **Backend**: `tsc -p tsconfig.json --noEmit` OK; `vitest run` = **31 archivos /
  575 pruebas OK, 3 archivos / 30 omitidas** (integración real *opt-in*);
  `tsc -p tsconfig.build.json` OK.
- **Frontend**: `tsc --noEmit` OK; `vitest run` = **26 archivos / 339 pruebas OK**;
  `vite build` OK (aviso de tamaño de chunk, preexistente).
- **Archivos sintéticos** (sin datos reales) generados en el directorio temporal
  `%LOCALAPPDATA%\Temp\opencode\pigtec-s5e21\`: un `.xlsx` con datos y otro vacío
  (se verificaron las siete hojas, sus encabezados, autoFiltro y congelado) y los
  cinco PDF con `MediaBox` `A4 595.28 × 841.89` (vertical). No se consultó ni
  modificó la base de datos.

## Validación visual desde el navegador

1. Levantar backend y frontend con credenciales de desarrollo (solo lectura).
2. `/reports`: pulsar **Descargar Excel**. Abrir el `.xlsx` y comprobar:
   - las **siete hojas** y sus encabezados en la fila 5 (con la primera fila
     congelada y el filtro activo en cada encabezado);
   - que con un filtro sin resultados la hoja **conserva los encabezados** y
     muestra `Sin registros: …` en una sola celda combinada;
   - que los **totales** aparecen como etiqueta y valor en celdas separadas.
3. Aplicar filtros (motivo, tipo de evento, sexo, origen y rango de fechas) y
   confirmar que el archivo y los PDF respetan esos filtros (línea de metadatos).
4. Descargar cada PDF y comprobar el **A4 vertical**, el encabezado con título,
   KPG-RG, periodo y generación, el pie con «Página X de Y» y los totales.
5. Repetir con un periodo sin datos: encabezados de tabla presentes y estado
   vacío visible.
6. Confirmar con `viewer`/usuario inactivo (`403`) y sin sesión (`401`).

