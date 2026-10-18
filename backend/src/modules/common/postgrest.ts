/**
 * Subconjunto minimo del cliente PostgREST (supabase-js) que necesitan los
 * repositorios de datos operativos.
 *
 * Se tipa de forma estrecha, igual que el repositorio de perfiles, para poder
 * inyectarlo y probarlo sin red. En tiempo de ejecucion el cliente real de
 * `createSupabaseClient` satisface esta interfaz (misma cadena encadenable y
 * "thenable"); el cast documentado en `server.ts` aisla el limite de tipos de
 * supabase-js.
 */

export interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

/** Resultado devuelto por una consulta PostgREST. */
export interface PostgrestResult<T> {
  data: T | null;
  error: PostgrestErrorLike | null;
  /**
   * Numero total de filas que cumplen el filtro, cuando la consulta lo pide con
   * `select(columnas, { count: 'exact', head: true })`. `null`/ausente en el
   * resto de consultas. Permite contar sin descargar las filas.
   */
  count?: number | null;
}

/**
 * Opciones de `select`. `count`/`head` permiten pedir solo el conteo exacto de
 * filas que cumplen el filtro, sin traerlas: ideal para resumenes agregados.
 */
export interface PostgrestSelectOptions {
  count?: 'exact';
  head?: boolean;
}

/**
 * Constructor de consulta encadenable. Al esperarlo devuelve un arreglo de
 * filas; `single`/`maybeSingle` devuelven una sola fila.
 */
export interface PostgrestQuery<T> extends PromiseLike<PostgrestResult<T[]>> {
  select(columns?: string, options?: PostgrestSelectOptions): PostgrestQuery<T>;
  insert(values: Record<string, unknown>): PostgrestQuery<T>;
  update(values: Record<string, unknown>): PostgrestQuery<T>;
  eq(column: string, value: unknown): PostgrestQuery<T>;
  /** Comparaciones de rango (p. ej. filtros de fecha en movimientos). */
  gte(column: string, value: unknown): PostgrestQuery<T>;
  lte(column: string, value: unknown): PostgrestQuery<T>;
  /** Filtro logico OR de PostgREST (p. ej. busqueda por codigo o arete). */
  or(filter: string): PostgrestQuery<T>;
  order(column: string, options?: { ascending?: boolean }): PostgrestQuery<T>;
  limit(count: number): PostgrestQuery<T>;
  /** Paginacion por posicion (equivale al encabezado Range de PostgREST). */
  range(from: number, to: number): PostgrestQuery<T>;
  maybeSingle(): PromiseLike<PostgrestResult<T>>;
  single(): PromiseLike<PostgrestResult<T>>;
}

export interface PostgrestClient {
  from<T = Record<string, unknown>>(table: string): PostgrestQuery<T>;
}

/**
 * Fabrica de clientes por peticion. Recibe el JWT verificado del usuario para
 * que PostgREST evalue RLS con su identidad, igual que en los perfiles.
 */
export type PostgrestClientFactory = (accessToken: string) => PostgrestClient;

/** Extrae el SQLSTATE del error de PostgREST, si existe. */
export function postgrestErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }

  return null;
}
