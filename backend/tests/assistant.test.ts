import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  type ProfileRepository,
  type UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';
import {
  AssistantProviderError,
  type AssistantCompletion,
  type AssistantMessage,
  type AssistantProvider,
} from '../src/modules/assistant/assistant.provider.js';
import {
  createInMemoryAssistantQuota,
  type AssistantQuota,
} from '../src/modules/assistant/assistant.quota.js';
import { MAX_MESSAGE_LENGTH } from '../src/modules/assistant/assistant.schemas.js';
import { PIGTEC_SYSTEM_PROMPT } from '../src/modules/assistant/assistant.prompt.js';

/** Token falso -> identidad verificada. */
const USERS: Record<string, AuthenticatedUser> = {
  'jwt-admin': { id: 'u-admin' },
  'jwt-manager': { id: 'u-manager' },
  'jwt-operator': { id: 'u-operator' },
  'jwt-vet': { id: 'u-vet' },
  'jwt-viewer': { id: 'u-viewer' },
  'jwt-inactive': { id: 'u-inactive' },
};

/** Perfiles tal como los devolveria `profiles`. */
const PROFILES: Record<string, UserProfile> = {
  'u-admin': { id: 'u-admin', role: 'admin', isActive: true },
  'u-manager': { id: 'u-manager', role: 'manager', isActive: true },
  'u-operator': { id: 'u-operator', role: 'operator', isActive: true },
  'u-vet': { id: 'u-vet', role: 'veterinarian', isActive: true },
  'u-viewer': { id: 'u-viewer', role: 'viewer', isActive: true },
  'u-inactive': { id: 'u-inactive', role: 'manager', isActive: false },
};

const COMPLETION: AssistantCompletion = {
  reply: 'Para registrar un porcino, abre el modulo de animales.',
  usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
};

function createVerifier(): TokenVerifier {
  return {
    verify: vi.fn(async (token: string): Promise<AuthenticatedUser> => {
      const user = USERS[token];
      if (!user) {
        throw new Error('invalid token');
      }
      return user;
    }),
  };
}

function createProfileRepository(): ProfileRepository {
  return {
    findProfileById: vi.fn(async (userId: string) => PROFILES[userId] ?? null),
  };
}

/** Proveedor con espia accesible para comprobar el numero de llamadas. */
function spyProvider(
  impl: (messages: readonly AssistantMessage[]) => Promise<AssistantCompletion>,
): { provider: AssistantProvider; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(impl);
  return { provider: { complete } as AssistantProvider, complete };
}

function buildChatApp(
  options: { provider?: AssistantProvider; quota?: AssistantQuota } = {},
) {
  const provider =
    options.provider ??
    spyProvider(async () => COMPLETION).provider;
  const quota = options.quota ?? createInMemoryAssistantQuota({ limit: 20 });

  const app = buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    assistantProvider: provider,
    assistantQuota: quota,
  });

  return { app, provider, quota };
}

function callChat(
  app: ReturnType<typeof buildApp>,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method: 'POST',
    url: '/assistant/chat',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
}

describe('assistant: autenticacion y acceso', () => {
  it('POST /assistant/chat sin token -> 401', async () => {
    const { app } = buildChatApp();
    expect((await callChat(app, undefined, { message: 'Hola' })).statusCode).toBe(
      401,
    );
  });

  it('POST /assistant/chat con token invalido -> 401', async () => {
    const { app } = buildChatApp();
    expect(
      (await callChat(app, 'jwt-desconocido', { message: 'Hola' })).statusCode,
    ).toBe(401);
  });

  it('viewer -> 403 (sin acceso por ahora)', async () => {
    const { app } = buildChatApp();
    expect(
      (await callChat(app, 'jwt-viewer', { message: 'Hola' })).statusCode,
    ).toBe(403);
  });

  it('usuario inactivo -> 403', async () => {
    const { app } = buildChatApp();
    expect(
      (await callChat(app, 'jwt-inactive', { message: 'Hola' })).statusCode,
    ).toBe(403);
  });

  it.each(['jwt-admin', 'jwt-manager', 'jwt-operator', 'jwt-vet'])(
    '%s -> 200 con respuesta del asistente',
    async (token) => {
      const { app } = buildChatApp();
      const response = await callChat(app, token, { message: 'Como registro un porcino?' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        reply: COMPLETION.reply,
        usage: COMPLETION.usage,
        source: 'groq',
        quotaRemaining: 19,
      });
    },
  );

  it('rechazos de autenticacion/acceso no consumen cupo ni llaman al proveedor', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp({ provider, quota });

    expect((await callChat(app)).statusCode).toBe(401);
    expect((await callChat(app, 'jwt-viewer', { message: 'Hola' })).statusCode).toBe(403);
    expect((await callChat(app, 'jwt-inactive', { message: 'Hola' })).statusCode).toBe(403);

    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(1);

    // El cupo intacto permite la peticion valida siguiente.
    expect((await callChat(app, 'jwt-operator', { message: 'Hola' })).statusCode).toBe(200);
  });
});

