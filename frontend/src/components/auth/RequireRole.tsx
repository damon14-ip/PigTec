import type { ReactNode } from 'react';
import type { OperationalRole } from '../../config/roles';
import { useAuth } from '../../context/auth-context';
import { ForbiddenPage } from '../../pages/ForbiddenPage';

export interface RequireRoleProps {
  roles: readonly OperationalRole[];
  children: ReactNode;
}

/**
 * Restringe el contenido a los roles indicados.
 *
 * Los permisos provienen del perfil autorizado (`GET /auth/profile`), nunca del
 * cliente. Si el rol no esta permitido se muestra una pagina de acceso denegado.
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { profile } = useAuth();

  if (!profile || !roles.includes(profile.role)) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}
