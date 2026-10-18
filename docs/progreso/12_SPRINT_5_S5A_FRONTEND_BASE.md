# Sprint 5 — S5-A: estructura base del frontend PigTec

**Estado:** implementado y verificado localmente (typecheck, pruebas y build).
**Sin commit ni push.** No se modificó la base de datos, no se aplicaron
migraciones, no se crearon usuarios y no se realizaron escrituras reales.

## Alcance de S5-A

Construir la estructura base del frontend (React + TypeScript + Vite) que permite
navegar por los módulos de PigTec, iniciar sesión con Supabase Auth, respetar los
roles y mostrar estados vacíos/pendientes correctamente. **No** se implementaron
métricas reales, exportaciones ni gráficos.

## Punto de partida

`frontend/` estaba **vacío**: no había proyecto, dependencias ni configuración. Se
creó desde cero reutilizando los contratos reales del backend y sin inventar
endpoints ni campos.

## Contratos reutilizados (sin inventar)

| Uso | Endpoint real | Forma |
|---|---|---|
| Perfil autorizado | `GET /auth/profile` | `{ id, role, is_active }` |
| Asistente | `POST /assistant/chat` | `{ reply, usage, source, quotaRemaining }` |

`source` ∈ `local` \| `data` \| `groq` (coincide con el backend). Los roles se
alinean con `backend/src/modules/auth/roles.ts`: `admin`, `manager`, `operator`,
`veterinarian`; `viewer` se reconoce pero nunca se ofrece (sin permisos).

## Decisiones incorporadas (ampliación de requisitos)

1. PigTec tendrá un módulo **"Reportes y análisis"**.
2. Permitirá exportar a **Excel (.xlsx)** y generar **documentos PDF**.
3. Los PDF **modernizan moderadamente** los formatos originales de KolkaPig,
   conservando identidad documental, códigos **KPG-RG**, nombres de campos,
   organización familiar y finalidad operativa.
4. Prioridad: que un trabajador reconozca y use los nuevos documentos.
5. El **Excel integral** tendrá hojas: resumen, porcinos, movimientos, camadas,
   sanidad, áreas y corrales, y estadísticas (según datos disponibles).
6. El **dashboard** usará gráficos con datos reales (estados de porcinos,
   ocupación de corrales, movimientos por periodo y, después, indicadores
   reproductivos y sanitarios).
7. Los reportes respetan **permisos y filtros**; no inventan ni exportan datos no
   autorizados.
8. Se distinguen los **PDF operativos** de los **informes gerenciales**.
9. Se mantiene el alcance: **sin** inventarios de alimentos, medicamentos ni
   suministros.
10. **En S5-A no se implementan** exportaciones ni gráficos: solo navegación y
    arquitectura preparada para **S5-B** y **S5-E**.

### Referencia documental revisada

Se revisó el PDF de KolkaPig «Registros sin conteo, portada de una hoja»
(`KOLKAPIG_Registros_Sin_Conteo_Portada_Una_Hoja.pdf`, versión 01), que define los
formatos **KPG-RG-01 … KPG-RG-15**. La pantalla `/reports` incluye una tabla que
relaciona cada formato con su módulo y su estado previsto. Los formatos de
alimentación e insumos (**KPG-RG-09** y **KPG-RG-10**) se marcan **fuera de
alcance**; **KPG-RG-12** (ingreso de personas/vehículos) y **KPG-RG-13** (limpieza
y desinfección) no están contemplados en el modelo de datos actual.

## Archivos creados

### Configuración y build (`frontend/`)
`package.json`, `tsconfig.json` (estricto), `vite.config.ts` (Vite + Vitest),
`index.html`, `.env.example`.

### Código (`frontend/src/`)
- `config/`: `env.ts` (validación de entorno, sin exponer valores), `roles.ts`,
  `navigation.ts` (navegación y permisos en una sola fuente).
- `lib/`: `http.ts` (cliente HTTP centralizado + `ApiError` + mensajes),
  `supabase.ts` (cliente de Supabase Auth con clave pública).
- `services/`: `auth.service.ts` (login, logout, perfil autorizado),
  `assistant.service.ts` (chat de solo lectura).
- `context/`: `auth-context.ts`, `AuthProvider.tsx` (única lógica de sesión).
- `components/`: `icons.tsx`, `ConfigErrorScreen.tsx`,
  `auth/` (`ProtectedRoute`, `PublicOnlyRoute`, `RequireRole`,
  `SessionErrorScreen`), `layout/` (`AppLayout`, `Sidebar`, `Header`),
  `ui/` (`Button`, `Alert`, `Card`, `PageHeader`, `StatCard`, `Spinner`,
  `ModulePlaceholder`), `assistant/` (`AssistantWidget`, `AssistantPanel`).
- `pages/`: `LoginPage`, `DashboardPage`, `AreasPensPage`, `AnimalsPage`,
  `MovementsPage`, `LittersPage`, `HealthPage`, `ReportsPage`, `UsersPage`,
  `ForbiddenPage`, `NotFoundPage`.
- `styles/global.css`: sistema de diseño responsive (sin dependencias de CSS).
- `test/`: `setup.ts`, `helpers.tsx`.
- `App.tsx`, `main.tsx`, `vite-env.d.ts`.

### Pruebas (`frontend/src/**/*.test.ts(x)`)
`config/env.test.ts`, `config/navigation.test.ts`, `lib/http.test.ts`,
`services/auth.service.test.ts`, `services/assistant.service.test.ts`,
`components/auth/ProtectedRoute.test.tsx`,
`components/auth/RequireRole.test.tsx`,
`components/assistant/AssistantPanel.test.tsx` (8 archivos, 48 pruebas).

