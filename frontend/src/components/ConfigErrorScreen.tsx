import { Alert } from './ui/Alert';
import { Icon } from './icons';

/**
 * Pantalla mostrada cuando falta la configuracion del entorno del frontend.
 *
 * No incluye valores de variables: solo explica que hacer, para no filtrar
 * credenciales en la interfaz.
 */
export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="fullpage">
      <div className="fullpage__panel">
        <div className="fullpage__brand">
          <Icon name="pig" size={28} />
          <strong>PigTec</strong>
        </div>
        <Alert variant="danger" title="Configuración incompleta">
          {message}
        </Alert>
        <div className="fullpage__hint">
          <p>Pasos sugeridos:</p>
          <ol>
            <li>
              Copia <code>frontend/.env.example</code> a{' '}
              <code>frontend/.env.local</code>.
            </li>
            <li>Completa la URL de la API y las credenciales públicas de Supabase.</li>
            <li>Reinicia el servidor de desarrollo.</li>
          </ol>
          <p className="fullpage__note">
            Nunca incluyas claves privadas, <code>service_role</code> ni la clave
            de Groq en el frontend.
          </p>
        </div>
      </div>
    </div>
  );
}
