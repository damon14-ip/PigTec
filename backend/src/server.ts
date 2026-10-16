import { buildApp } from './app.js';
import { loadDotEnv, parseEnv, type Env } from './config/env.js';
import { createSupabaseTokenVerifier } from './modules/auth/token-verifier.js';
import { createSupabaseClient } from './supabase/client.js';

/**
 * Carga las variables de entorno y las valida.
 * Si la configuracion es invalida, imprime un mensaje saneado (sin valores)
 * y detiene el proceso antes de iniciar el servidor.
 */
function loadEnvOrExit(): Env {
  try {
    return parseEnv();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Configuracion de entorno invalida';
    console.error(message);
    process.exit(1);
  }
}

loadDotEnv();

const env = loadEnvOrExit();

// Cliente de verificacion: anon, SIN `accessToken`, independiente de los
// clientes por usuario. Crear el cliente no abre conexiones; la validacion del
// JWT ocurre solo al atender `GET /auth/me`.
const tokenVerifier = createSupabaseTokenVerifier(createSupabaseClient(env));

const app = buildApp({ tokenVerifier });

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
