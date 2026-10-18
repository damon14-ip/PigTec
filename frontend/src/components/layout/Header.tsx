import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../../config/navigation';
import { roleLabel } from '../../config/roles';
import { useAuth } from '../../context/auth-context';
import { Button } from '../ui/Button';
import { Icon } from '../icons';

export interface HeaderProps {
  menuOpen: boolean;
  onOpenMenu: () => void;
}

/** Deduce el titulo de la pagina a partir de la ruta actual. */
function usePageTitle(): string {
  const { pathname } = useLocation();
  const match = NAV_ITEMS.find((item) =>
    item.end ? item.path === pathname : pathname.startsWith(item.path),
  );
  return match ? match.label : 'PigTec';
}

/**
 * Cabecera de la aplicacion: boton de menu (movil), titulo de la seccion,
 * identidad del usuario con su rol y cierre de sesion.
 *
 * Se muestra el correo del usuario porque es el unico dato de identidad que
 * expone la API (`GET /auth/me`); no se inventa un nombre que no exista.
 */
export function Header({ menuOpen, onOpenMenu }: HeaderProps) {
  const { email, profile, signOut } = useAuth();
  const title = usePageTitle();

  return (
    <header className="app-header">
      <button
        type="button"
        className="app-header__menu"
        onClick={onOpenMenu}
        aria-label="Abrir menú de navegación"
        aria-controls="app-sidebar"
        aria-expanded={menuOpen}
      >
        <Icon name="menu" size={22} />
      </button>

      <div className="app-header__heading">
        <p className="app-header__eyebrow">KolkaPig</p>
        <h1 className="app-header__title">{title}</h1>
      </div>

      <div className="app-header__user">
        <div className="user-chip">
          <span className="user-chip__email" title={email ?? undefined}>
            {email ?? 'Sesión activa'}
          </span>
          {profile ? (
            <span className={`badge badge--role badge--${profile.role}`}>
              {roleLabel(profile.role)}
            </span>
          ) : null}
        </div>

        <Button
          variant="ghost"
          icon={<Icon name="logout" size={18} />}
          onClick={() => void signOut()}
        >
          Salir
        </Button>
      </div>
    </header>
  );
}
