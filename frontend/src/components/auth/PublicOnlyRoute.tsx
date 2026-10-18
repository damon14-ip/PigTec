import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/auth-context';
import { FullPageLoader } from '../ui/Spinner';
import { SessionErrorScreen } from './SessionErrorScreen';

/**
 * Rutas publicas (solo la pantalla de acceso).
 *
 * Si ya hay sesion autorizada, redirige al destino solicitado (o al dashboard)
 * para no volver a mostrar el formulario de acceso. No existe ninguna ruta de
 * registro publico.
 */
export function PublicOnlyRoute() {
  const { status, error, retry, signOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoader label="Cargando…" />;
  }

  if (status === 'error') {
    return (
      <SessionErrorScreen message={error} onRetry={retry} onSignOut={signOut} />
    );
  }

  if (status === 'authenticated') {
    const requested = (location.state as { from?: string } | null)?.from;
    const target =
      requested && !requested.startsWith('/login') ? requested : '/';
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
