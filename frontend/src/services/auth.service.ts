import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { ApiError, type ApiClient } from '../lib/http';
import { isOperationalRole, type OperationalRole } from '../config/roles';

/**
 * Perfil autorizado devuelto por `GET /auth/profile`.
 *
 * Refleja EXACTAMENTE el contrato del backend: `{ id, role, is_active }`. No se
 * anaden campos que la API no devuelve.
 */
export interface AuthorizedProfile {
  id: string;
  role: OperationalRole;
  is_active: boolean;
}

/** Error de autenticacion con mensaje apto para mostrar al usuario. */
export class AuthError extends Error {
  override readonly name = 'AuthError';
}

/** Indica por que motivo se bloqueo el acceso tras iniciar sesion. */
export type AccessBlockReason =
  /** La cuenta existe y se autentico, pero no tiene un perfil operativo activo. */
  | 'no-operational-role'
  /** Falta la sesion o el token ya no es valido. */
  | 'unauthenticated';

/** Resultado de intentar resolver el perfil autorizado de una sesion. */
export type ProfileResolution =
  | { status: 'authorized'; profile: AuthorizedProfile }
  | { status: 'blocked'; reason: AccessBlockReason }
  | { status: 'unavailable' };

/** Traduce los errores de Supabase Auth a mensajes en espanol. */
function mapLoginError(error: { message?: string; status?: number }): string {
  const message = error.message ?? '';
  const status = error.status;

  if (status === 429) {
    return 'Demasiados intentos de inicio de sesion. Espera unos minutos.';
  }
  if (/invalid login credentials/i.test(message)) {
    return 'Correo o contrasena incorrectos.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'La cuenta aun no ha sido confirmada. Contacta al administrador.';
  }
  return 'No se pudo iniciar sesion. Verifica tus datos e intenta de nuevo.';
}

/**
 * Inicia sesion contra Supabase Auth con correo y contrasena.
 *
 * Este es el UNICO punto de inicio de sesion de la aplicacion: no se habilita
 * registro publico, recuperacion de contrasena ni ningun otro flujo de alta.
 */
export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<Session> {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new AuthError(mapLoginError(error));
  }
  if (!data.session) {
    throw new AuthError(
      'No se pudo iniciar sesion. Verifica tus datos e intenta de nuevo.',
    );
  }

  return data.session;
}

/** Cierra la sesion local y revoca el token en Supabase Auth. */
export async function signOutCurrentUser(): Promise<void> {
  await getSupabaseClient().auth.signOut();
}

/** Devuelve la sesion persistida actual, si existe. */
export async function getStoredSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    return null;
  }
  return data.session;
}

/**
 * Suscribe un observador a los cambios de sesion de Supabase Auth.
 * Devuelve una funcion para cancelar la suscripcion.
 */
export function subscribeToAuthChanges(
  onSession: (session: Session | null) => void,
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(
    (_event, session) => {
      onSession(session);
    },
  );

  return () => {
    data.subscription.unsubscribe();
  };
}

/**
 * Obtiene el perfil autorizado desde `GET /auth/profile`.
 *
 * El backend exige JWT valido (`401`) y perfil con rol operativo y activo
 * (`403`). Un `403` NUNCA se confunde con un fallo de red:
 * - `404`/`403` → bloqueado (sin rol operativo o perfil inactivo),
 * - `401` → sesion no valida,
 * - cualquier otro fallo → `unavailable` (no se asume autorizado).
 */
export async function fetchAuthorizedProfile(
  client: ApiClient,
): Promise<ProfileResolution> {
  let response: unknown;
  try {
    response = await client.get<unknown>('/auth/profile');
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return { status: 'blocked', reason: 'unauthenticated' };
      }
      if (error.status === 403) {
        return { status: 'blocked', reason: 'no-operational-role' };
      }
    }
    return { status: 'unavailable' };
  }

  if (!isAuthorizedProfile(response)) {
    // Respuesta con forma inesperada: fail-closed, nunca se concede acceso.
    return { status: 'blocked', reason: 'no-operational-role' };
  }

  if (!response.is_active || !isOperationalRole(response.role)) {
    return { status: 'blocked', reason: 'no-operational-role' };
  }

  return { status: 'authorized', profile: response };
}

/** Comprueba que una respuesta desconocida tiene la forma del perfil. */
function isAuthorizedProfile(value: unknown): value is AuthorizedProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.role === 'string' &&
    typeof candidate.is_active === 'boolean'
  );
}
