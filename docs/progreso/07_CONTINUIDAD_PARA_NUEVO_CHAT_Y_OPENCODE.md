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
- `GET /health` público; `GET /auth/me` requiere JWT verificado por Supabase Auth.
- Último total reportado: 52 pruebas aprobadas, compilación y typecheck correctos.
- No se han hecho cambios de Supabase real durante S1–S4.

## Reglas de negocio esenciales
- Una sola granja: KolkaPig.
- Roles funcionales: admin, manager, operator, veterinarian; `viewer` es legado.
- Trabajador/operator no registra animales directamente: envía solicitud; manager/admin aprueba o rechaza, sin autoaprobación.
- Código de animal automático `PIG-000001` mediante secuencia/operación segura; arete opcional y único normalizado.
- Movimientos y salud con trazabilidad; un corral actual por animal, validar capacidad.
- Autenticación ≠ autorización: consultar rol/activo desde fuente confiable, aplicar backend + RLS.

## Próximo trabajo
S5, **no implementado**: diseño e implementación controlada de autorización RBAC. Antes de codificar, inspeccionar contratos de `profiles`, RLS, y definir pruebas para cuentas inactivas, rol inexistente, permisos cruzados y aislamiento. No aplicar migraciones ni cambiar Supabase producción sin permiso.

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
«Estamos desarrollando PigTec para KolkaPig/FERCYT UNAMBA. Adjunto la especificación maestra y los Markdown de progreso. Actúa como desarrollador senior, guíame paso a paso. S1–S4 del Sprint 1 están terminadas según los reportes y GitHub; último commit `8fe6061`. Necesito continuar con S5 sin modificar Supabase producción. Primero revisa los documentos y verifica el estado antes de proponer cambios».

## Cómo documentar el siguiente hito
Al finalizar S5, crear `08_SPRINT_1_S5_AUTORIZACION.md` con objetivos, implementación, pruebas, incidencias y soluciones, commit, limitaciones y pendientes. Actualizar resumen e índice. Cuando el sprint se declare cerrado, emitir además `SPRINT_1_CIERRE.md` con criterios de aceptación y riesgos restantes.
