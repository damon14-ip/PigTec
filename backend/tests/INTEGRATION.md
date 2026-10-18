# Pruebas de integración del backend (Sprint 4)

Estas pruebas hablan con un backend Fastify **en ejecución** (`npm run dev`) y,
por tanto, con la base PostgreSQL de Supabase usando la identidad de un **JWT
real**. No forman parte de `npm test`.

> Regla del proyecto: **no** escribir en Supabase ni ejecutar SQL remoto sin
> autorización explícita (ver `AGENTS.md`). Este documento describe cómo
> ejecutarlas **primero en modo solo lectura**.

## 1. Ficheros

| Fichero | Efecto | Cuándo corre |
|---|---|---|
| `tests/support/e2e.ts` | Utilidades compartidas (lectura de entorno, `fetch`). | No es una prueba. |
| `tests/sprint4.readonly.integration.test.ts` | **Solo lectura.** | Con `PIGTEC_E2E_BASE_URL` + `PIGTEC_E2E_TOKEN`. |
| `tests/sprint4.write.integration.test.ts` | **MUTA datos.** | Además de lo anterior, con `PIGTEC_E2E_WRITE=1`. |
| `tests/movements.integration.test.ts` | **MUTA datos.** | Igual que el anterior. |
| `tests/sprint4.sql-safety.test.ts` | Estático, sin base de datos. | Siempre (dentro de `npm test`). |
| `../database/verification/sprint4_transactional_check.sql` | Script SQL `BEGIN … ROLLBACK`. | **Manual**, en el SQL Editor. |

## 2. Variables de entorno (locales; nunca se suben a Git)

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PIGTEC_E2E_BASE_URL` | Sí | p. ej. `http://127.0.0.1:3000`. |
| `PIGTEC_E2E_TOKEN` | Sí | JWT de un usuario **operativo activo**. La escritura exige `admin` o `manager`. |
| `PIGTEC_E2E_WRITE` | No | `1` autoriza las pruebas que **escriben**. Ausente = solo lectura. |
| `PIGTEC_E2E_VIEWER_TOKEN` | No | JWT de un usuario `viewer` activo, para comprobar el rechazo 403. |
| `PIGTEC_E2E_RESTORE` | No | `1` devuelve el animal a su corral original al terminar (`movements.integration`). |

No se imprime el token en ninguna salida.

## 3. Paso 1 — modo SOLO LECTURA (obligatorio antes de escribir)

En una terminal:

```powershell
cd backend
npm run dev
```

En otra terminal (PowerShell), con el `.env` que ya existe (no se modifica):

```powershell
cd backend
$env:PIGTEC_E2E_BASE_URL = 'http://127.0.0.1:3000'
$env:PIGTEC_E2E_TOKEN    = '<jwt de un usuario operativo activo>'
# Opcional, para comprobar el 403 de un rol sin permisos de escritura:
$env:PIGTEC_E2E_VIEWER_TOKEN = '<jwt de un usuario viewer activo>'

npm run test:integration
```

Qué se comprueba y por qué es seguro:

- `GET /health`, `GET /auth/me`, `GET /auth/profile`.
- Listados de `animals`, `pens`, `areas`, `litters`, `health-events`, `movements`
  (RLS con la identidad real).
- `401` sin JWT y con JWT mal formado.
- `400` en cuerpos que el esquema Zod rechaza (p. ej. `animal_code` en el alta o
  en la actualización, `details` no-objeto). El esquema corta **antes** de la
  base.
- `403` para un `viewer` (solo si aportas `PIGTEC_E2E_VIEWER_TOKEN`).

Este modo **no crea, modifica ni borra filas**.

## 4. Paso 2 — modo ESCRITURA (solo con autorización explícita)

> Requiere autorización del responsable del proyecto. Cada corrida deja filas
> permanentes (historial inmutable).

```powershell
cd backend
$env:PIGTEC_E2E_BASE_URL = 'http://127.0.0.1:3000'
$env:PIGTEC_E2E_TOKEN    = '<jwt de un admin o manager activo>'
$env:PIGTEC_E2E_WRITE    = '1'

npm run test:integration
```

Datos que crea (marcados `[PRUEBA E2E Sprint4]`, aretes `E2E4-*`):

- 1 área sintética y 2 corrales activos.
- Porcinos con código `PIG-000001` autogenerado.
- 1 movimiento interno (historial inmutable; **no** se borra).
- 1 camada sintética.
- 1 observación y 1 mortalidad (historial sanitario inmutable).

No borra ni altera datos existentes. **No** usar con cuentas reales de KolkaPig.

## 5. Paso 3 — verificación SQL transaccional (manual, opcional)

`database/verification/sprint4_transactional_check.sql` se ejecuta **a mano** en
el SQL Editor de Supabase, como propietario. Se abre con `BEGIN` y termina con
`ROLLBACK`: **nunca** confirma la transacción. Comprueba la generación de
`animal_code`, los triggers de movimiento y mortalidad, la inmutabilidad del
historial y los privilegios restrictivos, e imprime una lista `OK n: …`.

Antes de ejecutarlo, confirma en el Dashboard que el proyecto es **PigTecBD**.

## 6. Por qué no corre en `npm test`

Las suites de integración se **omiten** salvo que existan las variables de
entorno (y, para escribir, `PIGTEC_E2E_WRITE=1`). `npm test` no define ninguna,
así que quedan en estado *skipped* y no tocan la red.
