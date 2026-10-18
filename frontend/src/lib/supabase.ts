import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from '../config/env';

/**
 * Cliente unico de Supabase Auth para el frontend.
 *
 * Usa exclusivamente la clave publica `anon` (protegida por RLS). El frontend
 * nunca debe manejar la clave `service_role`.
 *
 * Se crea de forma perezosa para que un error de configuracion se muestre en la
 * pantalla de inicio de sesion y no bloquee el arranque de la aplicacion.
 */
let client: SupabaseClient | null = null;

/** Devuelve (creando si hace falta) el cliente de Supabase Auth. */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const env = readEnv();
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No se usan enlaces magicos ni redirecciones con token en la URL.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Reinicia el cliente (solo para pruebas). */
export function resetSupabaseClient(): void {
  client = null;
}
