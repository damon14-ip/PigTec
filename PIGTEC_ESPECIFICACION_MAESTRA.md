# PigTec — Especificación maestra del proyecto

**Versión:** 0.1 (línea base de requisitos)  
**Fecha:** 15 de octubre de 2026  
**Proyecto:** PigTec — gestión y trazabilidad porcina para la granja KolkaPig  
**Contexto:** desarrollo de prototipo para FERCYT de la UNAMBA  
**Estado:** decisiones funcionales aprobadas; implementación y migraciones pendientes.

> **Regla de interpretación:** este documento describe el sistema objetivo. No implica que sus funciones ya estén programadas. El esquema SQL inicial existente es una línea base, no la versión definitiva de la base de datos. Si hay discrepancias, documentarlas y proponer migración; no alterar la base sin autorización.

## 1. Propósito y alcance

PigTec permitirá registrar e identificar porcinos, ubicarlos por área y corral, mantener historial de movimientos y eventos sanitarios, gestionar camadas y consultar información operativa. Un flujo de solicitudes supervisará el alta de animales realizada por trabajadores. El MVP es **exclusivamente para KolkaPig**; no se implementará soporte multi-granja ni tabla `farms`.

### Alcance inicial (MVP)

1. Inicio de sesión, perfiles, roles y autorización.
2. Gestión de áreas y corrales.
3. Inventario oficial de animales y búsqueda por código PigTec o arete.
4. Solicitud de registro de animales por trabajadores, revisión y aprobación/rechazo por encargados.
5. Historial de movimientos y cambios de ubicación.
6. Historial sanitario con eventos tipificados.
7. Camadas y asociación de lechones en registros de nacimiento.
8. Consultas y reportes básicos de inventario, estado, área y corral.
9. Auditoría mínima de aprobaciones y operaciones sensibles.

**Fuera del MVP inicial:** multi-granja, pagos, gestión compleja de insumos, sensores físicos, automatización predictiva, IA que modifique datos, aplicaciones móviles nativas. Un asistente de IA de consulta, si se incorpora, será posterior y de **solo lectura**.

### Módulo "Reportes y análisis" (alcance aprobado)

- **Excel integral (`.xlsx`)**: libro con hojas separadas para resumen, porcinos, movimientos, camadas, sanidad, áreas y corrales, y estadísticas, según los datos realmente disponibles.
- **Documentos PDF**: modernizan **moderadamente** los formatos originales de KolkaPig, conservando su identidad documental, los códigos `KPG-RG` cuando correspondan, los nombres de campos, la organización familiar y la finalidad operativa. La prioridad es que un trabajador acostumbrado a los formatos anteriores reconozca y utilice los nuevos sin dificultad.
- Se distinguen los **PDF operativos** de los **informes gerenciales**.
- Los reportes **respetan permisos y filtros**; no inventan información ni exportan datos no autorizados.
- El **dashboard** usa gráficos con datos reales: estados de porcinos, ocupación de corrales y movimientos por periodo; posteriormente, indicadores reproductivos y sanitarios.
- **Fuera del alcance actual:** inventarios de alimentos, medicamentos y suministros (formatos de referencia `KPG-RG-09` y `KPG-RG-10`).

## 2. Entorno y tecnologías

| Capa | Tecnología / decisión |
|---|---|
| Desarrollo | Windows; Antigravity IDE; OpenCode ejecutado en CMD independiente |
| Control de versiones | Git; crear commits pequeños y verificables |
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + TypeScript + Fastify |
| Validación de entradas | Zod (propuesto para la implementación) |
| API | REST con respuestas y errores consistentes |
| Base de datos | PostgreSQL en Supabase |
| Autenticación | Supabase Auth; backend verifica la identidad del usuario |
| Seguridad | Autorización por rol en backend y RLS de PostgreSQL como defensa adicional |
| Pruebas | Pruebas unitarias, integración, permisos, flujos críticos y concurrencia |
| Despliegue | Pendiente de elección; no contratar servicios ni desplegar sin autorización |

**Ruta local del usuario:** `C:\Users\ACER\Desktop\UNAMBA\Fercyt\VET\PigTec`.  
**Estructura existente prevista:** `backend/`, `frontend/`, `database/migrations/`, `database/seeds/`, `docs/arquitectura/`, `docs/requisitos/`, `scripts/`, `tests/`, `AGENTS.md`, `README.md`, `PorciControl_BD_inicial.txt`. Verificar la estructura real antes de modificarla; no reorganizarla sin aprobación.

