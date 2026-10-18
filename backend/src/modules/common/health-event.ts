/**
 * Valores del enum `public.health_event_type` (esquema inicial, seccion 10) y
 * clasificacion de los tipos de evento segun su naturaleza.
 *
 * Se replican aqui para validar entradas y normalizar filas devueltas por la
 * base. Cualquier valor fuera de esta lista se rechaza: no se inventan tipos de
 * evento ni reglas no documentadas.
 */

/** Enum `public.health_event_type`. */
export const HEALTH_EVENT_TYPES = [
  'observation',
  'symptom_report',
  'documented_diagnosis',
  'treatment',
  'vaccination',
  'deworming',
  'mortality',
  'recovery',
  'other',
] as const;
export type HealthEventType = (typeof HEALTH_EVENT_TYPES)[number];

export function isHealthEventType(value: unknown): value is HealthEventType {
  return (
    typeof value === 'string' &&
    (HEALTH_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Eventos de observacion/captura cotidiana: los registra cualquier rol
 * operativo. La especificacion maestra (5.1) concede "Registrar
 * observaciones/sintomas" a admin, manager, operator y veterinarian. `other`
 * se agrupa aqui por ser un evento generico sin facultad clinica implicita.
 */
export const OBSERVATION_EVENT_TYPES = [
  'observation',
  'symptom_report',
  'other',
] as const;

/**
 * Eventos clinicos especializados (diagnostico, tratamiento, vacunacion,
 * desparasitacion y recuperacion).
 *
 * La facultad clinica NO se infiere de `admin`/`manager` (principio de menor
 * privilegio, 5.1). Hoy solo el `veterinarian` los registra; la incorporacion de
 * admin/manager queda pendiente de la "politica clinica" que el proyecto debe
 * definir (5.1 y 13). `recovery` se agrupa con los clinicos: es el resultado de
 * un tratamiento ya aplicado.
 */
export const CLINICAL_EVENT_TYPES = [
  'documented_diagnosis',
  'treatment',
  'vaccination',
  'deworming',
  'recovery',
] as const;

/** Evento de mortalidad: deriva el estado del porcino (trigger de la base). */
export const MORTALITY_EVENT_TYPE = 'mortality' as const;

/**
 * Estados de `public.animals` que admiten NUEVOS eventos sanitarios.
 *
 * Se alinea con los movimientos (migracion 005): un porcino vendido, muerto,
 * transferido al exterior o dado de baja no admite operaciones con historial
 * (especificacion 5.2 y 9). `missing` si admite eventos (p. ej. hallazgo o
 * recuperacion posterior).
 */
export const HEALTH_EVENT_COMPATIBLE_ANIMAL_STATUSES = [
  'active',
  'missing',
] as const;
