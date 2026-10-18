import { postgrestErrorCode } from './postgrest.js';

/**
 * Errores de dominio de los modulos de datos operativos.
 *
 * Se traducen a HTTP en la capa de rutas (`sendDomainError`). Los mensajes son
 * genericos a proposito: nunca incluyen detalles internos de la base.
 */

/** El recurso no existe (o no es visible por RLS). */
export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} no encontrado`);
    this.name = 'NotFoundError';
  }
}

/** Conflicto de unicidad (p. ej. nombre de area o (area_id, code) repetidos). */
export class ConflictError extends Error {
  constructor(message = 'conflicto de unicidad') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** La fila referencia una entidad inexistente (violacion de clave foranea). */
export class ForeignKeyError extends Error {
  constructor(message = 'referencia inexistente') {
    super(message);
    this.name = 'ForeignKeyError';
  }
}

/** Fallo de infraestructura o acceso no disponible. */
export class DataAccessError extends Error {
  constructor() {
    super('No se pudo completar la operacion de datos');
    this.name = 'DataAccessError';
  }
}

/**
 * Traduce el SQLSTATE de PostgREST a un error de dominio.
 *
 * - `23505` unique_violation        -> ConflictError (409)
 * - `23503` foreign_key_violation   -> ForeignKeyError (422)
 * - cualquier otro (red, RLS, etc.) -> DataAccessError (503)
 */
export function toDataError(error: unknown): Error {
  const code = postgrestErrorCode(error);

  if (code === '23505') {
    return new ConflictError();
  }
  if (code === '23503') {
    return new ForeignKeyError();
  }

  return new DataAccessError();
}