describe('assistant: validacion de entrada', () => {
  const cases: Array<[string, unknown]> = [
    ['cuerpo vacio (sin message)', {}],
    ['message vacio', { message: '' }],
    ['message de solo espacios', { message: '   ' }],
    ['message no string', { message: 123 }],
    ['message excesivo', { message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }],
    ['propiedad inesperada', { message: 'Hola', model: 'otro-modelo' }],
    ['propiedad inesperada (role)', { message: 'Hola', role: 'system' }],
  ];

  it.each(cases)('%s -> 400', async (_label, payload) => {
    const { app } = buildChatApp();
    expect((await callChat(app, 'jwt-operator', payload)).statusCode).toBe(400);
  });

  it('un mensaje dentro del limite -> 200', async () => {
    const { app } = buildChatApp();
    const response = await callChat(app, 'jwt-operator', {
      message: 'a'.repeat(MAX_MESSAGE_LENGTH),
    });
    expect(response.statusCode).toBe(200);
  });

  it('cuerpo invalido no consume cupo ni llama al proveedor', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp({ provider, quota });

    expect((await callChat(app, 'jwt-operator', {})).statusCode).toBe(400);
    expect((await callChat(app, 'jwt-operator', { message: '   ' })).statusCode).toBe(400);

    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(1);

    expect((await callChat(app, 'jwt-operator', { message: 'Hola' })).statusCode).toBe(200);
  });
});

describe('assistant: limite diario', () => {
  it('agota el cupo y responde 429 ai_quota_exceeded', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 2 });
    const { app } = buildChatApp({ provider, quota });

    expect((await callChat(app, 'jwt-admin', { message: 'Uno' })).statusCode).toBe(200);
    expect((await callChat(app, 'jwt-admin', { message: 'Dos' })).statusCode).toBe(200);

    const third = await callChat(app, 'jwt-admin', { message: 'Tres' });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ error: 'ai_quota_exceeded' });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(quota.remaining()).toBe(0);
  });

  it('quotaRemaining informa el cupo restante', async () => {
    const quota = createInMemoryAssistantQuota({ limit: 3 });
    const { app } = buildChatApp({ quota });

    expect(
      (await callChat(app, 'jwt-admin', { message: 'Hola' })).json(),
    ).toMatchObject({ quotaRemaining: 2 });
  });

  it('peticiones concurrentes no superan el limite', async () => {
    const { provider, complete } = spyProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return COMPLETION;
    });
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp({ provider, quota });

    const responses = await Promise.all([
      callChat(app, 'jwt-operator', { message: 'Concurrente A' }),
      callChat(app, 'jwt-operator', { message: 'Concurrente B' }),
    ]);

    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 429]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('assistant: errores del proveedor', () => {
  it.each([
    ['rate_limited', 429, 'ai_rate_limited'],
    ['timeout', 504, 'ai_timeout'],
    ['invalid_response', 502, 'ai_invalid_response'],
    ['unavailable', 502, 'ai_unavailable'],
  ] as const)(
    '%s -> %i %s',
    async (kind, status, errorCode) => {
      const { provider } = spyProvider(async () => {
        throw new AssistantProviderError(kind);
      });
      const { app } = buildChatApp({ provider });

      const response = await callChat(app, 'jwt-vet', { message: 'Hola' });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error: errorCode });
    },
  );

  it('un error inesperado del proveedor -> 502 ai_unavailable sin detalles', async () => {
    const { provider } = spyProvider(async () => {
      throw new Error('api_key=sk-secreto-no-debe-salir');
    });
    const { app } = buildChatApp({ provider });

    const response = await callChat(app, 'jwt-vet', { message: 'Hola' });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'ai_unavailable' });
    expect(response.body).not.toContain('sk-secreto');
  });

  it('el fallo del proveedor consume cupo (no se libera)', async () => {
    const { provider } = spyProvider(async () => {
      throw new AssistantProviderError('rate_limited');
    });
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp({ provider, quota });

    expect((await callChat(app, 'jwt-vet', { message: 'Hola' })).statusCode).toBe(429);
    expect(quota.remaining()).toBe(0);
    expect((await callChat(app, 'jwt-vet', { message: 'Hola' })).statusCode).toBe(429);
  });
});

describe('assistant: respuesta y fail-closed', () => {
  it('devuelve usage null cuando el proveedor no lo informa', async () => {
    const { provider } = spyProvider(async () => ({ reply: 'Hola', usage: null }));
    const { app } = buildChatApp({ provider });

    const response = await callChat(app, 'jwt-operator', { message: 'Hola' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reply: 'Hola', usage: null });
  });

  it('sin proveedor inyectado el asistente es fail-closed (502)', async () => {
    const app = buildApp({
      logger: false,
      tokenVerifier: createVerifier(),
      profileRepository: createProfileRepository(),
    });

    const response = await callChat(app, 'jwt-admin', { message: 'Hola' });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'ai_unavailable' });
  });
});

describe('assistant: composicion del prompt', () => {
  it('envia el prompt de sistema PigTec y el mensaje del usuario al proveedor', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const { app } = buildChatApp({ provider });

    await callChat(app, 'jwt-operator', { message: '  Hola  ' });

    expect(complete).toHaveBeenCalledTimes(1);
    const messages = complete.mock.calls[0][0] as AssistantMessage[];
    expect(messages).toEqual([
      { role: 'system', content: PIGTEC_SYSTEM_PROMPT },
      { role: 'user', content: 'Hola' },
    ]);
  });
});
