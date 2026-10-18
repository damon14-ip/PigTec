import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { OperationalRole } from '../../config/roles';
import { useAuth } from '../../context/auth-context';
import {
  ANIMAL_STATUS_LABELS,
  getAnimalLocation,
  type Animal,
  type AnimalLocation,
} from '../../services/animals.service';
import type { Area } from '../../services/areas.service';
import type { Pen } from '../../services/pens.service';
import {
  EXTERNAL_EXIT_REASONS,
  MOVEMENT_REASON_LABELS,
  admitsMovements,
  canRegisterExternalExit,
  movementReasonOptionsFor,
  type CreateMovementInput,
  type MovementReason,
} from '../../services/movements.service';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import {
  buildPenLabelMap,
  formatMovementDateTime,
  isValidLocalDateTime,
  localDateTimeToIso,
} from './labels';

/** Límite alineado con el backend (`movements.schemas.ts`, `notes`). */
const NOTES_MAX = 2000;

export interface MovementFormModalProps {
  /** Rol del usuario autenticado: decide qué motivos puede registrar. */
  role: OperationalRole;
  /** Catálogo de porcinos (para elegir el animal). */
  animals: readonly Animal[];
  /** Corrales (el destino solo ofrece los activos y con área activa). */
  pens: readonly Pen[];
  /** Áreas (para etiquetar el corral de origen y destino). */
  areas: readonly Area[];
  onClose: () => void;
  /** Registra el movimiento. Los errores los muestra la página contenedora. */
  onSubmit: (input: CreateMovementInput) => Promise<void>;
}

interface FieldErrors {
  animal?: string;
  reason?: string;
  destination?: string;
  movedAt?: string;
  notes?: string;
}

type LocationState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Formulario "Registrar movimiento".
 *
 * Se adapta dinámicamente al motivo elegido, siguiendo las reglas REALES del
 * backend:
 * - `sale` (venta): sin corral destino; el sistema deriva estado «Vendido».
 * - `transfer`: interno (con destino) o externo (sin destino, solo admin/manager).
 * - aislamiento sanitario: también lo puede registrar el veterinario.
 * - motivos internos: exigen corral destino distinto del actual.
 * - `from_pen_id` NUNCA se envía: el backend lo completa con la ubicación vigente.
 * - `recorded_by` NUNCA se envía: se toma del JWT.
 *
 * Antes de guardar se pide confirmación explícita, porque el historial es
 * inmutable (no se puede editar ni eliminar).
 */
