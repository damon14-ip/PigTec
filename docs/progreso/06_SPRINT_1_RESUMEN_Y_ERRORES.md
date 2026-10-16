# Sprint 1 — Consolidado hasta S6-A

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Estado
**S1–S5 y S6-A completadas y publicadas según logs. Sprint 1 no se declara formalmente cerrado hasta confirmar sus criterios de cierre.** No se ha desarrollado frontend ni se han aplicado migraciones adicionales.

| Tarea | Resultado | Pruebas al terminar | Commit |
|---|---|---:|---|
| S1 | Fastify + `/health` | 2/2 | `865a136` |
| S2 | Entorno validado | 18/18 | `0820719` |
| S3 | Cliente Supabase aislado | 26/26 | `b90f892` |
| S4 | Autenticación JWT + `/auth/me` | 52/52 | `8fe6061` |
| S5 | Autorización RBAC + consulta de perfiles | 84/84 | `e741ebb` |
| S6-A | Integración del repositorio de perfiles + `GET /auth/profile` | 99/99 | `3148363` |

**Nota:** las cifras son totales acumulados de pruebas del backend en cada hito, no pruebas adicionales por tarea.

**Commits documentales:** `2daddf6` (ocho Markdown hasta S4) y `2898e5a` (S5). **Commits de código:** S5 `e741ebb`; S6-A `3148363`. La documentación de S6-A se incorpora en un commit separado.

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
| INC-011 | S5 | TS2554: argumentos de preHandler | Pruebas Fastify `inject` en lugar de hooks manuales | Resuelto |
| INC-012 | S5 | TS2684: contexto `this` | Pruebas `inject` | Resuelto |
| INC-013 | S5 | TS2352: conversión `void`/Promise | Eliminación de helper manual | Resuelto |
| INC-014 | S5 | TS2589/TS2322: genéricos Supabase | `PromiseLike` y cast documentado en test | Resuelto en pruebas |
| INC-015 | S5 | Error de consulta confundido con perfil inexistente | `ProfileLookupError` y HTTP 503 | Resuelto |
| INC-016 | S5 | Tipo `Awaited<ReturnType<…>>` excesivo | Tipo explícito de resultado | Resuelto |
| INC-017 | S6-A | `SupabaseClient` no asignable a la interfaz estrecha al cablear producción | Adaptador de tipos: cast documentado en `server.ts` | Resuelto |
| INC-018 | S6-A | Riesgo de autorizar si `buildApp` se usa sin repositorio real | `createRejectingProfileRepository()` por defecto (503, fail-closed) | Resuelto |

## Restricciones y riesgos abiertos
- Supabase de producción ya contiene esquema inicial, con políticas RLS incompletas; **no modificar sin autorización**.
- La existencia de un token JWT válido no autoriza operaciones de negocio.
- No hay pruebas end-to-end contra Supabase real.
- El proyecto usa datos sintéticos para pruebas; identificarlos como tales en cualquier informe FERCYT.
- Revisar y confirmar revocación del token GitHub previamente compartido.

## Próximo hito propuesto
**S6-B: preparación de Supabase de desarrollo, aprovisionamiento de perfiles y diseño de RLS.** Verificar el proyecto real, definir la creación/asignación de perfiles y diseñar políticas RLS de tablas operativas. Sin aplicar SQL a producción y solicitando revisión antes de commits o cambios de base de datos.

## Situación tras S6-A
Autenticación y autorización modulares e integradas en el arranque real; `GET /auth/profile` operativo con RBAC y consulta de perfil vía RLS. El RBAC sigue **sin conectarse a rutas operativas** (áreas, corrales, animales, solicitudes). S6-B abordará Supabase de desarrollo, aprovisionamiento de perfiles y RLS.
