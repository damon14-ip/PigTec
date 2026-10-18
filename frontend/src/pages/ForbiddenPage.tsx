import { PageHeader } from '../components/ui/PageHeader';
import { Alert } from '../components/ui/Alert';

/**
 * Pagina mostrada cuando el perfil no tiene permiso para la seccion solicitada
 * (por ejemplo, un rol distinto de `admin` en `/users`).
 */
export function ForbiddenPage() {
  return (
    <div className="page">
      <PageHeader
        title="Acceso restringido"
        description="Tu rol no tiene permiso para ver esta sección."
      />
      <Alert variant="warning" title="Permiso insuficiente">
        Solicita acceso al administrador si necesitas esta sección. La
        autorización se comprueba en el servidor con el perfil de tu cuenta.
      </Alert>
    </div>
  );
}
