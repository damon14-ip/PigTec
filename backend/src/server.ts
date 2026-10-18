import { buildApp } from './app.js';
import { loadDotEnv, parseEnv, type Env } from './config/env.js';
import { createSupabaseTokenVerifier } from './modules/auth/token-verifier.js';
import {
  createSupabaseProfileRepository,
  type SupabaseProfileClient,
} from './modules/auth/profile-repository.js';
import { createSupabaseAreaRepository } from './modules/areas/areas.repository.js';
import { createSupabasePenRepository } from './modules/pens/pens.repository.js';
import type { PostgrestClient } from './modules/common/postgrest.js';
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

// Repositorio de perfiles: se crea un cliente NUEVO por solicitud con el JWT
// verificado de esa solicitud (RLS con identidad del usuario). Nunca se usa
// `service_role` ni se comparte un JWT mutable entre peticiones.
//
// El cast a `SupabaseProfileClient` aisla el limite de tipos: supabase-js expone
// genericos muy profundos que TypeScript no compara estructuralmente, pero en
// tiempo de ejecucion la cadena from().select().eq().maybeSingle() es la misma.
const profileRepository = createSupabaseProfileRepository((accessToken) =>
  createSupabaseClient(env, { accessToken }) as unknown as SupabaseProfileClient,
);

// Repositorios de datos operativos (areas y corrales): mismo criterio que los
// perfiles, un cliente NUEVO por solicitud con el JWT verificado (RLS con la
// identidad del usuario). Nunca se usa `service_role`.
const dataClient = (accessToken: string): PostgrestClient =>
  createSupabaseClient(env, { accessToken }) as unknown as PostgrestClient;

const areaRepository = createSupabaseAreaRepository(dataClient);
const penRepository = createSupabasePenRepository(dataClient);

const app = buildApp({
  tokenVerifier,
  profileRepository,
  areaRepository,
  penRepository,
});

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
