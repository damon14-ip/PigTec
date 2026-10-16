import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDotEnv, parseEnv } from '../src/config/env.js';

const VALID_ENV = {
  PORT: '4000',
  HOST: '0.0.0.0',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key-placeholder',
};

describe('parseEnv', () => {
  it('acepta valores validos y normaliza PORT a numero', () => {
    const env = parseEnv({ ...VALID_ENV });

    expect(env).toEqual({
      PORT: 4000,
      HOST: '0.0.0.0',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'public-anon-key-placeholder',
    });
  });

  it('aplica valores por defecto cuando PORT y HOST faltan', () => {
    const env = parseEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'public-anon-key-placeholder',
    });

    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('127.0.0.1');
  });

  it('falla si falta una variable obligatoria y menciona el campo', () => {
    const source = { SUPABASE_URL: 'https://example.supabase.co' };

    let thrown: unknown;
    try {
      parseEnv(source);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('SUPABASE_ANON_KEY');
  });

  it('falla con valores incorrectos: PORT no numerico', () => {
    expect(() => parseEnv({ ...VALID_ENV, PORT: 'no-es-un-numero' })).toThrowError(
      /PORT/,
    );
  });

  it('falla con valores incorrectos: URL invalida', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'no-es-una-url' }),
    ).toThrowError(/SUPABASE_URL/);
  });

  it('no filtra el valor sensible en el mensaje de error', () => {
    const valorSensible = 'super-secreto-que-no-debe-aparecer';

    let message = '';
    try {
      parseEnv({
        ...VALID_ENV,
        SUPABASE_ANON_KEY: valorSensible,
        SUPABASE_URL: 'no-es-una-url',
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain(valorSensible);
    expect(message).toContain('SUPABASE_URL');
  });
});

describe('parseEnv: SUPABASE_URL debe usar HTTPS', () => {
  it('acepta una URL HTTPS con hostname valido', () => {
    const env = parseEnv({
      ...VALID_ENV,
      SUPABASE_URL: 'https://mi-proyecto.supabase.co',
    });

    expect(env.SUPABASE_URL).toBe('https://mi-proyecto.supabase.co');
  });

  it('rechaza HTTP plano', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'http://example.supabase.co' }),
    ).toThrowError(/SUPABASE_URL/);
  });

  it('rechaza otros protocolos aunque la URL sea valida', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'ftp://example.supabase.co' }),
    ).toThrowError(/SUPABASE_URL/);
  });
});

describe('parseEnv: SUPABASE_URL debe tener un hostname valido', () => {
  it('rechaza una URL sin hostname (host vacio)', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'https://' }),
    ).toThrowError(/SUPABASE_URL/);
  });

  it('rechaza un hostname con caracteres no permitidos', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'https://exa_mple.supabase.co' }),
    ).toThrowError(/SUPABASE_URL/);
  });

  it('rechaza un hostname con etiquetas vacias', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'https://a..b' }),
    ).toThrowError(/SUPABASE_URL/);
  });

  it('rechaza un hostname con etiqueta que empieza por guion', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, SUPABASE_URL: 'https://-malo.supabase.co' }),
    ).toThrowError(/SUPABASE_URL/);
  });
});

describe('loadDotEnv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no lanza error si el archivo .env no existe (ENOENT)', () => {
    expect(() => loadDotEnv('archivo-inexistente.env')).not.toThrow();
  });

  it('propaga un error seguro (sin credenciales) cuando la lectura falla por otra causa', () => {
    const valorSensible = 'clave-secreta-que-no-debe-filtrarse';
    const errorOriginal = Object.assign(
      new Error(`fallo al leer el archivo con ${valorSensible}`),
      { code: 'EACCES' },
    );

    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {
      throw errorOriginal;
    });

    let thrown: unknown;
    try {
      loadDotEnv('archivo-protegido.env');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('archivo-protegido.env');
    expect((thrown as Error).message).not.toContain(valorSensible);
  });

  it('propaga un error seguro ante errores de lectura reales distintos de ENOENT', () => {
    // Un directorio no es un archivo .env valido y provoca un error real
    // de lectura (nunca ENOENT), que debe propagarse saneado.
    let thrown: unknown;
    try {
      loadDotEnv('.');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('No se pudo leer');
  });
});
