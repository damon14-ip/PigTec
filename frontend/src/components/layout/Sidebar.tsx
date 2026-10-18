import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '../../config/navigation';
import { useAuth } from '../../context/auth-context';
import { Icon } from '../icons';

export interface SidebarProps {
  /** `true` cuando el menu movil esta desplegado. */
  open: boolean;
  /** Cierra el menu tras navegar (util en movil). */
  onNavigate: () => void;
  /** Cierra el menu (overlay o tecla Escape). */
  onClose: () => void;
}

/**
 * Barra lateral de navegacion.
 *
 * En escritorio es fija y siempre visible. En movil se muestra como panel
 * deslizante con overlay; cuando esta cerrada no es accesible (fuera del orden de
 * tabulacion y del arbol de accesibilidad).
 *
 * Las entradas se filtran por el rol del perfil autorizado: el menu nunca ofrece
 * secciones para las que el backend no autorizaria.
 */
export function Sidebar({ open, onNavigate, onClose }: SidebarProps) {
  const { profile } = useAuth();

  const items = NAV_ITEMS.filter(
    (item) => profile !== null && item.roles.includes(profile.role),
  );

  return (
    <>
      <div
        className={`sidebar-overlay${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="app-sidebar"
        className={`sidebar${open ? ' is-open' : ''}`}
        aria-label="Navegación principal"
      >
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">
            <Icon name="pig" size={24} />
          </span>
          <span className="sidebar__brand-text">
            <strong>PigTec</strong>
            <small>Granja KolkaPig</small>
          </span>
        </div>

        <nav className="sidebar__nav">
          <ul className="sidebar__list">
            {items.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.path}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `sidebar__link${isActive ? ' is-active' : ''}`
                  }
                  title={item.description}
                >
                  <Icon name={item.icon} size={20} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <p className="sidebar__footer">
          FERCYT · UNAMBA
          <br />
          Sistema de gestión porcina
        </p>
      </aside>
    </>
  );
}
