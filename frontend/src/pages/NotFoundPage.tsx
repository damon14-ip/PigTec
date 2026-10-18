import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Alert } from '../components/ui/Alert';

/** Pagina 404 para rutas no reconocidas. */
export function NotFoundPage() {
  return (
    <div className="page">
      <PageHeader
        title="Página no encontrada"
        description="La dirección solicitada no existe en PigTec."
      />
      <Alert variant="info">
        Vuelve al <Link to="/">dashboard</Link> para continuar.
      </Alert>
    </div>
  );
}