## 3. Arquitectura

```text
Navegador (React + TypeScript)
          |
          | HTTPS / API REST + token de sesión
          v
Backend (Fastify + TypeScript)
  - verifica autenticación
  - aplica permisos por operación
  - valida solicitudes y datos
  - ejecuta operaciones transaccionales
          |
          | conexión con identidad del usuario cuando corresponda
          v
Supabase: PostgreSQL + Auth + RLS
```

- El frontend **nunca** contiene claves `service_role` ni secretos del servidor.
- Las operaciones normales deben respetar RLS con identidad autenticada. Las operaciones privilegiadas, si son imprescindibles, deben aislarse y comprobar permisos explícitamente.
- La lógica crítica de aprobación debe ser **atómica** y resistente a solicitudes simultáneas; evaluar función SQL/RPC transaccional con permisos restringidos o una transacción backend apropiada, sin conceder acceso privilegiado general.
- Una política de RLS no sustituye la validación de campos ni la autorización por operación. RLS controla filas; permisos por columna, funciones o validaciones de backend protegen campos y acciones.
- Evaluar la vista `v_animals_current`: las vistas pueden ejecutar con privilegios de su propietario. Configurar acceso seguro (por ejemplo, `security_invoker` cuando sea compatible) o consultar tablas protegidas; probar que no evade RLS.

## 4. Identificación de animales

### 4.1 Identificadores

- `animals.id`: UUID interno técnico, clave primaria; nunca depende de un código visible.
- `animals.animal_code`: código visible **PigTec**, obligatorio, único, permanente e inmutable una vez creado. Se genera al aprobar un alta o al crear un animal directamente con autorización.
- **Formato generado propuesto y aprobado para el MVP:** `PIG-000001`, `PIG-000002`, etc. Usar secuencia/control transaccional de base de datos; no calcular con `MAX()+1`. Los saltos numéricos por operaciones fallidas son aceptables.
- Máximo de 100 caracteres para compatibilidad futura; el código generado normalmente será mucho más corto. No permitir vacío ni solo espacios.
- `animals.ear_tag_code`: código físico complementario, **opcional**; puede coincidir con el código PigTec. Admitir letras, números y caracteres especiales habituales, hasta 100 caracteres; recortar espacios externos y convertir vacío en NULL. Su unicidad debe ignorar diferencias de mayúsculas/minúsculas después de normalizar. Revisar índice existente antes de cambiarlo.
- Buscar animales por ambos códigos. Cambiar un arete no altera `animal_code`; registrar cambios de arete en auditoría cuando se implemente.

### 4.2 Origen

Valores canónicos para `origin`:

| Valor almacenado | Significado mostrado |
|---|---|
| `born_on_farm` | Nacido en KolkaPig |
| `purchased` | Comprado |
| `transferred_in` | Recibido por transferencia |
| `unknown` | Origen desconocido |

La interfaz usa etiquetas en español; la API y la base usan valores estables en inglés. Validar lista permitida en backend y reforzarla mediante restricción de base de datos después de verificar datos existentes. Evitar inventar orígenes.

### 4.3 Camadas

- `animals.litter_id` es opcional para compras, transferencias e históricos con información desconocida.
- En el **flujo de nuevo nacimiento registrado por PigTec**, registrar la camada y asociar los lechones; la interfaz debe facilitar madre → camada → crías.
- No imponer por ahora una restricción global `born_on_farm => litter_id NOT NULL`, porque podría impedir conservar históricos incompletos.
- No inventar genealogía ni camadas reales. Los datos sintéticos de pruebas se etiquetan como tales.

## 5. Roles y permisos

**Roles funcionales del MVP:**

| Rol | Función |
|---|---|
| `admin` | Administración técnica, usuarios, roles, configuración y acciones autorizadas |
| `manager` | Dueño/encargado: supervisión, aprobaciones y gestión operativa |
| `operator` | Trabajador: captura de solicitudes y operaciones cotidianas permitidas |
| `veterinarian` | Consulta de animales y registro de información sanitaria |

El rol `viewer` **no se utilizará funcionalmente**. Sin embargo, existe en el enum inicial y es el valor por defecto de `profiles.role`: no borrarlo de forma improvisada. Migrar cuidadosamente el alta de usuarios para asignación controlada de roles; ningún usuario debe autoconcederse privilegios.

### 5.1 Matriz inicial de acciones

