import { useMemo } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { readEnv } from './config/env';
import { AuthProvider } from './context/AuthProvider';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { PublicOnlyRoute } from './components/auth/PublicOnlyRoute';
import { RequireRole } from './components/auth/RequireRole';
import { AppLayout } from './components/layout/AppLayout';
import { ConfigErrorScreen } from './components/ConfigErrorScreen';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AreasPensPage } from './pages/AreasPensPage';
import { AnimalsPage } from './pages/AnimalsPage';
import { MovementsPage } from './pages/MovementsPage';
import { LittersPage } from './pages/LittersPage';
import { HealthPage } from './pages/HealthPage';
import { ReportsPage } from './pages/ReportsPage';
import { UsersPage } from './pages/UsersPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Raiz de la aplicacion.
 *
 * Comprueba la configuracion del entorno antes de montar nada: si falta una
 * variable, se muestra una pantalla explicativa en lugar de fallar en blanco.
 *
 * Estructura de rutas:
 * - `/login`: publica (unica ruta sin sesion).
 * - resto: privadas, protegidas por `ProtectedRoute` y dentro de `AppLayout`.
 * - `/users`: ademas exige rol `admin`.
 * No existe ninguna ruta de registro publico.
 */
export function App() {
  const config = useMemo(() => {
    try {
      return { env: readEnv(), error: null as string | null };
    } catch (caught) {
      return {
        env: null,
        error:
          caught instanceof Error
            ? caught.message
            : 'La configuración del entorno no es válida.',
      };
    }
  }, []);

  if (!config.env) {
    return <ConfigErrorScreen message={config.error ?? ''} />;
  }

  return (
    <BrowserRouter>
      <AuthProvider env={config.env}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="areas" element={<AreasPensPage />} />
              <Route path="animals" element={<AnimalsPage />} />
              <Route path="movements" element={<MovementsPage />} />
              <Route path="litters" element={<LittersPage />} />
              <Route path="health" element={<HealthPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route
                path="users"
                element={
                  <RequireRole roles={['admin']}>
                    <UsersPage />
                  </RequireRole>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
