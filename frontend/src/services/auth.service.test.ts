import { describe, expect, it } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import { fetchAuthorizedProfile } from './auth.service';

/** Cliente de API que resuelve siempre el mismo valor. */
function clientReturning(value: unknown): ApiClient {
  return {
    get: <T,>() => Promise.resolve(value as T),
    post: <T,>() => Promise.resolve(value as T),
    patch: <T,>() => Promise.resolve(value as T),
    delete: <T,>() => Promise.resolve(value as T),
  };
}

/** Cliente de API que siempre falla con el error indicado. */
function clientThrowing(error: unknown): ApiClient {
  return {
    get: <T,>() => Promise.reject<T>(error),
    post: <T,>() => Promise.reject<T>(error),
    patch: <T,>() => Promise.reject<T>(error),
    delete: <T,>() => Promise.reject<T>(error),
  };
}

describe('fetchAuthorizedProfile', () => {
  it('devuelve el perfil cuando es operativo y esta activo', async () => {
    const result = await fetchAuthorizedProfile(
      clientReturning({ id: 'u1', role: 'veterinarian', is_active: true }),
    );

    expect(result).toEqual({
      status: 'authorized',
      profile: { id: 'u1', role: 'veterinarian', is_active: true },
    });
  });

  it('bloquea el rol viewer aunque el backend lo devuelva activo', async () => {
    const result = await fetchAuthorizedProfile(
      clientReturning({ id: 'u1', role: 'viewer', is_active: true }),
    );

    expect(result).toEqual({ status: 'blocked', reason: 'no-operational-role' });
  });

  it('bloquea un perfil operativo inactivo', async () => {
    const result = await fetchAuthorizedProfile(
      clientReturning({ id: 'u1', role: 'operator', is_active: false }),
    );

    expect(result).toEqual({ status: 'blocked', reason: 'no-operational-role' });
  });

  it('bloquea cuando el backend responde 403 (sin rol operativo o inactivo)', async () => {
    const result = await fetchAuthorizedProfile(
      clientThrowing(new ApiError(403, 'forbidden', 'x')),
    );

    expect(result).toEqual({ status: 'blocked', reason: 'no-operational-role' });
  });

  it('bloquea cuando el backend responde 401 (sesion no valida)', async () => {
    const result = await fetchAuthorizedProfile(
      clientThrowing(new ApiError(401, 'unauthorized', 'x')),
    );

    expect(result).toEqual({ status: 'blocked', reason: 'unauthenticated' });
  });

  it('no concede acceso ante un fallo de red o del servidor', async () => {
    const result = await fetchAuthorizedProfile(
      clientThrowing(new ApiError(0, 'network_error', 'x')),
    );

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('no concede acceso ante un 503 del backend', async () => {
    const result = await fetchAuthorizedProfile(
      clientThrowing(new ApiError(503, 'service_unavailable', 'x')),
    );

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('falla cerrado ante una respuesta con forma inesperada', async () => {
    const result = await fetchAuthorizedProfile(
      clientReturning({ id: 'u1', role: 'admin' }),
    );

    expect(result).toEqual({ status: 'blocked', reason: 'no-operational-role' });
  });
});