| Acción | Admin | Manager | Operator | Veterinarian |
|---|---|---|---|---|
| Ver inventario, áreas, corrales | Sí | Sí | Sí | Sí |
| Administrar usuarios y roles | Sí | No | No | No |
| Crear/modificar áreas y corrales | Sí | Sí | No | No |
| Enviar solicitud de alta animal | Sí | Sí | Sí | No |
| Aprobar/rechazar altas de animales | Sí | Sí | No | No |
| Alta oficial directa (sin solicitud) | Sí | Sí | No | No |
| Editar datos generales de animales | Sí | Sí | Solo campos operativos expresamente permitidos; pendiente de precisar | No |
| Registrar movimientos internos | Sí | Sí | Sí, motivos autorizados | Aislamiento sanitario autorizado |
| Autorizar venta/transferencia externa | Sí | Sí | No | No |
| Registrar observaciones/síntomas | Sí | Sí | Sí | Sí |
| Registrar diagnósticos/tratamientos/vacunas | Según política clínica definida | Según política clínica definida | No | Sí |
| Registrar mortalidad | Sí, con validación | Sí, con validación | No | Sí, con validación |
| Consultar solicitudes | Todas | Todas | Solo propias | No por defecto |
| Consultar reportes | Sí | Sí | Según necesidad operativa | Según necesidad clínica |

**Principio de menor privilegio:** la facultad clínica no se infiere del rol de administrador o manager. Las operaciones clínicas especializadas deben restringirse o justificarse en reglas explícitas antes de implementarlas. El detalle de edición de campos por operator queda **pendiente de definición técnica**.

### 5.2 Borrado y correcciones

- No ofrecer DELETE físico para `animals`, `litters`, `animal_movements` ni `health_events` en el MVP.
- Conservar historial de venta, muerte y salida cambiando estado, no borrando animales.
- Los movimientos y eventos sanitarios se tratan como historial: corregir mediante operaciones auditables, no reescribir silenciosamente registros anteriores.
- Restringir cambios directos de `animals.current_pen_id`, `status`, `exit_date`; deben derivarse de operaciones autorizadas y coherentes con el historial.

## 6. Solicitudes de alta y aprobación (regla aprobada)

**Objetivo:** permitir captura de datos por trabajadores sin incorporar animales al inventario oficial hasta aprobación.

### 6.1 Flujo

1. `operator` completa formulario y envía solicitud.
2. Backend valida el contenido y guarda la solicitud en `animal_registration_requests` con estado `pending`. **No** crea todavía un registro en `animals`.
3. `manager` o `admin` consulta la cola de pendientes.
4. Puede aprobar o rechazar. Si rechaza, debe indicar motivo.
5. Al aprobar, el backend vuelve a validar datos, bloquea/protege la solicitud contra aprobaciones concurrentes, genera `animal_code`, crea el animal y cambia la solicitud a `approved` con referencia al animal creado. Todo debe quedar confirmado o revertido como una única operación.
6. La solicitud conserva responsable, fecha y decisión. El trabajador puede consultar sus solicitudes.
7. Para corregir un rechazo, permitir una **nueva versión o reenvío trazable**; no sobrescribir la decisión anterior sin historial.

### 6.2 Estados

- `pending`: pendiente de revisión.
- `approved`: aprobada y vinculada a animal oficial.
- `rejected`: rechazada, con motivo.

Reglas: no aprobar dos veces, no aprobar una solicitud propia, no permitir que el solicitante cambie su rol para aprobarse a sí mismo; comprobar `submitted_by != reviewed_by` incluso si cambian los roles. El manager/admin también puede realizar alta directa, siempre auditada.

### 6.3 Nueva tabla propuesta (todavía NO creada)

`animal_registration_requests`:

| Columna | Finalidad |
|---|---|
| `id` | UUID PK |
| `submitted_by` | FK a `profiles` |
| `payload` | JSONB con propuesta de datos, validada y versionada |
| `status` | pending / approved / rejected |
| `submitted_at` | Fecha de envío |
| `reviewed_by` | FK a `profiles`, nullable |
| `reviewed_at` | Fecha de decisión, nullable |
| `review_notes` | Justificación u observación |
| `animal_id` | FK a `animals`, nullable, único cuando se aprueba |

