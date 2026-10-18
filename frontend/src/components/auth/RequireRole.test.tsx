import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { makeAuthValue, makeProfile, renderWithAuth } from '../../test/helpers';
import { RequireRole } from './RequireRole';

describe('RequireRole', () => {
  it('muestra el contenido cuando el rol esta autorizado', () => {
    renderWithAuth(
      <RequireRole roles={['admin']}>
        <p>Zona de administración</p>
      </RequireRole>,
      { auth: makeAuthValue({ profile: makeProfile({ role: 'admin' }) }) },
    );

    expect(screen.getByText('Zona de administración')).toBeInTheDocument();
  });

  it('deniega el contenido cuando el rol no esta autorizado', () => {
    renderWithAuth(
      <RequireRole roles={['admin']}>
        <p>Zona de administración</p>
      </RequireRole>,
      { auth: makeAuthValue({ profile: makeProfile({ role: 'manager' }) }) },
    );

    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
    expect(screen.queryByText('Zona de administración')).not.toBeInTheDocument();
  });

  it('deniega el contenido si no hay perfil autorizado', () => {
    renderWithAuth(
      <RequireRole roles={['admin']}>
        <p>Zona de administración</p>
      </RequireRole>,
      { auth: makeAuthValue({ profile: null, status: 'unauthenticated' }) },
    );

    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
  });
});
