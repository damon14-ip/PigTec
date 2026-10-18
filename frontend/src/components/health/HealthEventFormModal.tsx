import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { OperationalRole } from '../../config/roles';
import {
  formatDateTimeLocal,
  isValidLocalDateTime,
  localDateTimeToIso,
} from '../../lib/dates';
import { ANIMAL_STATUS_LABELS, type Animal } from '../../services/animals.service';
import {
  HEALTH_EVENT_TYPE_LABELS,
  MORTALITY_EVENT_TYPE,
  admitsHealthEvents,
  healthEventTypeOptionsFor,
  type CreateHealthEventInput,
  type HealthEventType,
} from '../../services/health-events.service';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';

/** Límites alineados con el backend (`health-events.schemas.ts`). */
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const DOCUMENTED_BY_MAX = 200;
const ATTACHMENT_MAX = 2000;

export interface HealthEventFormModalProps {
  /** Rol del usuario autenticado: decide qué tipos de evento puede registrar. */
  role: OperationalRole;
  /** Catálogo de porcinos (solo se ofrecen los que admiten eventos). */
  animals: readonly Animal[];
  onClose: () => void;
  /** Registra el evento. Los errores los muestra la página contenedora. */
  onSubmit: (input: CreateHealthEventInput) => Promise<void>;
}

interface FieldErrors {
  animal?: string;
  eventType?: string;
  title?: string;
  occurredAt?: string;
  description?: string;
  documentedBy?: string;
  attachmentUrl?: string;
}

/**
 * Formulario "Registrar evento sanitario".
 *
 * Respeta el contrato real del backend:
 * - los tipos de evento disponibles dependen del rol (matriz 5.1): las
 *   observaciones/síntomas los registra cualquier rol operativo; los eventos
 *   clínicos, solo el veterinario; la mortalidad, admin/manager/veterinario;
 * - solo se ofrecen porcinos que admiten eventos (`active`/`missing`);
 * - `recorded_by` NO se envía: lo toma el backend del JWT;
 * - la mortalidad deriva el estado del porcino mediante un trigger de la base;
 *   el frontend solo avisa y nunca fija el estado.
 *
 * Antes de guardar se pide confirmación explícita (el historial es inmutable).
 */
