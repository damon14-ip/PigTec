/**
 * Identidad autenticada minima expuesta por el backend.
 * No incluye roles ni permisos: el RBAC corresponde a una etapa posterior.
 */
export interface AuthenticatedUser {
  id: string;
  email?: string;
}

/**
 * Verificador de tokens de acceso.
 *
 * Se define como interfaz para inyectarlo (inyeccion de dependencias) y poder
 * probar la capa de autenticacion con mocks, sin solicitudes de red.
 *
 * Contrato: `verify` resuelve la identidad si el token es valido y lanza un
 * error si falta, es invalido o ha expirado.
 */
export interface TokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedUser>;
}

/**
 * Forma minima del cliente de Supabase que necesita el verificador. Se tipa de
 * forma estrecha para documentar la dependencia real y facilitar los mocks.
 */
export interface SupabaseAuthReader {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
}

/**
 * Mensaje generico de rechazo. Deliberadamente no revela el motivo real
 * (token ausente, invalido, expirado o respuesta no valida de Supabase) ni
 * ningun dato del token.
 */
const INVALID_TOKEN_MESSAGE = 'Token de acceso invalido o expirado';

/** Caracteres de control (incluye NUL, saltos de linea y DEL). */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function createInvalidTokenError(): Error {
  return new Error(INVALID_TOKEN_MESSAGE);
}

/**
 * Verificador basado en Supabase Auth.
 *
 * `getUser(jwt)` envia el token a Supabase Auth, que valida su firma y
 * expiracion (no se limita a decodificarlo). El cliente recibido debe ser un
 * cliente de verificacion dedicado (anon, SIN `accessToken`), independiente de
 * los clientes por usuario de `createSupabaseClient`.
 */
export function createSupabaseTokenVerifier(
  client: SupabaseAuthReader,
): TokenVerifier {
  return {
    async verify(accessToken: string): Promise<AuthenticatedUser> {
      const { data, error } = await client.auth.getUser(accessToken);
      const user = data?.user;

      if (error || !user) {
        // No se propaga el detalle de Supabase (puede ser sensible).
        throw createInvalidTokenError();
      }

      // Un `id` ausente, vacio o con espacios/caracteres de control es una
      // respuesta no valida de Supabase Auth: se trata como no autenticado.
      const id =
        typeof user.id === 'string' && !CONTROL_CHARACTERS.test(user.id)
          ? user.id.trim()
          : '';

      if (!id || /\s/.test(id)) {
        throw createInvalidTokenError();
      }

      return user.email ? { id, email: user.email } : { id };
    },
  };
}

/**
 * Verificador por defecto: rechaza todos los tokens (fail-closed).
 *
 * Evita que un backend sin verificar cableado acepte peticiones como
 * autenticadas. `server.ts` debe inyectar el verificador real.
 */
export function createRejectingTokenVerifier(): TokenVerifier {
  return {
    async verify(): Promise<AuthenticatedUser> {
      throw new Error('Verificador de tokens no configurado');
    },
  };
}
