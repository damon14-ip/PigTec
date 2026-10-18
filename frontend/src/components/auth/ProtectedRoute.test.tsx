import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { AuthStatus } from '../../context/auth-context';
import { makeAuthValue, renderWithAuth } from '../../test/helpers';
import { ProtectedRoute } from './ProtectedRoute';

function renderGuardedRoute(status: AuthStatus, extra = {}) {
  return renderWithAuth(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/privado" element={<p>Contenido privado</p>} />
      </Route>
      <Route path="/login" element={<p>Pantalla de acceso</p>} />
    </Routes>,
    {
      route: '/privado',
      auth: makeAuthValue({ status, ...extra }),
    },
  );
}

describe('ProtectedRoute', () => {
  it('muestra un indicador mientras se comprueba la sesion', () => {
    renderGuardedRoute('loading');

    expect(screen.getByRole('status')).toHaveTextContent('Verificando sesión');
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
  });

  it('redirige a /login cuando no hay sesion', () => {
    renderGuardedRoute('unauthenticated');

    expect(screen.getByText('Pantalla de acceso')).toBeInTheDocument();
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
  });

  it('renderiza la ruta privada cuando la sesion esta autorizada', () => {
    renderGuardedRoute('authenticated');

    expect(screen.getByText('Contenido privado')).toBeInTheDocument();
  });

  it('no concede acceso y ofrece reintentar si no se pudo verificar el perfil', async () => {
    const retry = vi.fn(async () => undefined);
    renderGuardedRoute('error', { retry, error: 'Fallo de red' });

    expect(
      screen.getByText('No se pudo verificar tu perfil'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Reintentar' }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('permite cerrar sesion desde la pantalla de error', () => {
    const signOut = vi.fn(async () => undefined);
    renderGuardedRoute('error', { signOut });

    screen.getByRole('button', { name: 'Cerrar sesión' }).click();
    expect(signOut).toHaveBeenCalledOnce();
  });
});
