import { describe, expect, it, vi } from 'vitest';
import {
  AssistantProviderError,
  type AssistantFailureKind,
} from '../src/modules/assistant/assistant.provider.js';
import {
  MAX_COMPLETION_TOKENS,
  createGroqProvider,
} from '../src/modules/assistant/groq.provider.js';
import { PIGTEC_SYSTEM_PROMPT } from '../src/modules/assistant/assistant.prompt.js';
import { createInMemoryAssistantQuota } from '../src/modules/assistant/assistant.quota.js';
import {
  DEFAULT_DAILY_REQUEST_LIMIT,
  readAssistantConfig,
} from '../src/modules/assistant/assistant.config.js';

/**
 * Contrato del backend hacia la API de Groq (compatible con OpenAI).
 *
 * Se inyecta un `fetch` falso: NUNCA se realiza una llamada real (no se consume
 * cuota). Se comprueba la forma EXACTA de la peticion (URL, metodo, encabezados,
 * cuerpo) y la traduccion de respuestas y errores a `AssistantProviderError`.
 */

const API_KEY = 'gsk-fake-key-no-real';
const MODEL = 'openai/gpt-oss-20b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface CapturedRequest {
  url: unknown;
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: unknown;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `fetch` falso que devuelve (o lanza) el resultado indicado. */
function createFetchMock(result: Response | (() => Promise<Response>)) {
  const fetchImpl = vi.fn(async () =>
    typeof result === 'function' ? result() : result,
  );
  const provider = createGroqProvider({
    apiKey: API_KEY,
    model: MODEL,
    timeoutMs: 1000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { provider, fetchImpl };
}

function firstCall(fetchImpl: ReturnType<typeof vi.fn>): CapturedRequest {
  const [url, init] = fetchImpl.mock.calls[0] as [unknown, CapturedRequest['init']];
  return { url, init };
}

async function expectFailure(
  promise: Promise<unknown>,
  kind: AssistantFailureKind,
): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AssistantProviderError);
  expect((thrown as AssistantProviderError).kind).toBe(kind);
  // El mensaje jamas contiene la clave ni detalles del proveedor.
  expect((thrown as Error).message).not.toContain(API_KEY);
}

