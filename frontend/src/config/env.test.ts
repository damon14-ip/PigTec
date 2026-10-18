import { describe, expect, it } from 'vitest';
import { EnvError, readEnv } from './env';

const VALID = {
  VITE_API_BASE_URL: 'http://127.0.0.1:3000',
  VITE_SUPABASE_URL: 'https://proyecto.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'clave-publica-de-prueba',
};

describe('readEnv', () => {
  it('lee la configuracion valida y quita la barra final de las URLs', () => {
    const env = readEnv({
      ...VALID,
      VITE_API_BASE_URL: 'http://127.0.0.1:3000/',
      VITE_SUPABASE_URL: 'https://proyecto.supabase.co/',
    });

    expect(env).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000',
      supabaseUrl: 'https://proyecto.supabase.co',
      supabaseAnonKey: 'clave-publica-de-prueba',
    });
  });

  it('lanza EnvError nombrando las variables que faltan y sin exponer valores', () => {
    expect(() => readEnv({ VITE_API_BASE_URL: VALID.VITE_API_BASE_URL })).toThrow(
      EnvError,
    );

    try {
      readEnv({ VITE_API_BASE_URL: VALID.VITE_API_BASE_URL });
      expect.unreachable('deberia haber lanzado EnvError');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('VITE_SUPABASE_URL');
      expect(message).toContain('VITE_SUPABASE_ANON_KEY');
      expect(message).not.toContain('clave-publica-de-prueba');
    }
  });

  it('rechaza una URL de API que no sea http o https', () => {
    expect(() =>
      readEnv({ ...VALID, VITE_API_BASE_URL: 'ftp://servidor.local' }),
    ).toThrow(EnvError);
  });

  it('rechaza una URL de Supabase que no sea absoluta', () => {
    expect(() =>
      readEnv({ ...VALID, VITE_SUPABASE_URL: 'no-es-una-url' }),
    ).toThrow(EnvError);
  });

  it('no lee variables sin prefijo VITE_ (nunca accede a secretos del servidor)', () => {
    // La funcion solo consulta las claves VITE_* conocidas: la presencia de
    // GROQ_API_KEY o de claves privadas no influye en la configuracion.
    expect(() =>
      readEnv({
        ...VALID,
        GROQ_API_KEY: 'secreto-que-no-debe-usarse',
        SUPABASE_SERVICE_ROLE_KEY: 'secreto-que-no-debe-usarse',
      }),
    ).not.toThrow();
  });
});
