import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

/**
 * Subconjunto de la configuracion validada (ver `parseEnv`) que necesita el
 * cliente de Supabase. Se tipa de forma estrecha para dejar claro que la
 * fabrica nunca recibe claves administrativas.
 */
export type SupabaseEnv = Pick<Env, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>;

export interface SupabaseClientOptions {
  /**
   * JWT del usuario autenticado.
   *
   * Si se proporciona, todas las peticiones a Supabase lo envian como
   * `Authorization: Bearer <jwt>`, de modo que PostgreSQL aplique RLS con la
   * identidad de ese usuario.
   *
   * Si se omite, el cliente queda como anonimo: PostgREST recibe la `anon key`
   * como Bearer y RLS se evalua con el rol `anon`. Las tablas operativas no
   * deben conceder acceso a ese rol (ver especificacion maestra, seccion 8).
   */
  accessToken?: string;
}

/**
 * Crea un cliente de Supabase para el backend.
 *
 * Decisiones de seguridad:
 * - Solo se usa la `anon key` publica (header `apikey`). Nunca `service_role`
 *   ni claves administrativas.
 * - Se crea un cliente NUEVO en cada llamada. No existe un cliente global
 *   compartido cuyo token pueda cambiar entre peticiones de distintos usuarios.
 * - Cuando hay JWT, se inyecta con la opcion `accessToken` de supabase-js, que
 *   lo aplica como `Authorization: Bearer` y desactiva la gestion de sesion
 *   (`signIn`, `setSession`, refresco automatico). Asi ninguna peticion puede
 *   heredar el token de otra.
 *
 * La URL y la clave provienen de la configuracion validada (`parseEnv`), por lo
 * que la fabrica confia en que ya cumplen las reglas de `env.ts`.
 */
export function createSupabaseClient(
  env: SupabaseEnv,
  options: SupabaseClientOptions = {},
): SupabaseClient {
  const accessToken = options.accessToken?.trim();

  // Un token vacio casi siempre es un error de programacion. Fallar rapido
  // evita caer en silencio al rol `anon` (RLS con una identidad equivocada).
  if (options.accessToken !== undefined && !accessToken) {
    throw new Error(
      'Se recibio un accessToken vacio: no se puede crear un cliente con identidad de usuario.',
    );
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    // Entorno de servidor: sin persistencia ni sesion automatica.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    // Solo se define `accessToken` cuando hay JWT de usuario. El token se
    // resuelve por peticion, pero es inmutable dentro de este cliente.
    ...(accessToken ? { accessToken: async () => accessToken } : {}),
  });
}
