# PigTec — Índice de documentación de desarrollo

## Propósito
Permitir que el usuario, otro chat de ChatGPT o OpenCode retomen el proyecto sin depender de la conversación anterior. Este paquete complementa `PIGTEC_ESPECIFICACION_MAESTRA.md`; no la reemplaza.

## Nomenclatura
- **Etapa 0**: preparación y línea base.
- **Sprint 1**: base técnica, compuesto hasta ahora por **S1** (Fastify), **S2** (entorno), **S3** (cliente Supabase), **S4** (autenticación), **S5** (autorización), **S6-A** (integración del perfil autenticado). Son **tareas del mismo sprint**, no seis sprints distintos.
- **S5**: autorización por roles; implementada y publicada según OpenCode.
- **S6-A**: integración del repositorio de perfiles y `GET /auth/profile`; implementada y publicada. **S6-B** (Supabase de desarrollo, aprovisionamiento de perfiles y diseño de RLS) está pendiente.

## Archivos
- `01_ETAPA_0_PREPARACION.md`: línea base Git y arquitectura.
- `02_SPRINT_1_S1_FASTIFY.md`: servidor y salud.
- `03_SPRINT_1_S2_ENTORNO.md`: variables de entorno.
- `04_SPRINT_1_S3_SUPABASE.md`: cliente por identidad.
- `05_SPRINT_1_S4_AUTENTICACION.md`: autenticación JWT.
- `08_SPRINT_1_S5_AUTORIZACION.md`: implementación RBAC, pruebas, errores y soluciones.
- `09_SPRINT_1_S6A_INTEGRACION_PERFIL.md`: integración del repositorio de perfiles y `GET /auth/profile`.
- `06_SPRINT_1_RESUMEN_Y_ERRORES.md`: consolidado, incidencias y próximos pasos.
- `07_CONTINUIDAD_PARA_NUEVO_CHAT_Y_OPENCODE.md`: instrucciones de recuperación.

## Regla documental futura
Al cerrar cada tarea: registrar alcance, archivos, cambios, errores y solución, pruebas y evidencia, commit/push, restricciones y pendientes. Al cerrar cada sprint: emitir un resumen acumulativo y una lista de incidencias. No afirmar como comprobados hechos que solo se hayan reportado. Guardar estos Markdown en `docs/progreso/` del repositorio mediante un commit específico, previa revisión.
