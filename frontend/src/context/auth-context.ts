import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { ApiClient } from '../lib/http';
import type { AuthorizedProfile } from '../services/auth.service';

/**
 * Estado de la sesion:
 * - `loading`: comprobando la sesion o el perfil,
 * - `unauthenticated`: sin sesion valida (la pantalla de acceso es visible),
 * - `authenticated`: sesion valida con perfil operativo activo,
 * - `error`: no se pudo verificar el perfil (fallo de red o del servidor).
 */
export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  /** Sesion de Supabase Auth (contiene el JWT que se envia al backend). */
  session: Session | null;
  /** Perfil autorizado devuelto por `GET /auth/profile`. */
  profile: AuthorizedProfile | null;
  /** Correo del usuario autenticado (unico dato de identidad disponible). */
  email: string | null;
  /** JWT de acceso, o `null` si no hay sesion. */
  accessToken: string | null;
  /** Cliente HTTP con el JWT de la sesion ya integrado. */
  apiClient: ApiClient;
  /** Aviso mostrado en la pantalla de acceso (p. ej. sesion expirada). */
  notice: string | null;
  /** Mensaje de error de verificacion de perfil. */
  error: string | null;
  /** Inicia sesion; lanza `AuthError` si el acceso se bloquea. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Cierra la sesion. */
  signOut: () => Promise<void>;
  /** Reintenta verificar el perfil cuando el estado es `error`. */
  retry: () => Promise<void>;
}

/**
 * Contexto de autenticacion. Se exporta para poder proporcionar valores en
 * pruebas sin depender de Supabase ni de la red.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

/** Acceso al contexto de autenticacion. Falla si se usa fuera del proveedor. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.');
  }
  return value;
}
