import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

export interface SessionErrorScreenProps {
  message: string | null;
  onRetry: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

/**
 * Pantalla mostrada cuando no se pudo verificar el perfil autorizado.
 *
 * No concede acceso a la aplicacion: solo permite reintentar o cerrar sesion.
 * Se usa tanto en rutas privadas como en la pantalla de acceso.
 */
export function SessionErrorScreen({
  message,
  onRetry,
  onSignOut,
}: SessionErrorScreenProps) {
  return (
    <div className="fullpage">
      <div className="fullpage__panel">
        <Alert variant="danger" title="No se pudo verificar tu perfil">
          {message ??
            'No se pudo comprobar tu perfil con el servidor de PigTec.'}
        </Alert>
        <div className="fullpage__actions">
          <Button variant="primary" onClick={() => void onRetry()}>
            Reintentar
          </Button>
          <Button variant="secondary" onClick={() => void onSignOut()}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}
