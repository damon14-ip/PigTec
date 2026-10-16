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
- Documentación hasta S4 `2daddf6`.
- S5 `e741ebb` (RBAC modular; sin rutas operativas conectadas).
- `GET /health` público; `GET /auth/me` requiere JWT verificado por Supabase Auth.
- Último total reportado: 84 pruebas aprobadas, compilación y typecheck correctos.
- No se han hecho cambios de Supabase real durante S1–S5.

## Reglas de negocio esenciales
- Una sola granja: KolkaPig.
- Roles funcionales: admin, manager, operator, veterinarian; `viewer` es legado.
- Trabajador/operator no registra animales directamente: envía solicitud; manager/admin aprueba o rechaza, sin autoaprobación.
- Código de animal automático `PIG-000001` mediante secuencia/operación segura; arete opcional y único normalizado.
- Movimientos y salud con trazabilidad; un corral actual por animal, validar capacidad.
- Autenticación ≠ autorización: consultar rol/activo desde fuente confiable, aplicar backend + RLS.

## Próximo trabajo
S5 implementada y publicada según OpenCode. **Primero versionar estos documentos de S5**, luego planificar S6. El mecanismo de roles aún no está conectado a rutas operativas; no se ha probado contra Supabase real. Antes de tocar operaciones sobre animales, revisar RLS y reglas de negocio de la especificación maestra. No aplicar migraciones ni cambiar Supabase producción sin permiso.

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
«Estamos desarrollando PigTec para KolkaPig/FERCYT UNAMBA. Adjunto la especificación maestra y los Markdown de progreso. Actúa como desarrollador senior, guíame paso a paso. S1–S5 del Sprint 1 están terminadas según los reportes y GitHub; último commit `e741ebb`. Necesito continuar con S6 sin modificar Supabase producción. Primero revisa los documentos y verifica el estado antes de proponer cambios».

## Documentación y continuidad
`08_SPRINT_1_S5_AUTORIZACION.md` registra el hito S5. Actualizar este archivo y el resumen tras cada tarea, y crear un commit documental separado. Antes de declarar Sprint 1 cerrado, verificar criterios de aceptación, limitaciones y riesgos.
