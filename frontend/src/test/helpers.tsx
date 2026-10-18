import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  AuthContext,
  type AuthContextValue,
} from '../context/auth-context';
import type { ApiClient } from '../lib/http';
import type { AuthorizedProfile } from '../services/auth.service';

/**
 * Cliente de API que falla si se usa: garantiza que las pruebas de componentes
 * no realicen peticiones reales.
 */
export const FORBIDDEN_API_CLIENT = {
  get: () =>
    Promise.reject(new Error('La prueba no debe llamar a la API (GET).')),
  post: () =>
    Promise.reject(new Error('La prueba no debe llamar a la API (POST).')),
  patch: () =>
    Promise.reject(new Error('La prueba no debe llamar a la API (PATCH).')),
  delete: () =>
    Promise.reject(new Error('La prueba no debe llamar a la API (DELETE).')),
} as unknown as ApiClient;

/** Perfil autorizado de ejemplo (valores de prueba, no reales). */
export function makeProfile(
  overrides: Partial<AuthorizedProfile> = {},
): AuthorizedProfile {
  return { id: 'perfil-prueba', role: 'manager', is_active: true, ...overrides };
}

/** Valor de contexto de autenticacion para pruebas. */
export function makeAuthValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    status: 'authenticated',
    session: null,
    profile: makeProfile(),
    email: 'usuario@prueba.local',
    accessToken: 'token-de-prueba',
    apiClient: FORBIDDEN_API_CLIENT,
    notice: null,
    error: null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    retry: async () => undefined,
    ...overrides,
  };
}

export interface RenderWithAuthOptions {
  auth?: AuthContextValue;
  route?: string;
}

/** Renderiza un componente dentro de un router de memoria y del contexto de auth. */
export function renderWithAuth(
  ui: ReactElement,
  options: RenderWithAuthOptions = {},
): ReturnType<typeof render> {
  const { auth = makeAuthValue(), route = '/' } = options;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </MemoryRouter>
  );
  return render(ui, { wrapper });
}
