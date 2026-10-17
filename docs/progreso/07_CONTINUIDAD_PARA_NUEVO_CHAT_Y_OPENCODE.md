# PigTec — Guía de continuidad para otro chat o OpenCode

## Qué leer primero
1. `PIGTEC_ESPECIFICACION_MAESTRA.md` (fuente normativa del alcance y decisiones).
2. `AGENTS.md` (restricciones para agentes).
3. `docs/progreso/00_INDICE_Y_CONVENCIONES.md` y `docs/progreso/06_SPRINT_1_RESUMEN_Y_ERRORES.md`.
4. Informe de la última tarea terminada.
5. Código real y `git log`/`git status` del repositorio, que prevalecen sobre un resumen si hubiera discrepancias.

## Ubicación del proyecto
Windows: `C:\Users\ACER\Desktop\UNAMBA\Fercyt\VET\PigTec` (confirmar en el equipo). GitHub: `https://github.com/damon14-ip/PigTec`, rama `master`.

## Estado confirmado por reportes
- Línea base `71ea3c5`.
- S1 `865a136`.
- S2 `0820719`.
- S3 `b90f892`.
- S4 `8fe6061`.
- Documentación hasta S4 `2daddf6`; documentación de S5 `2898e5a`.
- S5 `e741ebb` (RBAC modular).
- S6-A `3148363` (repositorio de perfiles integrado + `GET /auth/profile`).
- S6-B: migración inicial `86d430b` (`database/migrations/001_initial_schema.sql` + README), **ejecutada manualmente en PigTecBD (desarrollo)**; estructura verificada (7 tablas, vista `v_animals_current` con `security_invoker=true`, 8 triggers, RLS en 7 tablas, política única `profile_select_own`). PostgreSQL 17.11, `auth.users` disponible.
- `GET /health` público; `GET /auth/me` requiere JWT verificado por Supabase Auth; `GET /auth/profile` requiere JWT + rol operativo + perfil activo.
- Último total reportado: 99 pruebas aprobadas en siete archivos, compilación y typecheck correctos.
- S1–S6-A no modificaron Supabase. En S6-B **sí** se aplicó la migración 001 al proyecto de **desarrollo** (PigTecBD); el proyecto anterior (pruebas independientes) **no fue modificado**. Sin credenciales en el repositorio.

## Reglas de negocio esenciales
- Una sola granja: KolkaPig.
- Roles funcionales: admin, manager, operator, veterinarian; `viewer` es legado.
- Trabajador/operator no registra animales directamente: envía solicitud; manager/admin aprueba o rechaza, sin autoaprobación.
- Código de animal automático `PIG-000001` mediante secuencia/operación segura; arete opcional y único normalizado.
- Movimientos y salud con trazabilidad; un corral actual por animal, validar capacidad.
- Autenticación ≠ autorización: consultar rol/activo desde fuente confiable, aplicar backend + RLS.

## Próximo trabajo
S6-B completada: migración 001 aplicada y estructura verificada en PigTecBD (desarrollo). **Siguiente: S6-C** — aprovisionamiento de perfiles (rol explícito, sin `viewer` por defecto), diseño de **políticas RLS operativas**, pruebas **funcionales** de triggers/vista/índice de aretes/CHECK de origen con datos sintéticos, y conexión del backend a PigTecBD para validar `GET /auth/profile`. El RBAC sigue sin conectarse a rutas operativas (áreas, corrales, animales, solicitudes). **No crear la migración 002 ni ejecutar SQL sin aprobación.**

## Verificaciones para reiniciar
```bash
git status
git log --oneline -6
cd backend
npm run typecheck
npm run build
npm test
```
No compartir tokens, `.env` ni claves. Si el código no coincide con este documento, investigar y actualizar el registro antes de seguir.

## Texto para iniciar un nuevo chat
«Estamos desarrollando PigTec para KolkaPig/FERCYT UNAMBA. Adjunto la especificación maestra y los Markdown de progreso. Actúa como desarrollador senior, guíame paso a paso. S1–S6-B del Sprint 1 están completadas según los reportes: la migración inicial `001_initial_schema.sql` (commit `86d430b`) ya se ejecutó en el Supabase de desarrollo PigTecBD. Necesito continuar con S6-C (aprovisionamiento de perfiles, diseño de RLS operativas y pruebas funcionales) sin ejecutar SQL ni tocar el proyecto de producción sin aprobación. Primero revisa los documentos y verifica el estado antes de proponer cambios».

## Documentación y continuidad
`08_SPRINT_1_S5_AUTORIZACION.md` y `09_SPRINT_1_S6A_INTEGRACION_PERFIL.md` registran los hitos S5 y S6-A. Actualizar este archivo y el resumen tras cada tarea, y crear un commit documental separado. Antes de declarar Sprint 1 cerrado, verificar criterios de aceptación, limitaciones y riesgos.
