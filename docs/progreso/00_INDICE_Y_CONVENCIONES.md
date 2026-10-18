# PigTec — Índice de documentación de desarrollo

## Propósito
Permitir que el usuario, otro chat de ChatGPT o OpenCode retomen el proyecto sin depender de la conversación anterior. Este paquete complementa `PIGTEC_ESPECIFICACION_MAESTRA.md`; no la reemplaza.

## Nomenclatura
- **Etapa 0**: preparación y línea base.
- **Sprint 1**: base técnica, compuesto hasta ahora por **S1** (Fastify), **S2** (entorno), **S3** (cliente Supabase), **S4** (autenticación), **S5** (autorización), **S6-A** (integración del perfil autenticado) y **S6-B** (migración inicial de base de datos en el Supabase de desarrollo). Son **tareas del mismo sprint**, no seis sprints distintos.
- **S5**: autorización por roles; implementada y publicada según OpenCode.
- **S6-A**: integración del repositorio de perfiles y `GET /auth/profile`; implementada y publicada.
- **S6-B**: migración inicial `001_initial_schema.sql` **ejecutada manualmente por el usuario** en PigTecBD (desarrollo) y **estructura verificada**. **El aprovisionamiento de perfiles, el diseño de RLS operativas y las pruebas funcionales siguen pendientes.**
- **Sprint 5**: interfaz web. **S5-A** (estructura base del frontend: configuración, autenticación, layout, navegación, dashboard inicial y chatbot) implementada y verificada localmente. **S5-B** (métricas y gráficos reales del dashboard) implementada y verificada con pruebas y build. **S5-C1** (interfaz de áreas y corrales) y **S5-C2** (interfaz de porcinos) implementadas y verificadas con pruebas y build. **S5-D1** (interfaz de movimientos y trazabilidad del porcino) y **S5-D2** (interfaz de camadas y sanidad, con historial sanitario del porcino) implementadas y verificadas con pruebas y build. **S5-E1** (módulo de reportes y análisis con datos reales: endpoint agregado `GET /reports/summary`, indicadores, distribuciones, series y tablas) implementada y verificada con pruebas y build. **S5-E2** (exportaciones Excel/PDF generadas en el backend con el JWT del usuario y RLS, con hojas de resumen/porcinos/movimientos/camadas/sanidad/áreas y corrales/estadísticas y cinco documentos PDF de KolkaPig) implementada y verificada con pruebas y build. **S5-E2.1** (corrección de formato de las exportaciones: encabezados siempre visibles en Excel y PDF, estado vacío que no parece un registro, totales en celdas separadas, anchos y ajuste de texto, autoFiltro/congelado, PDF general en A4 vertical con encabezado y numeración de páginas) implementada y verificada con pruebas y build. **S5-E2.2** (corrección de la presentación de los bloques de totales del Excel: altura de fila medida con el ancho real de la etiqueta, anchos de columna que consideran los totales, indicador y valor en celdas separadas y autoFiltro acotado a las filas de datos reales para que `Sin registros` no se trate como dato) implementada y verificada con pruebas y build.
- **Sprint 6**: **S6-A** (auditoría y preparación de pruebas integrales: inventario del sistema, flujos críticos, matriz de pruebas, clasificación de las suites, escenario de datos sintéticos, plan por fases, protección de escrituras, problemas conocidos y riesgos priorizados) completada con verificación local (typecheck, pruebas y build de backend y frontend). **S6-A.1** (resolución de bloqueantes: informe de seguridad del repositorio, propuesta de commits y verificador SQL de solo lectura) completada sin escribir en Supabase. **S6-A.2** (cierre de auditoría y respaldo Git): el responsable ejecutó el verificador de solo lectura en PigTecBD y **confirmó que los mecanismos de 006/007/008 están presentes**; se corrigió el verificador de permisos (UPDATE de tabla frente a UPDATE por columna), se revisó `PATCH /animals`, se ejecutaron de nuevo las pruebas locales y se preparó el plan de tres commits (**sin commit ni push**). Quedan **R-02** (trabajo sin commitear) y los riesgos no bloqueantes; el seed y la ejecución con escritura siguen para **S6-B**, previa autorización.