Revisar constraints: coherencia de estado y columnas de decisión, idempotencia, permisos de acceso, índices por estado/fecha/solicitante. No permitir que el operador modifique `status`, `reviewed_by`, `reviewed_at` o `animal_id` por API ni por RLS. Una política de filas por sí sola no protege esas columnas: aplicar operaciones especializadas y privilegios adecuados.

## 7. Modelo de datos existente

**Fuente de verdad del esquema inicial:** `PorciControl_BD_inicial.txt`, PostgreSQL/Supabase v0.1. Tablas actuales:

- `profiles`: usuarios, rol y estado.
- `areas`: zonas de la granja.
- `pens`: corrales asociados a áreas.
- `animals`: inventario, parentesco, origen, camada, corral y estado.
- `litters`: camadas y conteos de nacimiento.
- `animal_movements`: movimientos y motivos.
- `health_events`: historial sanitario.

Vista: `v_animals_current`. Funciones/triggers iniciales: actualización de timestamps, aplicación de movimiento y mortalidad. RLS habilitado en las siete tablas; el SQL inicial solo crea la política `profile_select_own` para `profiles`. **No hay todavía políticas operativas completas.**

Riesgos que requieren pruebas antes de uso: consistencia de movimientos con estados finales; concurrencia; fechas; cambios de corral; mortalidad; permisos efectivos de vista; integridad de parentesco; datos incompletos.

## 8. Seguridad y Supabase

- El usuario mostró un proyecto Supabase identificado tentativamente como `hvyvlmgtzpgbxbfecjhj`, con rama `main` etiquetada `PRODUCTION`. El identificador debe verificarse desde el panel; no incluir secretos ni URLs con credenciales en el repositorio.
- Aunque se presuma que contiene solo el esquema inicial, **no asumir que está vacío**: comprobar tablas, conteos, políticas, Auth y extensiones mediante consultas de solo lectura.
- Trabajar preferentemente en un **proyecto o entorno de desarrollo separado**. No aplicar migraciones sobre la rama marcada PRODUCTION sin revisión, respaldo y aprobación explícita.
- Para operaciones normales, backend debe validar JWT y usar un contexto de base de datos que haga aplicar RLS según la identidad del usuario. Evitar usar `service_role` como conexión universal.
- Políticas RLS deben comprobar rol **y** `is_active`. Una función auxiliar `SECURITY DEFINER` para consultar el rol puede evitar recursión en `profiles`, pero debe tener propietario, `search_path`, permisos EXECUTE y comportamiento revisados y probados. No copiar SQL de ejemplo sin validarlo.
- No dar acceso anónimo a tablas operativas.
- Configurar creación de perfiles/alta de usuarios bajo control administrativo; evitar autoasignación de `manager` o `admin`.
- Secrets solo en variables de entorno del servidor, nunca en Git ni en el navegador.

## 9. Reglas de integridad y auditoría

- Validación de datos en API (Zod) y constraints esenciales en PostgreSQL.
- Las transiciones de estado deben impedir movimientos ordinarios posteriores a venta, muerte o transferencia externa, salvo un proceso de corrección autorizado y auditable.
- Mantener historial de movimientos y eventos sanitarios con usuario y fecha.
- Validar permisos por **acción**, no solo por tabla.
- Aprobar solicitudes mediante una operación atómica e idempotente; probar concurrencia.
- Mantener timestamps en UTC en almacenamiento y mostrar hora local en interfaz cuando corresponda.
- Registrar auditoría de aprobaciones, rechazos, cambios de rol, salidas y correcciones importantes. Diseño de tabla de auditoría pendiente.

## 10. Datos de prueba y documentación FERCYT

- Se permite **crear datos sintéticos** para acelerar desarrollo, pruebas, capturas y demostraciones.
- Marcar los datos de demostración como simulados; no mezclarlos con datos reales ni presentarlos como registros reales de KolkaPig.
- En el artículo científico diferenciar explícitamente: prototipo desarrollado, pruebas con datos sintéticos, validación real efectivamente realizada y limitaciones.
- No afirmar adopción, efectividad o mejoras cuantificadas en la granja sin evidencia empírica.

## 11. Plan de implementación por etapas

### Etapa 0 — Preparación (siguiente)

- Guardar este documento en la raíz y revisarlo con `AGENTS.md`.
- Confirmar inventario de Supabase con operaciones de solo lectura.
- Preparar entorno de desarrollo separado y respaldo del esquema existente.
- Crear primer commit de línea base cuando se revisen archivos y secretos.
- Planificar migraciones incrementales, reversión y pruebas; no ejecutar sin aprobación.

