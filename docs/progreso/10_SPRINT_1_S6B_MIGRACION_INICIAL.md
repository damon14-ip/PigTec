# Sprint 1 — S6-B: Migración inicial de base de datos en PigTecBD

**Estado:** migración **001 ejecutada manualmente por el usuario** en el SQL Editor
del proyecto Supabase de **desarrollo** (PigTecBD) y **estructura verificada**.
**No equivale a validación funcional ni a pruebas end-to-end.** Las migraciones
002 y posteriores **no** se han preparado ni ejecutado.

> **Origen de la evidencia:** los resultados de ejecución y de estructura fueron
> reportados por el usuario tras ejecutar el script en el SQL Editor. No se han
> reejecutado ni comprobado de forma independiente desde OpenCode, y este entorno
> **no se conectó** a ningún proyecto Supabase.

## Objetivo y alcance

Preparar y aplicar, en un Supabase de **desarrollo** vacío, la migración inicial
versionada que recrea la estructura y las reglas de negocio del esquema inicial
del proyecto (`PorciControl_BD_inicial.txt`). El alcance de S6-B es exclusivamente
la **estructura** de base de datos: no incluye aprovisionamiento de perfiles,
políticas RLS operativas ni conexión del backend a datos reales.

## Entorno

| Entorno | Proyecto | Uso |
|---|---|---|
| Desarrollo | **PigTecBD** | Ejecución de la migración 001 y trabajo del Sprint 1. |
| Pruebas (independiente) | Proyecto anterior | Reservado para pruebas independientes. **No fue modificado.** |

No se almacenan, incluyen ni referencian claves, URLs con credenciales, tokens ni
`service_role` en este documento ni en el repositorio. La identidad del proyecto
se verifica en el Dashboard de Supabase, no por SQL.

## Preparación (antes de ejecutar)

La migración se diseñó, revisó y corrigió en tres iteraciones antes de su
ejecución, y quedó versionada en el commit **`86d430b`**
(`feat(database): add initial versioned PigTec schema migration`).

Artefactos (sin cambios posteriores):

- `database/migrations/001_initial_schema.sql` — migración inicial.
- `database/migrations/README.md` — convención, inventario, diferencias
  intencionales, reservas y estrategia de verificación.

Correcciones aprobadas e incorporadas antes de ejecutar:

1. Vista `v_animals_current` con **`security_invoker = true`** (PostgreSQL 15+).
2. **Privilegios de la vista**: `REVOKE ALL` a `anon` y `PUBLIC`; el acceso de
   `authenticated` queda gobernado por la RLS de las tablas base.
3. **Comprobación previa** de base vacía con `pg_class`/`pg_namespace`, sin
   restringir `relkind` para las siete tablas y la vista; exime a los objetos
   internos de Supabase.
4. **Índice de aretes normalizado**: `lower(btrim(ear_tag_code))`, único y
   parcial, para valores no vacíos.
5. **CHECK de `animals.origin`** con los cuatro valores canónicos
   (`born_on_farm`, `purchased`, `transferred_in`, `unknown`); **NULL permitido**
   (origen no registrado, distinto del valor explícito `unknown`).
6. **Sin `CREATE EXTENSION`**: se evita operar sobre extensiones administradas
   por Supabase; `gen_random_uuid()` es del núcleo de PostgreSQL 13+.

La migración va dentro de `BEGIN; … COMMIT;` y no crea datos, usuarios ni objetos
de Supabase Auth (solo **referencia** `auth.users(id)`).

## Ejecución

- Método: ejecución **manual** del script en el SQL Editor de PigTecBD, previa
  verificación del proyecto en el Dashboard.
- Resultado reportado: **"Success. No rows returned"** (sin errores).
- No se crearon usuarios ni datos reales durante el procedimiento.
- El proyecto Supabase anterior no fue modificado.

## Verificaciones de ESTRUCTURA (realizadas)

Confirmadas por el usuario tras la ejecución:

| Verificación | Resultado |
|---|---|
| Proyecto de desarrollo | PigTecBD |
| Versión del motor | PostgreSQL **17.11** |
| Esquema de Auth | `auth.users` disponible |
| Ejecución | "Success. No rows returned" |
| Tablas | 7 creadas: `profiles`, `areas`, `pens`, `animals`, `litters`, `animal_movements`, `health_events` |
| Vista | `v_animals_current` creada |
| `security_invoker` en la vista | `true` |
| Triggers | 8 registrados |
| RLS | habilitado (`true`) en las 7 tablas |
| Políticas RLS | única: `profile_select_own` (SELECT, rol `authenticated`, en `profiles`) |
| Registros | 0 registros estimados en las tablas (sin datos) |

Estas verificaciones acreditan que la **estructura** se creó según lo previsto.
No sustituyen a las pruebas funcionales.