## Rutas del frontend

| Ruta | Acceso | Contenido en S5-A |
|---|---|---|
| `/login` | Pública (única sin sesión) | Formulario de acceso |
| `/` | Roles operativos | Dashboard: bienvenida + indicadores pendientes |
| `/areas` | Roles operativos | Pantalla informativa |
| `/animals` | Roles operativos | Pantalla informativa |
| `/movements` | Roles operativos | Pantalla informativa |
| `/litters` | Roles operativos | Pantalla informativa |
| `/health` | Roles operativos | Pantalla informativa |
| `/reports` | Roles operativos | Alcance del módulo + referencia KPG-RG |
| `/users` | Solo `admin` | Pantalla informativa (resto de roles: 403 en UI) |
| `*` | Sesión válida | Página 404 |

**No hay ruta de registro público.** Las secciones no implementadas muestran una
pantalla informativa; no hay formularios falsos ni cifras inventadas.

## Autenticación y autorización

1. El usuario inicia sesión en Supabase Auth (clave **pública** `anon`).
2. El `AuthProvider` guarda el JWT y lo adjunta en cada petición (`Bearer`).
3. Se consulta `GET /auth/profile`. El backend exige JWT (`401`) y perfil con rol
   operativo y activo (`403`).
4. Si el perfil no es operativo o está inactivo (`viewer`, inactivo, o `403`), se
   **cierra la sesión** y se muestra el motivo en la pantalla de acceso.
5. Si no se pudo verificar el perfil (red/503), **no se concede acceso**: se
   ofrece reintentar o cerrar sesión.
6. Ante `401` en cualquier petición, el cliente HTTP notifica una sola vez y la
   sesión se marca como expirada.

La lógica de sesión vive **solo** en `AuthProvider`/`auth.service.ts` (no se
duplica). Los permisos del menú y de las rutas se derivan del perfil autorizado.

## Chatbot

- Botón flotante (`AssistantWidget`) presente en **todas** las pantallas privadas.
- Panel de conversación responsive (lateral en escritorio, pantalla completa en
  móvil) con `role="dialog"`, foco gestionado y cierre con `Escape`.
- Integra `POST /assistant/chat` con el JWT de la sesión.
- **No envía nada al abrirse**: solo tras pulsar "Enviar" o presionar Enter.
- Muestra el origen de cada respuesta (`Respuesta local`, `Datos del sistema`,
  `IA (Groq)`) y la cuota diaria restante cuando el backend la informa.
- Maneja carga, errores (traducidos por código) y cuota agotada (`429`).
- Es de **solo lectura**: la interfaz únicamente llama a `POST /assistant/chat`; no
  existe ninguna acción que escriba en la base de datos.

## Resultados de las pruebas

| Verificación | Comando | Resultado |
|---|---|---|
| Typecheck (frontend) | `npm run typecheck` | Correcto (sin errores) |
| Pruebas (frontend) | `npm test` | **48 aprobadas**, 8 archivos |
| Build (frontend) | `npm run build` | Correcto (`dist/`) |
| Pruebas (backend) | `npm test` (en `backend/`) | **423 aprobadas**, 30 omitidas |
| Smoke HTTP del build | `vite preview` + `fetch` | `/`, `/login`, `/areas`, ruta desconocida → `200` con SPA |

No se realizaron llamadas reales a Groq ni escrituras en la base de datos durante
las pruebas. Las pruebas del asistente inyectan una función de envío simulada.

## Cómo ejecutar el frontend

```bash
cd frontend
npm install
# crea frontend/.env.local a partir de frontend/.env.example
npm run dev      # http://127.0.0.1:5173
```

`.env.local` requiere `VITE_API_BASE_URL` (por defecto `http://127.0.0.1:3000`),
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (clave pública `anon`). El backend
debe estar en marcha. Si faltan variables, la app muestra una pantalla de
configuración en lugar de fallar en blanco.

**Nunca** se colocan en el frontend la clave `service_role` ni `GROQ_API_KEY`.

## Limitaciones y pendientes

- **Métricas del dashboard:** estructura sin datos; se conectan en **S5-B**.
- **Secciones informativas:** áreas/corrales, porcinos, movimientos, camadas,
  sanidad y usuarios no tienen interfaz funcional todavía (sus APIs de backend
  existen para áreas/corrales, porcinos, movimientos, camadas y sanidad).
- **Reportes:** sin exportaciones Excel/PDF ni gráficos (S5-B/S5-E).
- **Perfil:** la cabecera muestra el **correo** porque la API no expone un nombre;
  no se inventó un campo `name`.
- **Tamaño del bundle:** `vite build` advierte de un chunk > 500 kB (en su mayoría
  `@supabase/supabase-js`); se resolverá con división de código si hace falta.
- **Sin PWA** (no hay manifest ni service worker), por decisión de alcance.
- **Validación pendiente contra el entorno real:** el login y el chat requieren
  una cuenta operativa real y el backend en marcha; no se probaron con
  credenciales reales (no se deben crear usuarios en esta tarea).

## Restricciones respetadas

No se modificó la base de datos ni se aplicaron migraciones; no se crearon
usuarios; no se hicieron escrituras reales; no se llamó a Groq desde pruebas
automatizadas; no se hizo commit ni push; no se imprimieron credenciales ni tokens.
