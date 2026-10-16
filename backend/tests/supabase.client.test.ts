import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSupabaseClient,
  type SupabaseEnv,
} from '../src/supabase/client.js';

const ENV: SupabaseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'example-anon-key-not-real',
};

const JWT_ALICE = 'header.payload.firma-de-alice';
const JWT_BOB = 'header.payload.firma-de-bob';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Instala un `fetch` falso que registra las peticiones en lugar de tocar la red.
 * supabase-js resuelve `fetch` desde el objeto global en cada peticion.
 */
function interceptFetch(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];

  const fetchMock = vi.fn(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const headers = new Headers(init?.headers);
      captured.push({
        url: String(input),
        headers: Object.fromEntries(headers.entries()),
      });

      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createSupabaseClient: construccion y configuracion', () => {
  it('construye un cliente con la URL y la anon key de la configuracion validada', async () => {
    const captured = interceptFetch();

    const client = createSupabaseClient(ENV);
    await client.from('animals').select('*');

    expect(captured).toHaveLength(1);
    expect(captured[0].url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/animals`)).toBe(
      true,
    );
    expect(captured[0].headers.apikey).toBe(ENV.SUPABASE_ANON_KEY);
  });

  it('no usa service_role: el unico apikey enviado es la anon key', async () => {
    const captured = interceptFetch();

    const client = createSupabaseClient(ENV, { accessToken: JWT_ALICE });
    await client.from('animals').select('*');

    expect(captured[0].headers.apikey).toBe(ENV.SUPABASE_ANON_KEY);
    expect(JSON.stringify(captured[0].headers)).not.toContain('service_role');
  });

  it('rechaza un accessToken vacio en lugar de caer en silencio al rol anon', () => {
    expect(() => createSupabaseClient(ENV, { accessToken: '   ' })).toThrowError(
      /accessToken/,
    );
  });
});

describe('createSupabaseClient: Authorization', () => {
  it('sin JWT usa la anon key como Bearer por defecto (rol anon)', async () => {
    const captured = interceptFetch();

    const client = createSupabaseClient(ENV);
    await client.from('animals').select('*');

    expect(captured[0].headers.authorization).toBe(
      `Bearer ${ENV.SUPABASE_ANON_KEY}`,
    );
  });

  it('con JWT lo envia como Authorization: Bearer <jwt>', async () => {
    const captured = interceptFetch();

    const client = createSupabaseClient(ENV, { accessToken: JWT_ALICE });
    await client.from('animals').select('*');

    expect(captured[0].headers.authorization).toBe(`Bearer ${JWT_ALICE}`);
    expect(captured[0].headers.apikey).toBe(ENV.SUPABASE_ANON_KEY);
  });
});

describe('createSupabaseClient: aislamiento entre solicitudes', () => {
  it('crea instancias independientes (no hay cliente global compartido)', () => {
    const alice = createSupabaseClient(ENV, { accessToken: JWT_ALICE });
    const bob = createSupabaseClient(ENV, { accessToken: JWT_BOB });

    expect(alice).not.toBe(bob);
  });

  it('cada cliente conserva su propio JWT aunque se creen otros', async () => {
    const captured = interceptFetch();

    const alice = createSupabaseClient(ENV, { accessToken: JWT_ALICE });
    const bob = createSupabaseClient(ENV, { accessToken: JWT_BOB });

    await alice.from('animals').select('*');
    await bob.from('animals').select('*');
    await alice.from('pens').select('*');

    expect(captured[0].headers.authorization).toBe(`Bearer ${JWT_ALICE}`);
    expect(captured[1].headers.authorization).toBe(`Bearer ${JWT_BOB}`);
    // El primer cliente no adopta el token del segundo.
    expect(captured[2].headers.authorization).toBe(`Bearer ${JWT_ALICE}`);
  });

  it('mantiene el Authorization correcto bajo peticiones concurrentes', async () => {
    const captured = interceptFetch();

    const alice = createSupabaseClient(ENV, { accessToken: JWT_ALICE });
    const bob = createSupabaseClient(ENV, { accessToken: JWT_BOB });

    await Promise.all([
      alice.from('animals').select('id'),
      bob.from('animals').select('id'),
    ]);

    const authorizations = captured
      .map((request) => request.headers.authorization)
      .sort();

    expect(authorizations).toEqual(
      [`Bearer ${JWT_ALICE}`, `Bearer ${JWT_BOB}`].sort(),
    );
  });
});
