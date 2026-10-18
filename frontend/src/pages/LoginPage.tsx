import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/auth-context';
import { AuthError } from '../services/auth.service';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/icons';

/**
 * Pantalla de inicio de sesion.
 *
 * - Autentica con Supabase Auth (correo y contrasena).
 * - El backend valida despues el perfil autorizado (`GET /auth/profile`).
 * - NO existe registro publico: las cuentas las crea el administrador.
 */
export function LoginPage() {
  const { signIn, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      setError(
        caught instanceof AuthError
          ? caught.message
          : 'No se pudo iniciar sesión. Intenta de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <section className="login__brand" aria-hidden="true">
        <div className="login__brand-inner">
          <span className="login__logo">
            <Icon name="pig" size={32} />
          </span>
          <h1 className="login__brand-title">PigTec</h1>
          <p className="login__brand-subtitle">
            Gestión y trazabilidad porcina para la granja KolkaPig
          </p>
          <ul className="login__features">
            <li>Registro de porcinos, movimientos, camadas y sanidad</li>
            <li>Acceso por roles con permisos diferenciados</li>
            <li>Asistente de consulta de solo lectura</li>
          </ul>
          <p className="login__brand-footer">FERCYT · UNAMBA</p>
        </div>
      </section>

      <section className="login__form-wrapper">
        <div className="login__form-card">
          <header className="login__form-header">
            <h2 className="login__form-title">Iniciar sesión</h2>
            <p className="login__form-subtitle">
              Usa la cuenta asignada por el administrador de PigTec.
            </p>
          </header>

          {notice ? (
            <Alert variant="info" title="Aviso">
              {notice}
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="danger" title="No se pudo iniciar sesión">
              {error}
            </Alert>
          ) : null}

          <form className="login__form" onSubmit={handleSubmit} noValidate>
            <label className="field" htmlFor="login-email">
              <span className="field__label">Correo electrónico</span>
              <input
                id="login-email"
                className="field__input"
                type="email"
                name="email"
                value={email}
                autoComplete="email"
                required
                disabled={submitting}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nombre@ejemplo.com"
              />
            </label>

            <label className="field" htmlFor="login-password">
              <span className="field__label">Contraseña</span>
              <input
                id="login-password"
                className="field__input"
                type="password"
                name="password"
                value={password}
                autoComplete="current-password"
                required
                disabled={submitting}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </label>

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={submitting}
              disabled={submitting || email.trim() === '' || password === ''}
            >
              {submitting ? 'Verificando…' : 'Entrar'}
            </Button>
          </form>

          <p className="login__hint">
            El registro público está deshabilitado. Si no tienes acceso,
            solicítalo al administrador de la granja.
          </p>
        </div>
      </section>
    </div>
  );
}
