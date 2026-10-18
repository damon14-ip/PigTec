import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/auth-context';
import { FullPageLoader } from '../ui/Spinner';
import { SessionErrorScreen } from './SessionErrorScreen';

/**
 * Proteccion de rutas privadas.
 *
 * - `loading`: muestra un indicador mientras se comprueba la sesion.
 * - `error`: no se pudo verificar el perfil; no se concede acceso.
 * - `unauthenticated`: redirige a `/login` recordando la ruta solicitada.
 * - `authenticated`: renderiza las rutas hijas.
 */
export function ProtectedRoute() {
  const { status, error, retry, signOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoader label="Verificando sesión…" />;
  }

  if (status === 'error') {
    return (
      <SessionErrorScreen
        message={error}
        onRetry={retry}
        onSignOut={signOut}
      />
    );
  }

  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}
