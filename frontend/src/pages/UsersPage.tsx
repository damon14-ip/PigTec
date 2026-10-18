import { ModulePlaceholder } from '../components/ui/ModulePlaceholder';
import { Alert } from '../components/ui/Alert';

/** Sección "Usuarios" (solo admin). */
export function UsersPage() {
  return (
    <>
      <Alert variant="info" title="Sección exclusiva del administrador">
        Solo el rol <strong>Administrador</strong> puede gestionar usuarios. El
        registro público está deshabilitado: las cuentas se crean y se aprueban
        desde la administración.
      </Alert>

      <ModulePlaceholder
        title="Usuarios"
        description="Perfiles, roles y estado de acceso al sistema."
        phase="las siguientes etapas del Sprint 5"
        icon="users"
        planned={[
          'Listado de perfiles con su rol y estado (activo/inactivo).',
          'Asignación y cambio de rol bajo control administrativo.',
          'Activación y desactivación de cuentas.',
          'Auditoría de cambios de rol y de estado.',
        ]}
        note="Ningún usuario puede autoconcederse privilegios ni cambiar su propio rol."
      />
    </>
  );
}
