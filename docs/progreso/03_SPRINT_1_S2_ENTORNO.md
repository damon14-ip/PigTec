# Sprint 1 — S2: Configuración de entorno

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Objetivo
Validar variables de entorno antes de iniciar el backend, sin filtrar secretos y sin requerir conexión a Supabase.

## Archivos
- Nuevo `backend/.env.example`: `PORT`, `HOST`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` con valores ficticios.
- Nuevo `backend/src/config/env.ts`: esquema Zod, `parseEnv`, `formatEnvError`, `loadDotEnv`.
- Nuevo `backend/tests/env.test.ts`.
- Modificados `backend/src/server.ts`, `backend/package.json`, `backend/package-lock.json`.
- Dependencia: `zod` 4.6.7 (según reporte).

## Decisiones
- Node 22 `process.loadEnvFile()`; no dependencia `dotenv`.
- `PORT` entero 1–65535, `HOST` con valor por defecto.
- `SUPABASE_URL` exige HTTPS y hostname con etiquetas válidas.
- `.env` opcional: ignorar solo `ENOENT`; otros fallos de lectura se comunican de manera saneada.
- Sin `.env` real versionado.

## Errores encontrados y resolución
1. La primera versión de `loadDotEnv` ignoraba **todos** los errores. Se corrigió para ignorar solo `ENOENT` y propagar errores distintos sin mostrar el contenido original.
2. `z.url()` permitía protocolos como HTTP/FTP y algunos hosts no deseados. Se sustituyó por validación de protocolo HTTPS y hostname.
3. Una prueba esperaba rechazar `https:///proyecto`, pero el parser `URL` de Node lo normaliza a un host. Se corrigió la prueba para usar `https://` como caso de host ausente.
4. Una ejecución inicial de tests tuvo **17/18**; tras la corrección terminó en **18/18**.

## Validación final
`typecheck` OK; `build` OK; **18/18 pruebas**; `GET /health` → 200; arranque sin variables obligatorias → error de configuración y código de salida 1.

## Git
`0820719eca2934e512e63c1bc01d3dcc07dc45d4` — `feat(backend): validate environment configuration`, subido a `origin/master`.