export function MovementFormModal({
  role,
  animals,
  pens,
  areas,
  onClose,
  onSubmit,
}: MovementFormModalProps) {
  const { apiClient } = useAuth();

  const [animalId, setAnimalId] = useState('');
  const [reason, setReason] = useState<MovementReason | ''>('');
  const [externalTransfer, setExternalTransfer] = useState(false);
  const [toPenId, setToPenId] = useState('');
  const [movedAt, setMovedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingInput, setPendingInput] = useState<CreateMovementInput | null>(
    null,
  );
  const [locationState, setLocationState] = useState<LocationState>('idle');
  const [location, setLocation] = useState<AnimalLocation | null>(null);

  const reasonOptions = useMemo(() => movementReasonOptionsFor(role), [role]);
  const allowExternalTransfer = canRegisterExternalExit(role);
  const penLabels = useMemo(() => buildPenLabelMap(pens, areas), [pens, areas]);

  const selectedAnimal = animals.find((item) => item.id === animalId) ?? null;
  const isSale =
    reason !== '' && (EXTERNAL_EXIT_REASONS as readonly string[]).includes(reason);
  // El traslado SOLO puede ser externo (sin destino) si el rol lo permite; para
  // `operator` el traslado es siempre interno y exige corral destino.
  const isExternalExit =
    isSale || (reason === 'transfer' && allowExternalTransfer && externalTransfer);
  const requiresDestination = reason !== '' && !isExternalExit;

  /**
   * Corrales ofrecidos como destino: activos, con su área activa y distintos del
   * corral actual del porcino (el backend rechaza origen = destino).
   */
  const destinationPens = useMemo(() => {
    const areaStatusById = new Map(areas.map((area) => [area.id, area.status]));
    const originPenId = location?.current_pen_id ?? null;
    return pens.filter(
      (pen) =>
        pen.status === 'active' &&
        areaStatusById.get(pen.area_id) === 'active' &&
        pen.id !== originPenId,
    );
  }, [pens, areas, location]);

  useEffect(() => {
    if (!animalId) {
      setLocation(null);
      setLocationState('idle');
      return;
    }
    const controller = new AbortController();
    setLocationState('loading');
    getAnimalLocation(apiClient, animalId, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        setLocation(result);
        setLocationState('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setLocation(null);
        setLocationState('error');
      });
    return () => controller.abort();
  }, [apiClient, animalId]);

  function handleAnimalChange(value: string): void {
    setAnimalId(value);
    // El origen cambia con el animal: el destino elegido deja de ser válido.
    setToPenId('');
    setErrors((previous) => ({
      ...previous,
      animal: undefined,
      destination: undefined,
    }));
  }

  function handleReasonChange(value: MovementReason | ''): void {
    setReason(value);
    setExternalTransfer(false);
    setToPenId('');
    setErrors((previous) => ({
      ...previous,
      reason: undefined,
      destination: undefined,
    }));
  }

  const currentLocationLabel =
    locationState === 'ready' && location?.pen
      ? `${location.pen.area ? `${location.pen.area.name} · ` : ''}${location.pen.code}`
      : null;

  /** Valida en el cliente y devuelve el cuerpo exacto del `POST /movements`. */
  function buildInput(): CreateMovementInput | null {
    const next: FieldErrors = {};

    if (!selectedAnimal) {
      next.animal = 'Selecciona un porcino.';
    } else if (!admitsMovements(selectedAnimal.status)) {
      next.animal =
        `El porcino no admite movimientos en estado ` +
        `${ANIMAL_STATUS_LABELS[selectedAnimal.status]}.`;
    }

    if (!reason) {
      next.reason = 'Selecciona el tipo de movimiento.';
    }

    if (requiresDestination) {
      if (!toPenId) {
        next.destination = 'Selecciona el corral destino.';
      } else if (location?.current_pen_id === toPenId) {
        next.destination = 'El corral destino debe ser distinto del actual.';
      }
    }

    if (movedAt && !isValidLocalDateTime(movedAt)) {
      next.movedAt = 'La fecha y hora indicada no es válida.';
    }

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > NOTES_MAX) {
      next.notes = `Las observaciones no pueden superar ${NOTES_MAX} caracteres.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0 || !reason || !selectedAnimal) {
      return null;
    }

    return {
      animal_id: animalId,
      reason,
      to_pen_id: requiresDestination ? toPenId : null,
      ...(movedAt ? { moved_at: localDateTimeToIso(movedAt) } : {}),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting || pendingInput) {
      return;
    }
    const input = buildInput();
    if (!input) {
      return;
    }
    setPendingInput(input);
  }

  async function handleConfirm(): Promise<void> {
    if (!pendingInput || submitting) {
      return;
    }
    const input = pendingInput;
    setSubmitting(true);
    try {
      await onSubmit(input);
      setPendingInput(null);
    } finally {
      setSubmitting(false);
    }
  }

  const confirmMessage: ReactNode = (
    <>
      <p>Se registrará este movimiento:</p>
      <dl className="detail-grid">
        <div>
          <dt>Porcino</dt>
          <dd>{selectedAnimal?.animal_code ?? '—'}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{reason ? MOVEMENT_REASON_LABELS[reason] : '—'}</dd>
        </div>
        <div>
          <dt>Origen</dt>
          <dd>
            {currentLocationLabel ??
              (locationState === 'ready'
                ? 'Sin corral asignado'
                : 'La ubicación vigente del porcino')}
          </dd>
        </div>
        <div>
          <dt>Destino</dt>
          <dd>
            {requiresDestination
              ? penLabels.get(toPenId) ?? '—'
              : 'Salida de la granja'}
          </dd>
        </div>
        <div>
          <dt>Fecha y hora</dt>
          <dd>
            {movedAt
              ? formatMovementDateTime(localDateTimeToIso(movedAt))
              : 'Ahora (la fija el sistema)'}
          </dd>
        </div>
      </dl>
      <p>
        El historial de movimientos es permanente: no se podrá editar ni eliminar
        después.
      </p>
    </>
  );

  return (
    <>
      <Modal
        title="Registrar movimiento"
        onClose={onClose}
        dismissable={!submitting && !pendingInput}
      >
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="movement-animal">
              Porcino
            </label>
            <select
              id="movement-animal"
              className="field__input"
              value={animalId}
              onChange={(event) => handleAnimalChange(event.target.value)}
            >
              <option value="">Selecciona un porcino…</option>
              {animals.map((animal) => (
                <option key={animal.id} value={animal.id}>
                  {animal.animal_code}
                  {animal.ear_tag_code ? ` · Arete ${animal.ear_tag_code}` : ''}
                  {` · ${ANIMAL_STATUS_LABELS[animal.status]}`}
                </option>
              ))}
            </select>
            {errors.animal ? (
              <p className="field__error" role="alert">
                {errors.animal}
              </p>
            ) : null}
            {animals.length === 0 ? (
              <p className="field__hint">
                No hay porcinos registrados todavía.
              </p>
            ) : null}
          </div>

          {animalId ? (
            <div className="field">
              <span className="field__label">Ubicación actual</span>
              <p className="field__static">
                {locationState === 'loading'
                  ? 'Consultando…'
                  : locationState === 'error'
                    ? 'No se pudo consultar'
                    : currentLocationLabel ?? 'Sin corral asignado'}
              </p>
              <p className="field__hint">
                El corral de origen lo registra el sistema con la ubicación
                vigente del porcino; no se elige manualmente.
              </p>
              {locationState === 'error' ? (
                <p className="field__hint">
                  No se pudo confirmar la ubicación; el sistema la validará al
                  guardar.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="movement-reason">
              Tipo de movimiento
            </label>
            <select
              id="movement-reason"
              className="field__input"
              value={reason}
              onChange={(event) =>
                handleReasonChange(event.target.value as MovementReason | '')
              }
            >
              <option value="">Selecciona el tipo…</option>
              {reasonOptions.map((value) => (
                <option key={value} value={value}>
                  {MOVEMENT_REASON_LABELS[value]}
                </option>
              ))}
            </select>
            {errors.reason ? (
              <p className="field__error" role="alert">
                {errors.reason}
              </p>
            ) : null}
            <p className="field__hint">
              Los tipos disponibles dependen de tu rol.
            </p>
          </div>

          {reason === 'transfer' && allowExternalTransfer ? (
            <div className="field">
              <label
                className="field__checkbox"
                htmlFor="movement-transfer-external"
              >
                <input
                  id="movement-transfer-external"
                  type="checkbox"
                  checked={externalTransfer}
                  onChange={(event) => {
                    setExternalTransfer(event.target.checked);
                    setToPenId('');
                    setErrors((previous) => ({
                      ...previous,
                      destination: undefined,
                    }));
                  }}
                />
                <span>
                  El animal sale de la granja (transferencia externa, sin corral
                  destino)
                </span>
              </label>
            </div>
          ) : null}

          {reason === 'sale' ? (
            <Alert variant="info" title="Venta (salida de la granja)">
              La venta no lleva corral destino. El sistema registrará la salida,
              la fecha de salida y dejará el porcino como «Vendido» y sin corral.
            </Alert>
          ) : null}

          {reason === 'transfer' && isExternalExit ? (
            <Alert variant="warning" title="Transferencia externa">
              El porcino quedará como «Transferido» y sin corral. Queda
              registrado en el historial de trazabilidad.
            </Alert>
          ) : null}

          {reason === 'health_isolation' ? (
            <Alert variant="info" title="Aislamiento sanitario">
              Indica el corral de aislamiento. Este motivo también lo puede
              registrar el personal veterinario.
            </Alert>
          ) : null}

          {requiresDestination ? (
            <div className="field">
              <label className="field__label" htmlFor="movement-destination">
                Corral destino
              </label>
              <select
                id="movement-destination"
                className="field__input"
                value={toPenId}
                onChange={(event) => {
                  setToPenId(event.target.value);
                  if (errors.destination) {
                    setErrors((previous) => ({
                      ...previous,
                      destination: undefined,
                    }));
                  }
                }}
              >
                <option value="">Selecciona el corral destino…</option>
                {destinationPens.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {penLabels.get(pen.id) ?? pen.code}
                  </option>
                ))}
              </select>
              {errors.destination ? (
                <p className="field__error" role="alert">
                  {errors.destination}
                </p>
              ) : null}
              {destinationPens.length === 0 ? (
                <p className="field__hint">
                  No hay corrales activos disponibles como destino (se excluye el
                  corral actual del porcino).
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="movement-moved-at">
              Fecha y hora (opcional)
            </label>
            <input
              id="movement-moved-at"
              className="field__input"
              type="datetime-local"
              value={movedAt}
              onChange={(event) => {
                setMovedAt(event.target.value);
                if (errors.movedAt) {
                  setErrors((previous) => ({ ...previous, movedAt: undefined }));
                }
              }}
            />
            <p className="field__hint">
              Si se deja vacía, se usa la fecha y hora del sistema.
            </p>
            {errors.movedAt ? (
              <p className="field__error" role="alert">
                {errors.movedAt}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="movement-notes">
              Observaciones (opcional)
            </label>
            <textarea
              id="movement-notes"
              className="field__input"
              rows={3}
              value={notes}
              maxLength={NOTES_MAX}
              onChange={(event) => {
                setNotes(event.target.value);
                if (errors.notes) {
                  setErrors((previous) => ({ ...previous, notes: undefined }));
                }
              }}
            />
            {errors.notes ? (
              <p className="field__error" role="alert">
                {errors.notes}
              </p>
            ) : null}
          </div>

          <div className="modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Continuar
            </Button>
          </div>
        </form>
      </Modal>

      {pendingInput ? (
        <ConfirmDialog
          title="Confirmar registro del movimiento"
          message={confirmMessage}
          confirmLabel="Registrar movimiento"
          confirmVariant="primary"
          busy={submitting}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPendingInput(null)}
        />
      ) : null}
    </>
  );
}