## Archivos
- `01_ETAPA_0_PREPARACION.md`: línea base Git y arquitectura.
- `02_SPRINT_1_S1_FASTIFY.md`: servidor y salud.
- `03_SPRINT_1_S2_ENTORNO.md`: variables de entorno.
- `04_SPRINT_1_S3_SUPABASE.md`: cliente por identidad.
- `05_SPRINT_1_S4_AUTENTICACION.md`: autenticación JWT.
- `08_SPRINT_1_S5_AUTORIZACION.md`: implementación RBAC, pruebas, errores y soluciones.
- `09_SPRINT_1_S6A_INTEGRACION_PERFIL.md`: integración del repositorio de perfiles y `GET /auth/profile`.
- `10_SPRINT_1_S6B_MIGRACION_INICIAL.md`: migración 001 (preparación, ejecución, verificaciones de estructura y límites).
- `11_SPRINT_2_AREAS_PENS.md`: API de áreas y corrales con RLS (migración 003).
- `12_SPRINT_5_S5A_FRONTEND_BASE.md`: frontend base (login, layout, navegación, dashboard inicial y chatbot) y decisiones del módulo "Reportes y análisis".
- `13_SPRINT_5_S5A_CORS.md`: ajuste de CORS en el backend (lista blanca `CORS_ALLOWED_ORIGINS`, sin comodín) para habilitar el frontend de S5-A.
- `14_SPRINT_5_S5B_DASHBOARD.md`: dashboard con indicadores y gráficos reales (endpoint agregado `GET /dashboard/summary`, Recharts).
- `15_SPRINT_5_S5C1_AREAS_CORRALES.md`: interfaz funcional de áreas y corrales (`/areas`) y corrección de honestidad de la capacidad en el dashboard.
- `16_SPRINT_5_S5C2_PORCINOS.md`: interfaz funcional de porcinos (`/animals`): listado, alta, detalle, edición y cambio de estado; decisión sobre la capacidad de corral.
- `17_SPRINT_5_S5D1_MOVIMIENTOS.md`: interfaz funcional de movimientos (`/movements`) y trazabilidad del porcino: listado, filtros, paginación, registro con confirmación y matriz de motivos/roles.
- `18_SPRINT_5_S5D2_CAMADAS_SANIDAD.md`: interfaz funcional de camadas (`/litters`) y sanidad (`/health`) e historial sanitario del porcino: listado, filtros, paginación, alta/edición de camadas, registro inmutable de eventos, matriz tipo↔rol y reglas de mortalidad.
- `19_SPRINT_5_S5E1_REPORTES.md`: módulo de reportes y análisis (`/reports`) con endpoint agregado de solo lectura `GET /reports/summary`, indicadores, distribuciones, series, tablas y estados de honestidad de datos.
- `20_SPRINT_5_S5E2_EXPORTACIONES.md`: exportaciones Excel (siete hojas) y PDF (cinco documentos KolkaPig) generadas en el backend con el JWT del usuario y RLS, repositorio de lectura paginado/acotado, saneado anti-fórmulas y estados de la UI en `/reports`.
- `21_SPRINT_5_S5E2_2_TOTALES_EXCEL.md`: corrección de la presentación de los bloques de totales del Excel (altura de fila según el ancho real de la etiqueta, anchos que consideran los totales, indicador y valor en celdas separadas y autoFiltro acotado a las filas de datos reales).
- `22_SPRINT_6_S6A_AUDITORIA.md`: Sprint 6 S6-A — auditoría y preparación de pruebas integrales (inventario, flujos críticos, matriz de pruebas, clasificación de suites, datos sintéticos propuestos, plan por fases, protección de escrituras, problemas conocidos, riesgos priorizados y acciones que requieren autorización).
- `23_SPRINT_6_S6A1_RESOLUCION_BLOQUEANTES.md`: Sprint 6 S6-A.1 — resolución de bloqueantes: informe de seguridad del repositorio (sin secretos versionados), propuesta de estrategia de commits (no ejecutada) y verificador SQL de solo lectura de las migraciones 006/007/008.
- `24_SPRINT_6_S6A2_CIERRE_AUDITORIA_Y_RESPALDO_GIT.md`: Sprint 6 S6-A.2 — cierre de auditoría y respaldo Git: verificación de presencia de 006/007/008 en PigTecBD (solo lectura), corrección del verificador de permisos (UPDATE de tabla frente a UPDATE por columna), revisión de `PATCH /animals`, pruebas locales y plan de tres commits.
- `06_SPRINT_1_RESUMEN_Y_ERRORES.md`: consolidado, incidencias y próximos pasos.
- `07_CONTINUIDAD_PARA_NUEVO_CHAT_Y_OPENCODE.md`: instrucciones de recuperación.

## Regla documental futura
Al cerrar cada tarea: registrar alcance, archivos, cambios, errores y solución, pruebas y evidencia, commit/push, restricciones y pendientes. Al cerrar cada sprint: emitir un resumen acumulativo y una lista de incidencias. No afirmar como comprobados hechos que solo se hayan reportado. Guardar estos Markdown en `docs/progreso/` del repositorio mediante un commit específico, previa revisión.
