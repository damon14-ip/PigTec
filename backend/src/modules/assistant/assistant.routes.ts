import type { FastifyInstance, FastifyReply } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { isOperationalRole, OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import type { AnimalRepository } from '../animals/animals.repository.js';
import type { MovementRepository } from '../movements/movements.repository.js';
import type { PenRepository } from '../pens/pens.repository.js';
import {
  AssistantProviderError,
  type AssistantProvider,
} from './assistant.provider.js';
import type { AssistantQuota } from './assistant.quota.js';
import { chatRequestSchema } from './assistant.schemas.js';
import { createAssistantService } from './assistant.service.js';
import {
  formatLookup,
  formatMovements,
  formatSummary,
  recognizeDataQuery,
} from './assistant.data-answers.js';
import {
  AssistantToolError,
  createAssistantTools,
} from './assistant.tools.js';

export interface AssistantRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  provider: AssistantProvider;
  quota: AssistantQuota;
  /**
   * Repositorios de SOLO LECTURA que respaldan las herramientas de datos del
   * asistente. Se reutilizan los repositorios existentes (mismas columnas y
   * reglas RLS con el JWT del usuario). Nunca se usan para escribir.
   */
  animalRepository: AnimalRepository;
  movementRepository: MovementRepository;
  penRepository: PenRepository;
}

/**
 * Traduce un fallo del proveedor a una respuesta HTTP generica.
 *
 * Nunca se reenvia el cuerpo ni el mensaje original del proveedor: solo una
 * categoria estable y no sensible.
 */
function sendAssistantError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AssistantProviderError) {
    if (error.kind === 'rate_limited') {
      return reply.code(429).send({ error: 'ai_rate_limited' });
    }
    if (error.kind === 'timeout') {
      return reply.code(504).send({ error: 'ai_timeout' });
    }
    if (error.kind === 'invalid_response') {
      return reply.code(502).send({ error: 'ai_invalid_response' });
    }
  }

  // Cualquier otro fallo (proveedor no disponible o error inesperado) se trata
  // como puerta de enlace caida, sin detalles internos.
  return reply.code(502).send({ error: 'ai_unavailable' });
}

/**
 * Traduce un fallo de una herramienta de datos a una respuesta HTTP controlada.
 *
 * - Parametros invalidos -> 400 (nunca se inventa una respuesta).
 * - Sin autorizacion -> 403.
 * - Fallo de datos (Supabase) o inesperado -> 503. NUNCA se convierte en un
 *   texto inventado: un error de consulta no es una respuesta del asistente.
 */
function sendDataError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AssistantToolError) {
    if (error.kind === 'invalid_input') {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    if (error.kind === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden' });
    }
  }

  return reply.code(503).send({ error: 'service_unavailable' });
}

/**
 * Rutas del asistente IA (modulo S5-0: manual inteligente, respuestas locales y
 * consultas de datos de solo lectura).
 *
 * `POST /assistant/chat` (orden garantizado):
 * 1. Exige JWT valido (`authenticate`) y un perfil ACTIVO con rol operativo
 *    (`admin`, `manager`, `operator` o `veterinarian`). `viewer` y usuarios
 *    inactivos reciben 403.
 * 2. Valida el cuerpo de forma estricta.
 * 3. Intenta una RESPUESTA LOCAL determinista (base de conocimiento propia).
 *    Si existe, responde con `source: "local"`, `usage: null` y SIN descontar
 *    cuota diaria.
 * 4. Intenta una CONSULTA DE DATOS determinista (herramientas de solo lectura).
 *    Si se reconoce, ejecuta la herramienta autorizada con el JWT del usuario y
 *    responde con `source: "data"`, `usage: null` y SIN descontar cuota. Un
 *    parametro invalido responde 400 y un fallo de datos responde 503, sin
 *    inventar cifras ni registros.
 * 5. Si no hay respuesta local ni consulta de datos, reserva cupo ANTES de
 *    llamar al proveedor y responde con `source: "groq"` y el `usage` informado.
 *
 * Las peticiones rechazadas por autenticacion o validacion NO gastan cuota. Las
 * herramientas de datos son de SOLO LECTURA: no ejecutan SQL generado, no
 * acceden a Supabase desde el proveedor y no modifican registros.
 */
export async function assistantRoutes(
  app: FastifyInstance,
  options: AssistantRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRole = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const service = createAssistantService(options.provider);
  const tools = createAssistantTools({
    animalRepository: options.animalRepository,
    movementRepository: options.movementRepository,
    penRepository: options.penRepository,
  });

  app.post(
    '/assistant/chat',
    { preHandler: [authenticate, requireRole] },
    async (request, reply) => {
      const parsed = chatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      // 1. Respuesta local: determinista, sin costo ni consumo de cuota. Se
      //    comprueba despues de validar y antes de reservar cupo. Una pregunta
      //    ambigua o desconocida devuelve `null` y continua hacia el proveedor.
      const localReply = service.findLocalAnswer(parsed.data.message);
      if (localReply !== null) {
        return reply.send({
          reply: localReply,
          usage: null,
          source: 'local',
          quotaRemaining: options.quota.remaining(),
        });
      }

      // 2. Consulta de datos: reconocimiento determinista de patrones claros.
      //    Tambien sin costo ni cuota: los datos se leen por herramientas
      //    autorizadas y no se envia nada al proveedor.
      const dataQuery = recognizeDataQuery(parsed.data.message);
      if (dataQuery !== null) {
        if (dataQuery.kind === 'invalid') {
          // Falta el codigo o su formato no es PIG-XXXXXX: no se consulta y no
          // se inventa. La ruta responde 400 sin gastar cuota.
          return reply.code(400).send({ error: 'invalid_params' });
        }

        const accessToken = request.authToken;
        const profile = request.authProfile;
        // `requireRole` ya garantiza identidad y perfil; se comprueba de nuevo
        // de forma defensiva para no propagar un rol no operativo.
        if (!accessToken || !profile || !isOperationalRole(profile.role)) {
          return reply.code(403).send({ error: 'forbidden' });
        }

        const context = {
          accessToken,
          actor: { role: profile.role },
        };

        try {
          const replyText =
            dataQuery.kind === 'summary'
              ? formatSummary(await tools.summary(context))
              : dataQuery.kind === 'lookup'
                ? formatLookup(await tools.lookup(dataQuery.code, context))
                : formatMovements(
                    await tools.movements(dataQuery.code, context),
                  );

          return reply.send({
            reply: replyText,
            usage: null,
            source: 'data',
            quotaRemaining: options.quota.remaining(),
          });
        } catch (error) {
          return sendDataError(reply, error);
        }
      }

      // 3. Reserva sincrona ANTES de llamar al proveedor: dos peticiones
      //    concurrentes no pueden superar el limite diario. El cupo consumido no
      //    se libera despues (ni por fallo del proveedor), para no permitir bucles.
      if (!options.quota.reserve()) {
        return reply.code(429).send({ error: 'ai_quota_exceeded' });
      }

      try {
        const completion = await service.ask(parsed.data.message);

        return reply.send({
          reply: completion.reply,
          usage: completion.usage,
          source: 'groq',
          quotaRemaining: options.quota.remaining(),
        });
      } catch (error) {
        return sendAssistantError(reply, error);
      }
    },
  );
}