## Pruebas FUNCIONALES (NO realizadas)

Siguen pendientes y **no deben darse por hechas**:

1. **Datos sintéticos y flujo de animales.** No se ha insertado ningún registro,
   por lo que no se ha ejercitado ningún camino de datos.
2. **`apply_animal_movement`.** No se ha probado que un movimiento actualice
   `current_pen_id`, ni el caso `sale` (→ `sold`) ni `transfer` sin destino
   (→ `transferred_out`).
3. **`apply_mortality_event`.** No se ha probado que un evento `mortality`
   marque el animal como `dead` y fije `exit_date`.
4. **`v_animals_current`.** No se ha comprobado que devuelva filas con
   `current_pen_code`/`current_area_name` correctos ni que aplique la RLS de las
   tablas base.
5. **Índice de aretes.** No se ha comprobado la unicidad insensible a caja y a
   espacios externos con valores reales.
6. **CHECK de `origin`.** No se ha comprobado el rechazo de valores no canónicos
   ni la admisión de NULL.
7. **`set_updated_at`.** No se ha comprobado la actualización automática de
   `updated_at` en cada tabla.
8. **Comportamiento RLS operativo.** No hay políticas operativas; no se ha
   probado el acceso permitido/denegado por rol sobre tablas operativas.
9. **Conexión del backend a PigTecBD.** `GET /auth/profile` no se ha ejecutado
   contra datos reales; sigue sin aprovisionamiento de perfiles.
10. **Concurrencia y transacciones.** No se han probado aprobaciones simultáneas
    ni la atomicidad de futuras operaciones de negocio.

## Índice de objetos creados (referencia)

Recuento documentado en `database/migrations/README.md`: 6 tipos ENUM, 7 tablas,
15 claves foráneas, 11 CHECK, 4 UNIQUE, 7 PK, 15 índices, 3 funciones, 8 triggers,
1 vista y 1 política. La verificación de estructura confirma la creación de las
tablas, la vista, los 8 triggers, RLS en 7 tablas y la política única.

## Limitaciones y riesgos que continúan

- **Aprovisionamiento de perfiles inexistente:** `profiles.role` por defecto es
  `viewer`; sin un alta controlada, `GET /auth/profile` responderá 403.
  → reservado a la migración 002.
- **RLS operativo sin políticas:** las tablas operativas y la vista devuelven 0
  filas a `authenticated` hasta el diseño de RLS. → migración 003.
- **Funciones de movimientos/mortalidad sin endurecer** (coherencia de estado,
  bloqueo tras salida, `search_path`, idempotencia). → migración 005.
- **`set_updated_at` sin `search_path` fijo.** → reservado.
- **`health_events.documented_by` es `TEXT`** (posible FK a `profiles`). →
  a evaluar.
- **Generación de `animal_code` (`PIG-000001`)** y tabla
  `animal_registration_requests` aún no existen. → migración 006.
- **Ninguna prueba funcional ni end-to-end** contra PigTecBD (ver sección
  anterior).

## Migraciones reservadas (no iniciadas)

| Migración | Contenido |
|---|---|
| 002 | Aprovisionamiento de perfiles (rol explícito). |
| 003 | Políticas RLS operativas + privilegios de columna. |
| 004 | Revisión adicional de la vista y de `set_updated_at`. |
| 005 | Endurecimiento de `apply_animal_movement` / `apply_mortality_event`. |
| 006 | `animal_registration_requests` + generación de `animal_code`. |

## Pendientes para S6-C (o siguiente fase)

1. **Aprovisionamiento de perfiles** en desarrollo: decidir trigger en
   `auth.users` o flujo administrado, con asignación explícita de rol (evitar
   `viewer`), y probarlo con al menos un usuario de prueba **sintético y
   claramente identificado como tal**.
2. **Diseño de RLS operativas** por rol y por acción, y ajuste definitivo de los
   privilegios de la vista.
3. **Pruebas funcionales** de los triggers `apply_*`, la vista, el índice de
   aretes y el CHECK de origen, con datos sintéticos y en un `BEGIN; … ROLLBACK;`
   o entorno de prueba.
4. **Conectar el backend a PigTecBD** (solo `anon` + JWT del usuario) para
   validar `GET /auth/profile` contra perfiles reales de prueba.
5. Definir la **auditoría mínima** y la estructura de solicitudes de alta
   (migración 006).

## Versionado

| Elemento | Commit |
|---|---|
| Migración 001 + README | `86d430b` — `feat(database): add initial versioned PigTec schema migration` |

Documento creado en un commit de documentación separado.

**Fuente:** resultados de ejecución y estructura reportados por el usuario; no
reejecutados ni verificados de forma independiente desde OpenCode.