describe('groq: contrato de la peticion HTTP', () => {
  const MESSAGES = [
    { role: 'system' as const, content: PIGTEC_SYSTEM_PROMPT },
    { role: 'user' as const, content: 'Como registro un area?' },
  ];

  it('envia POST al endpoint de Groq con autenticacion Bearer', async () => {
    const { provider, fetchImpl } = createFetchMock(
      jsonResponse(200, {
        choices: [{ message: { content: 'Respuesta' } }],
      }),
    );

    await provider.complete(MESSAGES);
    const { url, init } = firstCall(fetchImpl);

    expect(url).toBe(GROQ_URL);
    expect(init.method).toBe('POST');
    expect(init.headers?.['content-type']).toBe('application/json');
    expect(init.headers?.authorization).toBe(`Bearer ${API_KEY}`);
    // Se fija un tiempo maximo de espera (abortable): no hay espera infinita.
    expect(init.signal).toBeDefined();
  });

  it('el cuerpo lleva modelo, mensajes y limite de tokens de salida, SIN la clave', async () => {
    const { provider, fetchImpl } = createFetchMock(
      jsonResponse(200, { choices: [{ message: { content: 'Hola' } }] }),
    );

    await provider.complete(MESSAGES);
    const bodyText = firstCall(fetchImpl).init.body ?? '';
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    expect(body.model).toBe(MODEL);
    expect(body.messages).toEqual(MESSAGES);
    expect(body.max_completion_tokens).toBe(MAX_COMPLETION_TOKENS);
    // La clave viaja SOLO en el encabezado, nunca en el cuerpo.
    expect(bodyText).not.toContain(API_KEY);
  });

  it('interpreta la respuesta y normaliza el usage', async () => {
    const { provider } = createFetchMock(
      jsonResponse(200, {
        choices: [{ message: { content: '  Listo  ' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const completion = await provider.complete(MESSAGES);
    expect(completion).toEqual({
      reply: 'Listo',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it('usage ausente -> null', async () => {
    const { provider } = createFetchMock(
      jsonResponse(200, { choices: [{ message: { content: 'Hola' } }] }),
    );

    const completion = await provider.complete(MESSAGES);
    expect(completion.usage).toBeNull();
  });
});

describe('groq: traduccion de errores', () => {
  const MESSAGES = [{ role: 'user' as const, content: 'Hola' }];

  it('HTTP 429 -> rate_limited (sin reintentos)', async () => {
    const { provider, fetchImpl } = createFetchMock(jsonResponse(429, {}));
    await expectFailure(provider.complete(MESSAGES), 'rate_limited');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500 -> unavailable', async () => {
    const { provider } = createFetchMock(jsonResponse(500, { error: 'interno' }));
    await expectFailure(provider.complete(MESSAGES), 'unavailable');
  });

  it('timeout del proveedor -> timeout', async () => {
    const { provider } = createFetchMock(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    await expectFailure(provider.complete(MESSAGES), 'timeout');
  });

  it('error de red -> unavailable', async () => {
    const { provider } = createFetchMock(async () => {
      throw new TypeError('fetch failed');
    });
    await expectFailure(provider.complete(MESSAGES), 'unavailable');
  });

  it('JSON invalido -> invalid_response', async () => {
    const { provider } = createFetchMock(
      new Response('esto-no-es-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expectFailure(provider.complete(MESSAGES), 'invalid_response');
  });

  it('respuesta sin choices -> invalid_response', async () => {
    const { provider } = createFetchMock(jsonResponse(200, { id: 'x' }));
    await expectFailure(provider.complete(MESSAGES), 'invalid_response');
  });

  it('contenido vacio -> invalid_response', async () => {
    const { provider } = createFetchMock(
      jsonResponse(200, { choices: [{ message: { content: '   ' } }] }),
    );
    await expectFailure(provider.complete(MESSAGES), 'invalid_response');
  });
});

describe('quota: contador diario en memoria', () => {
  it('respeta el limite y expone el cupo restante', () => {
    const quota = createInMemoryAssistantQuota({ limit: 2 });

    expect(quota.limit()).toBe(2);
    expect(quota.remaining()).toBe(2);
    expect(quota.reserve()).toBe(true);
    expect(quota.reserve()).toBe(true);
    expect(quota.reserve()).toBe(false);
    expect(quota.remaining()).toBe(0);
  });

  it('reinicia el cupo al cambiar el dia UTC', () => {
    let now = Date.UTC(2026, 0, 1, 23, 0, 0);
    const quota = createInMemoryAssistantQuota({ limit: 1, now: () => now });

    expect(quota.reserve()).toBe(true);
    expect(quota.reserve()).toBe(false);

    // Avanza un dia UTC.
    now += 24 * 60 * 60 * 1000;
    expect(quota.reserve()).toBe(true);
    expect(quota.remaining()).toBe(0);
  });

  it('las reservas sincronas no se superan aunque se soliciten en rafaga', () => {
    const quota = createInMemoryAssistantQuota({ limit: 3 });
    const results = Array.from({ length: 10 }, () => quota.reserve());
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe('readAssistantConfig: solo desde el entorno', () => {
  it('devuelve null si falta la clave', () => {
    expect(readAssistantConfig({ GROQ_MODEL: MODEL })).toBeNull();
  });

  it('devuelve null si falta el modelo', () => {
    expect(readAssistantConfig({ GROQ_API_KEY: API_KEY })).toBeNull();
  });

  it('devuelve null si la clave o el modelo estan en blanco', () => {
    expect(
      readAssistantConfig({ GROQ_API_KEY: '   ', GROQ_MODEL: MODEL }),
    ).toBeNull();
  });

  it('lee clave y modelo del entorno y aplica el limite por defecto', () => {
    const config = readAssistantConfig({
      GROQ_API_KEY: API_KEY,
      GROQ_MODEL: MODEL,
    });

    expect(config).toEqual({
      apiKey: API_KEY,
      model: MODEL,
      dailyRequestLimit: DEFAULT_DAILY_REQUEST_LIMIT,
      timeoutMs: expect.any(Number),
    });
  });

  it('interpreta AI_DAILY_REQUEST_LIMIT cuando es un entero positivo', () => {
    const config = readAssistantConfig({
      GROQ_API_KEY: API_KEY,
      GROQ_MODEL: MODEL,
      AI_DAILY_REQUEST_LIMIT: '5',
    });

    expect(config?.dailyRequestLimit).toBe(5);
  });

  it('usa el limite por defecto si AI_DAILY_REQUEST_LIMIT es invalido', () => {
    for (const value of ['0', '-3', 'abc', '', '1.5']) {
      const config = readAssistantConfig({
        GROQ_API_KEY: API_KEY,
        GROQ_MODEL: MODEL,
        AI_DAILY_REQUEST_LIMIT: value,
      });
      expect(config?.dailyRequestLimit).toBe(DEFAULT_DAILY_REQUEST_LIMIT);
    }
  });
});
