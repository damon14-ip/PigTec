/** Indicador de carga circular accesible. */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="presentation"
      aria-hidden="true"
    />
  );
}

/**
 * Pantalla completa de carga. Se usa mientras se comprueba la sesion para no
 * mostrar contenido privado antes de autorizar.
 */
export function FullPageLoader({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="fullpage" role="status" aria-live="polite">
      <div className="fullpage__box">
        <Spinner size={28} />
        <p className="fullpage__label">{label}</p>
      </div>
    </div>
  );
}
