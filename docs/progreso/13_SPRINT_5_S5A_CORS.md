# Sprint 5 — Ajuste de CORS en el backend (habilitación del frontend S5-A)

**Estado:** implementado y verificado (typecheck, build, pruebas y smoke HTTP real).
**Sin commit ni push.** No se modificó la base de datos, las migraciones ni RLS.

## Motivo

Al preparar la validación manual de **S5-A** se detectó que el backend **no tenía CORS
configurado**: no existía el plugin `@fastify/cors`, no había cabeceras
`Access-Control-Allow-*`, y `frontend/vite.config.ts` no define proxy. Como el
frontend (`http://127.0.0.1:5173`) y el backend (`http://127.0.0.1:3000`) son
orígenes distintos (mismo host, distinto puerto), el navegador bloqueaba
`GET /auth/profile` y `POST /assistant/chat`. El login contra Supabase Auth sí
funcionaba (llamada directa a Supabase), pero el `AuthProvider` no podía verificar
el perfil y mostraba "No se pudo verificar tu perfil con el servidor", por lo que
nunca se llegaba al dashboard.

La validación previa de S5-A fue un `vite preview` + smoke HTTP de la SPA
(ver `12_SPRINT_5_S5A_FRONTEND_BASE.md`), que **no** ejercita peticiones
cross-origin reales al backend; por eso el hueco no se había detectado.

## Alcance

Habilitar CORS **solo** para orígenes autorizados, de forma explícita y sin
comodines, para que el frontend pueda comunicarse con el backend. Se conservan
intactas la autenticación, la autorización por roles y el chatbot.

## Decisión de diseño

- **Plugin:** `@fastify/cors@^11.3.1` (compatible con Fastify `^5.x`).
- **Lista blanca por variable de entorno:** `CORS_ALLOWED_ORIGINS` (lista separada
  por comas). Cada entrada se valida como origen `http/https` sin ruta, consulta,
  fragmento ni credenciales; se normaliza a `esquema://host:puerto` y se eliminan
  duplicados.
- **Sin comodín:** se rechaza explícitamente `*`. No se usa `origin: true` ni se
  refleja cualquier origen.
- **Valor por defecto:** `http://127.0.0.1:5173` (origen de desarrollo de Vite),
  de modo que el entorno local funciona sin edición adicional. En producción debe
  fijarse el origen real.
- **Fail-closed:** si `buildApp` no recibe orígenes, CORS no se habilita y ninguna
  petición cross-origin queda autorizada.
- **Sin credenciales de navegador:** `credentials: false` (la sesión va por
  `Authorization: Bearer`, no por cookies).
- Los mensajes de error de configuración **nunca** incluyen el valor introducido.

## Archivos modificados

- `backend/package.json` y `backend/package-lock.json`: nueva dependencia
  `@fastify/cors@^11.3.1`.
- `backend/src/config/cors.ts` (**nuevo**): `normalizeOrigin`, `parseAllowedOrigins`,
  `isValidOriginList`, `DEFAULT_CORS_ALLOWED_ORIGINS`, `CorsConfigError`.
- `backend/src/config/env.ts`: nueva variable validada `CORS_ALLOWED_ORIGINS`
  (con valor por defecto y refine).
- `backend/src/app.ts`: opción `corsAllowedOrigins` y registro condicional del
  plugin (`origin` = lista blanca, `methods`, `allowedHeaders`, `credentials:false`).
- `backend/src/server.ts`: parsea y valida los orígenes y los inyecta en `buildApp`;
  registra en el log los orígenes permitidos (no son secretos).
- `backend/.env.example`: sección `CORS (lista blanca de origenes del navegador)`.
- `backend/tests/env.test.ts`: se ajusta el objeto esperado y se añaden pruebas de
  `CORS_ALLOWED_ORIGINS` (por defecto, lista, comodín, ruta, protocolo, vacío y no
  filtración del valor).
- `backend/tests/cors.test.ts` (**nuevo**): normalización, parseo y comportamiento
  de las cabeceras CORS.

## Configuración

`backend/.env.example` (y opcionalmente `backend/.env`):

```dotenv
CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173
```

En producción: `CORS_ALLOWED_ORIGINS=https://<origen-real-del-frontend>`.
Prohibido el comodín `*`.

## Pruebas y evidencia

| Verificación | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | Correcto (sin errores) |
| Build | `npm run build` | Correcto (`dist/`) |
| Pruebas | `npm test` | **442 aprobadas**, 30 omitidas (24 archivos; antes 423/30) |
| Smoke HTTP real | servidor `npm run dev` en `127.0.0.1:3000` | ver abajo |

Smoke HTTP contra el servidor real en marcha (no inyectado):

| Caso | Resultado |
|---|---|
| `GET /health` con `Origin: http://127.0.0.1:5173` | `200`, `Access-Control-Allow-Origin: http://127.0.0.1:5173` |
| `OPTIONS /auth/profile` desde origen autorizado | `204`, `ACAO: http://127.0.0.1:5173`, `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Accept, Authorization, Content-Type` |
| `GET /health` con `Origin: http://sitio-no-autorizado.example` | `200`, **sin** `Access-Control-Allow-Origin` |
| `OPTIONS /auth/profile` desde origen NO autorizado | `204`, **sin** `Access-Control-Allow-Origin` |

Las pruebas cubren además: preflight autorizado, rechazo de origen no autorizado
(simple y preflight), que una ruta protegida sigue exigiendo token (`401`), y el
modo fail-closed sin orígenes configurados.

## Restricciones respetadas

No se modificó la base de datos, las migraciones ni RLS; no se alteraron la
autenticación, los permisos ni el funcionamiento del chatbot (solo se añaden
cabeceras CORS); no se usó `origin: "*"`; no se hicieron escrituras en Supabase;
no se hizo commit ni push.

## Pendientes

- **Validación manual de S5-A** en el navegador con una cuenta real (login,
  dashboard, navegación, chatbot, cierre de sesión y protección de rutas).
- **S5-B**: métricas reales del dashboard.
