import { buildApp } from './app.js';
import { loadDotEnv, parseEnv, type Env } from './config/env.js';
import { parseAllowedOrigins } from './config/cors.js';
import { createSupabaseTokenVerifier } from './modules/auth/token-verifier.js';
import {
  createSupabaseProfileRepository,
  type SupabaseProfileClient,
} from './modules/auth/profile-repository.js';
import { createSupabaseAreaRepository } from './modules/areas/areas.repository.js';
import { createSupabasePenRepository } from './modules/pens/pens.repository.js';
import { createSupabaseAnimalRepository } from './modules/animals/animals.repository.js';
import { createSupabaseMovementRepository } from './modules/movements/movements.repository.js';
import { createSupabaseLitterRepository } from './modules/litters/litters.repository.js';
import { createSupabaseHealthEventRepository } from './modules/health/health-events.repository.js';
import { createSupabaseDashboardRepository } from './modules/dashboard/dashboard.repository.js';
import { createSupabaseReportsRepository } from './modules/reports/reports.repository.js';
import { createSupabaseReportsExportRepository } from './modules/reports/export/export.repository.js';
import {
  DEFAULT_DAILY_REQUEST_LIMIT,
  readAssistantConfig,
} from './modules/assistant/assistant.config.js';
import {
  createRejectingAssistantProvider,
} from './modules/assistant/assistant.provider.js';
import { createGroqProvider } from './modules/assistant/groq.provider.js';
import { createInMemoryAssistantQuota } from './modules/assistant/assistant.quota.js';
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

// Origenes permitidos para CORS: lista blanca validada (sin comodin `*`). El
// frontend de desarrollo usa http://127.0.0.1:5173; en produccion debe fijarse
// `CORS_ALLOWED_ORIGINS` con el origen real del frontend.
const corsAllowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

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
const animalRepository = createSupabaseAnimalRepository(dataClient);
const movementRepository = createSupabaseMovementRepository(dataClient);
const litterRepository = createSupabaseLitterRepository(dataClient);
const healthEventRepository = createSupabaseHealthEventRepository(dataClient);
// Read model agregado del dashboard: mismo criterio (un cliente por solicitud
// con el JWT verificado; RLS aplicada por PostgreSQL; nunca `service_role`).
const dashboardRepository = createSupabaseDashboardRepository(dataClient);
// Read model agregado de reportes: mismo criterio (un cliente por solicitud con
// el JWT verificado; RLS aplicada por PostgreSQL; nunca `service_role`).
const reportsRepository = createSupabaseReportsRepository(dataClient);
// Repositorio de lectura DETALLADO para las exportaciones (Excel/PDF): mismo
// criterio (un cliente por solicitud con el JWT verificado; RLS; nunca
// `service_role`). Solo lectura, paginado y acotado.
const reportsExportRepository = createSupabaseReportsExportRepository(dataClient);

// Asistente IA (Groq). La clave y el modelo se leen EXCLUSIVAMENTE del entorno
// (`readAssistantConfig`); si faltan, el asistente queda deshabilitado y se usa
// un proveedor fail-closed que responde 502 sin llamar a ningun servicio. La
// configuracion NUNCA se registra (contiene la clave).
const assistantConfig = readAssistantConfig(process.env);
const assistantProvider = assistantConfig
  ? createGroqProvider({
      apiKey: assistantConfig.apiKey,
      model: assistantConfig.model,
      timeoutMs: assistantConfig.timeoutMs,
    })
  : createRejectingAssistantProvider();
const assistantQuota = createInMemoryAssistantQuota({
  limit: assistantConfig?.dailyRequestLimit ?? DEFAULT_DAILY_REQUEST_LIMIT,
});

const app = buildApp({
  tokenVerifier,
  profileRepository,
  areaRepository,
  penRepository,
  animalRepository,
  movementRepository,
  litterRepository,
  healthEventRepository,
  dashboardRepository,
  reportsRepository,
  reportsExportRepository,
  assistantProvider,
  assistantQuota,
  corsAllowedOrigins,
});

// Aviso saneado (solo nombres de variables, sin valores) si el asistente no
// tiene configuracion suficiente para funcionar.
if (!assistantConfig) {
  app.log.warn(
    'Asistente IA deshabilitado: faltan GROQ_API_KEY o GROQ_MODEL en el entorno.',
  );
}

// Los origenes permitidos no son secretos; se registran para diagnostico.
app.log.info(
  `CORS: origenes permitidos -> ${corsAllowedOrigins.join(', ')}`,
);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