### Etapa 1 — Base técnica

- Estructurar backend Fastify y frontend React/Vite respetando carpetas existentes.
- Configurar variables de entorno de ejemplo sin secretos.
- Implementar autenticación, perfiles, autorización y políticas RLS verificadas.
- Pruebas de acceso permitido/denegado para los cuatro roles.

### Etapa 2 — Inventario supervisado

- Catálogos de áreas/corrales.
- Listado y detalle de animales.
- Generación segura de `animal_code`.
- Solicitudes de alta, bandeja de manager, aprobar/rechazar, trazabilidad.
- Pruebas de solicitudes duplicadas y concurrencia.

### Etapa 3 — Operaciones

- Movimientos internos, ventas/transferencias autorizadas y controles de estado.
- Historial sanitario y mortalidad.
- Camadas y registro de nacimientos.

### Etapa 4 — Calidad y entrega

- Búsquedas, filtros, reportes básicos y auditoría.
- Pruebas de integración, seguridad, errores y usabilidad.
- Manual de uso, guía de despliegue, evidencias de pruebas y documentación FERCYT.

## 12. Reglas para OpenCode y colaboración

1. Leer `AGENTS.md`, este documento y los archivos afectados **antes de modificar**.
2. Proponer plan breve, archivos a crear/modificar y riesgos; pedir aprobación para cambios estructurales, migraciones o acciones sobre Supabase.
3. Ejecutar tareas pequeñas y comprobables. No crear funcionalidades no solicitadas ni cambiar stack sin autorización.
4. No ejecutar SQL en PRODUCTION, no borrar tablas/datos y no compartir secretos.
5. Diferenciar claramente **hecho verificado**, **propuesta** y **pendiente**.
6. Al terminar una tarea, reportar archivos modificados, comandos ejecutados, pruebas y próximos pasos.
7. Mantener este documento sincronizado cuando una decisión se apruebe o cambie.

## 13. Decisiones aún pendientes antes de implementarlas

- Confirmar entorno Supabase de desarrollo y estado real del proyecto existente.
- Precisar los campos de `animals` que puede editar `operator` después de aprobación.
- Precisar quién puede registrar eventos clínicos específicos fuera del rol veterinario.
- Diseñar políticas RLS concretas, privilegios de columnas y mecanismo transaccional de aprobación.
- Definir estructura de auditoría y procedimiento de corrección de solicitudes rechazadas.
- Elegir herramientas de pruebas, hosting y estrategia de despliegue.
- Verificar cómo se crearán cuentas/perfiles sin depender del `viewer` predeterminado.

## 14. Registro de decisiones

| ID | Decisión | Estado |
|---|---|---|
| D-01 | Una sola granja: KolkaPig | Aprobada |
| D-02 | Dos códigos: PigTec interno + arete opcional | Aprobada |
| D-03 | Código PigTec generado, único e inmutable; secuencia y formato `PIG-000001` | Aprobada como criterio de diseño |
| D-04 | Orígenes controlados (4 valores) | Aprobada |
| D-05 | Camada obligatoria en flujo de nuevo nacimiento; opcional en históricos/externos | Aprobada |
| D-06 | Cuatro roles funcionales; dueño/encargado = manager; sin viewer funcional | Aprobada |
| D-07 | Operador solicita alta; manager/admin aprueba; no se autoaprueba | Aprobada |
| D-08 | Backend + RLS con identidad del usuario; no exponer service_role | Aprobada como arquitectura objetivo |
| D-09 | No eliminar historial de animales, movimientos, camadas ni sanidad | Aprobada |
| D-10 | Datos sintéticos permitidos para pruebas, claramente identificados | Aprobada |
| D-11 | Migraciones solo tras respaldo, pruebas y autorización | Aprobada |
| D-12 | Módulo "Reportes y análisis": Excel integral y documentos PDF que modernizan los formatos KolkaPig conservando identidad, códigos KPG-RG y nombres de campos | Aprobada |
| D-13 | Separar PDF operativos de informes gerenciales | Aprobada |
| D-14 | Dashboard y reportes con datos reales; respetan permisos y filtros y no inventan información | Aprobada |
| D-15 | Inventarios de alimentos, medicamentos y suministros fuera del alcance actual | Aprobada |

---

**Siguiente hito autorizado:** planificación y preparación local. **No se ha autorizado** ejecutar migraciones ni modificar el proyecto Supabase marcado como producción.
