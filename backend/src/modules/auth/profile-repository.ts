import { isRole, type Role } from './roles.js';

/**
 * Perfil minimo necesario para autorizar.
 *
 * Contiene SOLO datos de identidad y permiso leidos de la base. Nunca se
 * construye a partir del cuerpo, encabezados o parametros de la peticion.
 */
export interface UserProfile {
  id: string;
  role: Role;
  isActive: boolean;
}

/**
 * Acceso de solo lectura a `profiles`.
 *
 * `findProfileById` recibe el id verificado y el JWT de la peticion. La
 * implementacion real crea un cliente Supabase por peticion con ese JWT, de modo
 * que PostgreSQL aplica RLS (`profile_select_own`) con la identidad del usuario.
 *
 * La interfaz es intencionadamente estrecha para poder inyectarla y probarla sin
 * conexion real (inyeccion de dependencias).
 */
export interface ProfileRepository {
  findProfileById(
    userId: string,
    accessToken: string,
  ): Promise<UserProfile | null>;
}

/**
 * Error controlado de infraestructura al consultar perfiles.
 *
 * Se lanza cuando Supabase no responde o devuelve un error, es decir, cuando NO
 * se puede comprobar el perfil (distinto de "no existe perfil"). El mensaje es
 * generico a proposito: nunca incluye credenciales, tokens ni el detalle
 * original de Supabase. La capa de autorizacion lo traduce a HTTP 503.
 */
export class ProfileLookupError extends Error {
  constructor() {
    super('No se pudo comprobar el perfil del usuario');
    this.name = 'ProfileLookupError';
  }
}

/** Fila cruda tal como la devuelve PostgREST para `profiles`. */
export interface SupabaseProfileRow {
  id: string;
  role: string;
  is_active: boolean;
}

/**
 * Subconjunto minimo del cliente Supabase que necesita el repositorio. Se tipa
 * de forma estrecha para poder probarlo con un doble sencillo, sin red.
 */
export interface SupabaseProfileQuery {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      maybeSingle(): PromiseLike<{
        data: SupabaseProfileRow | null;
        error: unknown;
      }>;
    };
  };
}

export interface SupabaseProfileClient {
  from(table: string): SupabaseProfileQuery;
}

/**
 * Fabrica de clientes por peticion. Recibe el JWT del usuario para que la
 * consulta se realice con su identidad (RLS) y no con un cliente compartido.
 */
export type SupabaseProfileClientFactory = (
  accessToken: string,
) => SupabaseProfileClient;

/** Columnas estrictamente necesarias para autorizar. */
const PROFILE_COLUMNS = 'id, role, is_active';

/**
 * Repositorio de perfiles basado en Supabase.
 *
 * Distingue de forma explicita:
 * - `null`: la consulta fue correcta pero no hay perfil accesible (RLS sin
 *   acceso o fila inexistente). La autorizacion lo trata como 403.
 * - `ProfileLookupError`: no se pudo completar la consulta (error de Supabase o
 *   fallo de red). La autorizacion lo trata como 503, nunca como 403, para no
 *   confundir "sin perfil" con "no se pudo comprobar".
 *
 * Las filas con datos no utilizables (rol desconocido, `is_active` no booleano o
 * id distinto al solicitado) se consideran "sin perfil" (`null`): fail-closed.
 */
export function createSupabaseProfileRepository(
  createClient: SupabaseProfileClientFactory,
): ProfileRepository {
  return {
    async findProfileById(
      userId: string,
      accessToken: string,
    ): Promise<UserProfile | null> {
      const client = createClient(accessToken);

      let result: { data: SupabaseProfileRow | null; error: unknown };

      try {
        result = await client
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', userId)
          .maybeSingle();
      } catch {
        // No se propaga el error original (podria contener detalles internos).
        throw new ProfileLookupError();
      }

      if (result.error) {
        throw new ProfileLookupError();
      }

      const data = result.data;
      if (!data) {
        return null;
      }

      // Refuerzo defensivo: la respuesta debe corresponder al usuario pedido y
      // traer un rol y estado validos. Si no, se deniega (sin perfil).
      if (
        data.id !== userId ||
        typeof data.is_active !== 'boolean' ||
        !isRole(data.role)
      ) {
        return null;
      }

      return { id: data.id, role: data.role, isActive: data.is_active };
    },
  };
}
