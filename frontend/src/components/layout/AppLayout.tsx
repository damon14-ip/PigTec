import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { AssistantWidget } from '../assistant/AssistantWidget';

/**
 * Estructura principal de las pantallas privadas.
 *
 * - Barra lateral fija en escritorio y panel deslizante en movil.
 * - Cabecera con la identidad del usuario y cierre de sesion.
 * - Contenido de la ruta activa.
 * - Asistente IA como boton flotante disponible en todas las pantallas privadas.
 *
 * Incluye el enlace "Saltar al contenido" para navegacion con teclado.
 */
export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Cierra el menu movil al cambiar de ruta.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Cierra el menu movil con la tecla Escape.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>

      <Sidebar
        open={menuOpen}
        onNavigate={closeMenu}
        onClose={closeMenu}
      />

      <div className="app-shell__body">
        <Header
          menuOpen={menuOpen}
          onOpenMenu={() => setMenuOpen(true)}
        />

        <main id="main-content" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <AssistantWidget />
    </div>
  );
}
