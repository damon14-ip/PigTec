# Etapa 0 — Preparación y línea base

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Objetivo y resultado
Organizar PigTec como proyecto versionado y establecer instrucciones para agentes. Se acordó un MVP de gestión porcina para KolkaPig en contexto FERCYT UNAMBA.

## Arquitectura acordada
- React + TypeScript + Vite en frontend.
- Node.js + TypeScript + Fastify en backend.
- Supabase PostgreSQL, Supabase Auth y políticas RLS.
- API REST; funcionalidades de IA previstas como consulta/lectura, no como escritura autónoma.
- GitHub: `https://github.com/damon14-ip/PigTec`, rama `master`.

## Archivos iniciales versionados
`.gitignore`, `AGENTS.md`, `README.md`, `PorciControl_BD_inicial.txt`, `PIGTEC_ESPECIFICACION_MAESTRA.md`.

## Commits
- `71ea3c5` — `chore: commit de linea base con documentacion inicial del proyecto`.
- El repositorio remoto `origin` se configuró y se subió la rama `master`.

## Errores / incidencias y solución
- En Git Bash se intentó usar `cd /d`, propio de CMD: se aclaró el uso de `cd ~/Desktop/UNAMBA/Fercyt/VET/PigTec`.
- Se intentó una ruta con paréntesis sin comillas: Bash informó error de sintaxis. Se corrigió la ruta.
- Se compartió un token personal de GitHub en la conversación: se recomendó revocarlo y usar autenticación mediante el gestor de credenciales. **No hay constancia de revocación**; tratarlo como expuesto.

## Restricciones relevantes
No modificar Supabase producción, migraciones, RLS o credenciales sin autorización expresa. El script SQL inicial ya se aplicó una vez: no volver a ejecutarlo indiscriminadamente.
