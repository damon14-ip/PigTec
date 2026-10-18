import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AppEnv } from '../config/env';
import { createApiClient } from '../lib/http';
import {
  fetchAuthorizedProfile,
  getStoredSession,
  signInWithEmailPassword,
  signOutCurrentUser,
  subscribeToAuthChanges,
  AuthError,
  type AuthorizedProfile,
} from '../services/auth.service';
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from './auth-context';

/** Mensaje mostrado cuando la cuenta no tiene rol operativo activo. */
const NO_ROLE_NOTICE =
  'Tu cuenta no tiene un rol operativo activo en PigTec. Solicita al administrador que revise tu perfil.';

/** Mensaje mostrado cuando la sesion ya no es valida. */
const INVALID_SESSION_NOTICE =
  'La sesion no es valida o ha expirado. Vuelve a iniciar sesion.';

/** Mensaje mostrado cuando no se pudo verificar el perfil. */
const PROFILE_ERROR_NOTICE =
  'No se pudo verificar tu perfil con el servidor. Comprueba tu conexion e intenta de nuevo.';

export interface AuthProviderProps {
  env: AppEnv;
  children: ReactNode;
}

/**
 * Proveedor unico de autenticacion y autorizacion del frontend.
 *
 * Concentra TODA la logica de sesion (no se duplica en componentes):
 * 1. recupera la sesion persistida de Supabase Auth,
 * 2. obtiene el perfil autorizado desde `GET /auth/profile`,
 * 3. bloquea cuentas sin rol operativo o inactivas (cierra su sesion),
 * 4. expone un cliente HTTP que ya adjunta el JWT y detecta el 401,
 * 5. sincroniza la sesion con los eventos de Supabase Auth.
 *
 * No habilita registro publico: el unico flujo de alta de sesion es
 * `signIn`, que usa correo y contrasena existentes.
 */
export function AuthProvider({ env, children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthorizedProfile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  // Usuario cuya sesion ya se esta resolviendo o se ha resuelto: evita que los
  // eventos de Supabase Auth repitan la verificacion del perfil.
  const resolvedUserIdRef = useRef<string | null>(null);

  const clearSessionState = useCallback(() => {
    sessionRef.current = null;
    resolvedUserIdRef.current = null;
    setSession(null);
    setProfile(null);
    setStatus('unauthenticated');
  }, []);

  const apiClient = useMemo(
    () =>
      createApiClient({
        baseUrl: env.apiBaseUrl,
        getAccessToken: () => sessionRef.current?.access_token ?? null,
        onUnauthorized: () => {
          clearSessionState();
          setNotice('La sesion ha expirado. Vuelve a iniciar sesion.');
        },
      }),
    [env.apiBaseUrl, clearSessionState],
  );

  const resolveProfile = useCallback(
    async (current: Session) => {
      sessionRef.current = current;
      resolvedUserIdRef.current = current.user.id;
      setSession(current);
      setStatus('loading');
      setError(null);

      const result = await fetchAuthorizedProfile(apiClient);

      if (result.status === 'authorized') {
        setProfile(result.profile);
        setNotice(null);
        setStatus('authenticated');
        return;
      }

      if (result.status === 'blocked') {
        // Bloqueo: se cierra la sesion de Supabase para que el usuario no quede
        // con una sesion a medias sin acceso a la aplicacion.
        await signOutCurrentUser().catch(() => undefined);
        sessionRef.current = null;
        resolvedUserIdRef.current = null;
        setSession(null);
        setProfile(null);
        setNotice(
          result.reason === 'no-operational-role'
            ? NO_ROLE_NOTICE
            : INVALID_SESSION_NOTICE,
        );
        setStatus('unauthenticated');
        return;
      }

      setStatus('error');
      setError(PROFILE_ERROR_NOTICE);
    },
    [apiClient],
  );

  // Arranque: recupera la sesion persistida y la sincroniza con Supabase Auth.
  useEffect(() => {
    let active = true;

    void (async () => {
      const current = await getStoredSession();
      if (!active) {
        return;
      }
      if (!current) {
        setStatus('unauthenticated');
        return;
      }
      await resolveProfile(current);
    })();

    const unsubscribe = subscribeToAuthChanges((next) => {
      if (!active) {
        return;
      }

      if (!next) {
        // Cierre de sesion (propio o remoto): no se conservan datos del perfil.
        if (resolvedUserIdRef.current !== null) {
          clearSessionState();
        }
        return;
      }

      if (next.user.id === resolvedUserIdRef.current) {
        // Misma sesion (p. ej. token renovado): solo se actualiza el token.
        sessionRef.current = next;
        setSession(next);
        return;
      }

      void resolveProfile(next);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [resolveProfile, clearSessionState]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setNotice(null);
      setError(null);

      const current = await signInWithEmailPassword(email, password);
      sessionRef.current = current;
      resolvedUserIdRef.current = current.user.id;
      setSession(current);

      const result = await fetchAuthorizedProfile(apiClient);

      if (result.status === 'authorized') {
        setProfile(result.profile);
        setStatus('authenticated');
        return;
      }

      if (result.status === 'blocked') {
        await signOutCurrentUser().catch(() => undefined);
        sessionRef.current = null;
        resolvedUserIdRef.current = null;
        setSession(null);
        setProfile(null);
        setStatus('unauthenticated');
        throw new AuthError(
          result.reason === 'no-operational-role'
            ? NO_ROLE_NOTICE
            : INVALID_SESSION_NOTICE,
        );
      }

      // Perfil no verificable: no se concede acceso, pero la sesion de Supabase
      // se conserva para poder reintentar.
      setStatus('error');
      throw new AuthError(PROFILE_ERROR_NOTICE);
    },
    [apiClient],
  );

  const signOut = useCallback(async () => {
    await signOutCurrentUser().catch(() => undefined);
    clearSessionState();
    setNotice(null);
    setError(null);
  }, [clearSessionState]);

  const retry = useCallback(async () => {
    const current = await getStoredSession();
    if (!current) {
      setStatus('unauthenticated');
      return;
    }
    await resolveProfile(current);
  }, [resolveProfile]);

  const value: AuthContextValue = useMemo(
    () => ({
      status,
      session,
      profile,
      email: session?.user.email ?? null,
      accessToken: session?.access_token ?? null,
      apiClient,
      notice,
      error,
      signIn,
      signOut,
      retry,
    }),
    [status, session, profile, apiClient, notice, error, signIn, signOut, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