export function HealthEventFormModal({
  role,
  animals,
  onClose,
  onSubmit,
}: HealthEventFormModalProps) {
  const [animalId, setAnimalId] = useState('');
  const [eventType, setEventType] = useState<HealthEventType | ''>('');
  const [title, setTitle] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [description, setDescription] = useState('');
  const [documentedBy, setDocumentedBy] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingInput, setPendingInput] = useState<CreateHealthEventInput | null>(
    null,
  );

  const typeOptions = useMemo(() => healthEventTypeOptionsFor(role), [role]);
  const admissibleAnimals = useMemo(
    () => animals.filter((animal) => admitsHealthEvents(animal.status)),
    [animals],
  );

  const selectedAnimal = animals.find((animal) => animal.id === animalId) ?? null;
  const isMortality = eventType === MORTALITY_EVENT_TYPE;

  /** Valida en el cliente y devuelve el cuerpo exacto del `POST`. */
  function buildInput(): CreateHealthEventInput | null {
    const next: FieldErrors = {};

    if (!selectedAnimal) {
      next.animal = 'Selecciona el porcino.';
    } else if (!admitsHealthEvents(selectedAnimal.status)) {
      next.animal =
        `El porcino no admite eventos sanitarios en estado ` +
        `${ANIMAL_STATUS_LABELS[selectedAnimal.status]}.`;
    }

    if (!eventType) {
      next.eventType = 'Selecciona el tipo de evento.';
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      next.title = 'Escribe un título para el evento.';
    } else if (trimmedTitle.length > TITLE_MAX) {
      next.title = `El título no puede superar ${TITLE_MAX} caracteres.`;
    }

    if (occurredAt && !isValidLocalDateTime(occurredAt)) {
      next.occurredAt = 'La fecha y hora indicada no es válida.';
    }

    if (description.trim().length > DESCRIPTION_MAX) {
      next.description =
        `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;
    }

    if (documentedBy.trim().length > DOCUMENTED_BY_MAX) {
      next.documentedBy =
        `El campo no puede superar ${DOCUMENTED_BY_MAX} caracteres.`;
    }

    if (attachmentUrl.trim().length > ATTACHMENT_MAX) {
      next.attachmentUrl =
        `La referencia no puede superar ${ATTACHMENT_MAX} caracteres.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0 || !eventType || !selectedAnimal) {
      return null;
    }

    const trimmedDescription = description.trim();
    const trimmedDocumentedBy = documentedBy.trim();
    const trimmedAttachment = attachmentUrl.trim();

    return {
      animal_id: animalId,
      event_type: eventType,
      title: trimmedTitle,
      ...(occurredAt ? { occurred_at: localDateTimeToIso(occurredAt) } : {}),
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      ...(trimmedDocumentedBy ? { documented_by: trimmedDocumentedBy } : {}),
      ...(trimmedAttachment ? { attachment_url: trimmedAttachment } : {}),
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

  function handleEventTypeChange(value: HealthEventType | ''): void {
    setEventType(value);
    if (errors.eventType) {
      setErrors((previous) => ({ ...previous, eventType: undefined }));
    }
  }

  const confirmMessage: ReactNode = (
    <>
      <p>Se registrará este evento sanitario:</p>
      <dl className="detail-grid">
        <div>
          <dt>Porcino</dt>
          <dd>{selectedAnimal?.animal_code ?? '—'}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{eventType ? HEALTH_EVENT_TYPE_LABELS[eventType] : '—'}</dd>
        </div>
        <div>
          <dt>Título</dt>
          <dd>{title.trim() || '—'}</dd>
        </div>
        <div>
          <dt>Fecha y hora</dt>
          <dd>
            {occurredAt
              ? formatDateTimeLocal(localDateTimeToIso(occurredAt))
              : 'Ahora (la fija el sistema)'}
          </dd>
        </div>
      </dl>
      {isMortality ? (
        <Alert variant="danger" title="Registro de mortalidad">
          Al registrar la mortalidad, el sistema marcará al porcino como
          «Fallecido», le asignará fecha de salida y lo dejará sin corral. No se
          puede revertir desde la interfaz.
        </Alert>
      ) : (
        <p>
          El historial sanitario es permanente: no se podrá editar ni eliminar
          después.
        </p>
      )}
    </>
  );

  return (
    <>
      <Modal
        title="Registrar evento sanitario"
        onClose={onClose}
        dismissable={!submitting && !pendingInput}
      >
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="health-animal">
              Porcino
            </label>
            <select
              id="health-animal"
              className="field__input"
              value={animalId}
              onChange={(event) => {
                setAnimalId(event.target.value);
                if (errors.animal) {
                  setErrors((previous) => ({ ...previous, animal: undefined }));
                }
              }}
            >
              <option value="">Selecciona un porcino…</option>
              {admissibleAnimals.map((animal) => (
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
            <p className="field__hint">
              {admissibleAnimals.length === 0
                ? 'No hay porcinos en estado que admita eventos sanitarios (activo o no localizado).'
                : 'Solo se ofrecen porcinos activos o no localizados: un porcino vendido, fallecido, transferido o dado de baja no admite nuevos eventos.'}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="health-event-type">
              Tipo de evento
            </label>
            <select
              id="health-event-type"
              className="field__input"
              value={eventType}
              onChange={(event) =>
                handleEventTypeChange(event.target.value as HealthEventType | '')
              }
            >
              <option value="">Selecciona el tipo…</option>
              {typeOptions.map((value) => (
                <option key={value} value={value}>
                  {HEALTH_EVENT_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            {errors.eventType ? (
              <p className="field__error" role="alert">
                {errors.eventType}
              </p>
            ) : null}
            <p className="field__hint">
              Los tipos disponibles dependen de tu rol (matriz de permisos).
            </p>
          </div>

          {isMortality ? (
            <Alert variant="danger" title="Mortalidad">
              Este evento marca al porcino como «Fallecido», le asigna fecha de
              salida y lo deja sin corral. Es una operación definitiva y no se
              puede deshacer desde la interfaz.
            </Alert>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="health-title">
              Título
            </label>
            <input
              id="health-title"
              className="field__input"
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(event) => {
                setTitle(event.target.value);
                if (errors.title) {
                  setErrors((previous) => ({ ...previous, title: undefined }));
                }
              }}
            />
            {errors.title ? (
              <p className="field__error" role="alert">
                {errors.title}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="health-occurred-at">
              Fecha y hora (opcional)
            </label>
            <input
              id="health-occurred-at"
              className="field__input"
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => {
                setOccurredAt(event.target.value);
                if (errors.occurredAt) {
                  setErrors((previous) => ({
                    ...previous,
                    occurredAt: undefined,
                  }));
                }
              }}
            />
            <p className="field__hint">
              Si se deja vacía, se usa la fecha y hora del sistema.
            </p>
            {errors.occurredAt ? (
              <p className="field__error" role="alert">
                {errors.occurredAt}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="health-description">
              Descripción (opcional)
            </label>
            <textarea
              id="health-description"
              className="field__input"
              rows={3}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => {
                setDescription(event.target.value);
                if (errors.description) {
                  setErrors((previous) => ({
                    ...previous,
                    description: undefined,
                  }));
                }
              }}
            />
            {errors.description ? (
              <p className="field__error" role="alert">
                {errors.description}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="health-documented-by">
              Documentado por (opcional)
            </label>
            <input
              id="health-documented-by"
              className="field__input"
              type="text"
              value={documentedBy}
              maxLength={DOCUMENTED_BY_MAX}
              onChange={(event) => {
                setDocumentedBy(event.target.value);
                if (errors.documentedBy) {
                  setErrors((previous) => ({
                    ...previous,
                    documentedBy: undefined,
                  }));
                }
              }}
            />
            <p className="field__hint">
              Quién documenta el evento (puede ser un profesional externo).
            </p>
            {errors.documentedBy ? (
              <p className="field__error" role="alert">
                {errors.documentedBy}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="health-attachment">
              Referencia o adjunto (opcional)
            </label>
            <input
              id="health-attachment"
              className="field__input"
              type="text"
              value={attachmentUrl}
              maxLength={ATTACHMENT_MAX}
              onChange={(event) => {
                setAttachmentUrl(event.target.value);
                if (errors.attachmentUrl) {
                  setErrors((previous) => ({
                    ...previous,
                    attachmentUrl: undefined,
                  }));
                }
              }}
            />
            <p className="field__hint">
              Enlace o referencia al documento clínico, si existe.
            </p>
            {errors.attachmentUrl ? (
              <p className="field__error" role="alert">
                {errors.attachmentUrl}
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
          title="Confirmar registro del evento"
          message={confirmMessage}
          confirmLabel="Registrar evento"
          confirmVariant={isMortality ? 'danger' : 'primary'}
          busy={submitting}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPendingInput(null)}
        />
      ) : null}
    </>
  );
}
