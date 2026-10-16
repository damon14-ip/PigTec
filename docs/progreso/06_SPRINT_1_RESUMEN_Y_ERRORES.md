# Sprint 1 — Consolidado hasta S4

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Estado
**S1–S4 completadas y publicadas según logs. Sprint 1 aún no se declara cerrado formalmente si S5 forma parte del alcance pendiente.** No se ha desarrollado frontend ni se han aplicado migraciones adicionales.

| Tarea | Resultado | Pruebas al terminar | Commit |
|---|---|---:|---|
| S1 | Fastify + `/health` | 2/2 | `865a136` |
| S2 | Entorno validado | 18/18 | `0820719` |
| S3 | Cliente Supabase aislado | 26/26 | `b90f892` |
| S4 | Autenticación JWT + `/auth/me` | 52/52 | `8fe6061` |

**Nota:** las cifras son totales acumulados de pruebas del backend en cada hito, no pruebas adicionales por tarea.

## Registro consolidado de incidencias
| ID | Etapa | Problema | Resolución | Estado |
|---|---|---|---|---|
| INC-001 | Etapa 0 | Rutas CMD/Bash incompatibles y paréntesis en ruta | Usar sintaxis de Git Bash y ruta correcta | Resuelto |
| INC-002 | Etapa 0 | Token personal de GitHub expuesto en chat | Se recomendó revocación; sin confirmación | **Pendiente de confirmar** |
| INC-003 | S2 | Lectura `.env` silenciaba errores no ENOENT | Solo ignorar ENOENT | Resuelto |
| INC-004 | S2 | Validación de URL demasiado permisiva | Exigir HTTPS + hostname | Resuelto |
| INC-005 | S2 | Caso de prueba URL normalizada por Node | Ajustar prueba al comportamiento real | Resuelto |
| INC-006 | S3 | Sondeo fuera del directorio no resolvía paquete | Ejecutar en backend | Resuelto |
| INC-007 | S3 | Tipo DOM `RequestInfo` no disponible | Usar tipos de `fetch` de Node | Resuelto |
| INC-008 | S4 | `&&` no aceptado en PowerShell utilizado | Usar `;` | Resuelto |
| INC-009 | S4 | Servidor levantó `dist` desactualizado | Compilar y arrancar secuencialmente | Resuelto |
| INC-010 | S4 | Bearer y `id` poco estrictos | Validaciones y pruebas de regresión | Resuelto |

## Restricciones y riesgos abiertos
- Supabase de producción ya contiene esquema inicial, con políticas RLS incompletas; **no modificar sin autorización**.
- La existencia de un token JWT válido no autoriza operaciones de negocio.
- No hay pruebas end-to-end contra Supabase real.
- El proyecto usa datos sintéticos para pruebas; identificarlos como tales en cualquier informe FERCYT.
- Revisar y confirmar revocación del token GitHub previamente compartido.

## Próximo hito propuesto
**S5: autorización por rol y estado activo**, tras inspeccionar la tabla `profiles` y su RLS. Preparar implementación con mocks, sin aplicar SQL a producción, y solicitar revisión antes de commits o cambios de base de datos.
