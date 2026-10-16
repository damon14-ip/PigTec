import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProfileLookupError,
  createSupabaseProfileRepository,
  type SupabaseProfileClient,
  type SupabaseProfileRow,
} from '../src/modules/auth/profile-repository.js';
import {
  createSupabaseClient,
  type SupabaseEnv,
} from '../src/supabase/client.js';

const ENV: SupabaseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'example-anon-key-not-real',
};

/** Doble del cliente Supabase: registra la cadena de consulta. */
function createFakeClient(
  row: SupabaseProfileRow | null,
  error: unknown = null,
) {
  const maybeSingle = vi.fn(async () => ({ data: row, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as SupabaseProfileClient,
    from,
    select,
    eq,
    maybeSingle,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createSupabaseProfileRepository: mapeo y validacion', () => {
  it('mapea la fila a un perfil de dominio', async () => {
    const { client } = createFakeClient({
      id: 'u-1',
      role: 'manager',
      is_active: true,
    });

    const profile = await createSupabaseProfileRepository(() => client)
      .findProfileById('u-1', 'jwt');

    expect(profile).toEqual({ id: 'u-1', role: 'manager', isActive: true });
  });

  it('consulta la tabla profiles, las columnas minimas y filtra por id', async () => {
    const { client, from, select, eq } = createFakeClient({
      id: 'u-1',
      role: 'admin',
      is_active: true,
    });

    await createSupabaseProfileRepository(() => client).findProfileById(
      'u-1',
      'jwt',
    );

    expect(from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith('id, role, is_active');
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
  });

  it('crea un cliente nuevo por consulta, con el JWT recibido', async () => {
    const { client } = createFakeClient(null);
    const createClient = vi.fn(() => client);
    const repository = createSupabaseProfileRepository(createClient);

    await repository.findProfileById('u-1', 'jwt-alice');
    await repository.findProfileById('u-2', 'jwt-bob');

    expect(createClient).toHaveBeenNthCalledWith(1, 'jwt-alice');
    expect(createClient).toHaveBeenNthCalledWith(2, 'jwt-bob');
  });

  it('devuelve null cuando no hay fila (RLS sin acceso)', async () => {
    const { client } = createFakeClient(null);

    const profile = await createSupabaseProfileRepository(() => client)
      .findProfileById('u-1', 'jwt');

    expect(profile).toBeNull();
  });

  it('propaga ProfileLookupError ante un error devuelto por Supabase', async () => {
    const { client } = createFakeClient(null, { message: 'boom token=secreto' });
    const repository = createSupabaseProfileRepository(() => client);

    await expect(
      repository.findProfileById('u-1', 'jwt'),
    ).rejects.toBeInstanceOf(ProfileLookupError);
  });

  it('envuelve un error lanzado por el cliente sin filtrar credenciales ni tokens', async () => {
    const client = {
      from: () => {
        throw new Error('fallo de red token=secreto');
      },
    } as unknown as SupabaseProfileClient;
    const repository = createSupabaseProfileRepository(() => client);

    let caught: unknown;
    try {
      await repository.findProfileById('u-1', 'jwt');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProfileLookupError);
    const message = (caught as Error).message;
    expect(message).not.toContain('secreto');
    expect(message).not.toContain('token');
  });

  it('devuelve null si el rol no es valido', async () => {
    const { client } = createFakeClient({
      id: 'u-1',
      role: 'superadmin',
      is_active: true,
    });

    const profile = await createSupabaseProfileRepository(() => client)
      .findProfileById('u-1', 'jwt');

    expect(profile).toBeNull();
  });

  it('devuelve null si is_active no es booleano', async () => {
    const { client } = createFakeClient({
      id: 'u-1',
      role: 'admin',
      is_active: 'true' as unknown as boolean,
    });

    const profile = await createSupabaseProfileRepository(() => client)
      .findProfileById('u-1', 'jwt');

    expect(profile).toBeNull();
  });

  it('devuelve null si la fila no corresponde al usuario solicitado', async () => {
    const { client } = createFakeClient({
      id: 'u-otro',
      role: 'admin',
      is_active: true,
    });

    const profile = await createSupabaseProfileRepository(() => client)
      .findProfileById('u-1', 'jwt');

    expect(profile).toBeNull();
  });
});

describe('createSupabaseProfileRepository: contexto RLS con cliente real', () => {
  function interceptFetch(body: unknown, status = 200) {
    const captured: { url: string; headers: Record<string, string> }[] = [];

    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        captured.push({
          url: String(input),
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });

        return new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    vi.stubGlobal('fetch', fetchMock);
    return captured;
  }

  it('consulta /rest/v1/profiles con el JWT del usuario (identidad, no anon)', async () => {
    const captured = interceptFetch({
      id: 'u-alice',
      role: 'operator',
      is_active: true,
    });

    const repository = createSupabaseProfileRepository(
      (accessToken) =>
        // El cliente real satisface la interfaz estrecha en tiempo de ejecucion
        // (from().select().eq().maybeSingle()). El cast evita la resolucion
        // recursiva de los genericos de supabase-js y documenta el limite.
        createSupabaseClient(ENV, { accessToken }) as unknown as SupabaseProfileClient,
    );

    const profile = await repository.findProfileById('u-alice', 'jwt-alice');

    expect(profile).toEqual({
      id: 'u-alice',
      role: 'operator',
      isActive: true,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toContain('/rest/v1/profiles');
    expect(captured[0].url).toContain('select=');
    expect(captured[0].url).toContain('id=eq.u-alice');
    // La consulta usa la anon key como apikey y el JWT del usuario como Bearer.
    expect(captured[0].headers.apikey).toBe(ENV.SUPABASE_ANON_KEY);
    expect(captured[0].headers.authorization).toBe('Bearer jwt-alice');
  });
});
