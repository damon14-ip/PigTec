import { useState, type FormEvent } from 'react';
import type { Area } from '../../services/areas.service';
import type {
  CreatePenInput,
  Pen,
  UpdatePenInput,
} from '../../services/pens.service';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/** Limites alineados con el backend (`pens.schemas.ts`). */
const CODE_MAX = 50;
const NAME_MAX = 200;
const NOTES_MAX = 2000;

export interface PenFormModalProps {
  mode: 'create' | 'edit';
  /** Corral a editar (solo en modo `edit`). */
  pen?: Pen;
  /** Todas las areas: alimentan el desplegable y el nombre del area actual. */
  areas: readonly Area[];
  onClose: () => void;
  onSubmit: (input: CreatePenInput | UpdatePenInput) => Promise<void>;
}

interface FieldErrors {
  area?: string;
  code?: string;
  name?: string;
  capacity?: string;
  notes?: string;
}

interface PenValues {
  code: string;
  name: string | null;
  capacity: number | null;
  notes: string | null;
}

/**
 * Formulario de alta/edicion de corrales.
 *
 * En modo edicion el area NO se puede cambiar (el backend no acepta `area_id`
 * en `PATCH /pens/:id`); se muestra solo su nombre. La capacidad es opcional:
 * si se deja vacia, se envia `null`.
 */
export function PenFormModal({
  mode,
  pen,
  areas,
  onClose,
  onSubmit,
}: PenFormModalProps) {
  const isEdit = mode === 'edit';
  const [areaId, setAreaId] = useState('');
  const [code, setCode] = useState(pen?.code ?? '');
  const [name, setName] = useState(pen?.name ?? '');
  const [capacity, setCapacity] = useState(
    pen?.capacity === null || pen?.capacity === undefined
      ? ''
      : String(pen.capacity),
  );
  const [notes, setNotes] = useState(pen?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const activeAreas = areas.filter((area) => area.status === 'active');
  const currentAreaName =
    areas.find((area) => area.id === pen?.area_id)?.name ?? 'Área no disponible';

  function validate(): PenValues | null {
    const next: FieldErrors = {};

    if (!isEdit && areaId === '') {
      next.area = 'Selecciona un área.';
    }

    const trimmedCode = code.trim();
    if (trimmedCode.length === 0) {
      next.code = 'El código es obligatorio.';
    } else if (trimmedCode.length > CODE_MAX) {
      next.code = `El código no puede superar ${CODE_MAX} caracteres.`;
    }

    const trimmedName = name.trim();
    if (trimmedName.length > NAME_MAX) {
      next.name = `El nombre no puede superar ${NAME_MAX} caracteres.`;
    }

    const trimmedCapacity = capacity.trim();
    let parsedCapacity: number | null = null;
    if (trimmedCapacity.length > 0) {
      if (!/^\d+$/.test(trimmedCapacity)) {
        next.capacity = 'La capacidad debe ser un número entero igual o mayor que 0.';
      } else {
        parsedCapacity = Number(trimmedCapacity);
        if (!Number.isSafeInteger(parsedCapacity)) {
          next.capacity = 'La capacidad es demasiado grande.';
        }
      }
    }

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > NOTES_MAX) {
      next.notes = `Las notas no pueden superar ${NOTES_MAX} caracteres.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      return null;
    }

    return {
      code: trimmedCode,
      name: trimmedName || null,
      capacity: parsedCapacity,
      notes: trimmedNotes || null,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const values = validate();
    if (!values) {
      return;
    }

    const input: CreatePenInput | UpdatePenInput = isEdit
      ? values
      : { area_id: areaId, ...values };

    setSubmitting(true);
    try {
      await onSubmit(input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={isEdit ? 'Editar corral' : 'Nuevo corral'}
      onClose={onClose}
      dismissable={!submitting}
    >
      <form className="form" onSubmit={handleSubmit} noValidate>
        {isEdit ? (
          <div className="field">
            <span className="field__label">Área</span>
            <p className="field__static">{currentAreaName}</p>
            <p className="field__hint">
              El área de un corral no se reasigna en esta etapa.
            </p>
          </div>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor="pen-form-area">
              Área
            </label>
            <select
              id="pen-form-area"
              className="field__input"
              value={areaId}
              onChange={(event) => {
                setAreaId(event.target.value);
                if (errors.area) {
                  setErrors((prev) => ({ ...prev, area: undefined }));
                }
              }}
            >
              <option value="">Selecciona un área…</option>
              {activeAreas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
            {activeAreas.length === 0 ? (
              <p className="field__hint">
                No hay áreas activas. Registra un área antes de crear corrales.
              </p>
            ) : null}
            {errors.area ? (
              <p className="field__error" role="alert">
                {errors.area}
              </p>
            ) : null}
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="pen-code">
            Código
          </label>
          <input
            id="pen-code"
            className="field__input"
            value={code}
            maxLength={CODE_MAX}
            placeholder="p. ej. C-01"
            onChange={(event) => {
              setCode(event.target.value);
              if (errors.code) {
                setErrors((prev) => ({ ...prev, code: undefined }));
              }
            }}
          />
          {errors.code ? (
            <p className="field__error" role="alert">
              {errors.code}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pen-name">
            Nombre (opcional)
          </label>
          <input
            id="pen-name"
            className="field__input"
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) {
                setErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
          />
          {errors.name ? (
            <p className="field__error" role="alert">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pen-capacity">
            Capacidad (opcional, porcinos)
          </label>
          <input
            id="pen-capacity"
            className="field__input"
            inputMode="numeric"
            value={capacity}
            placeholder="Sin registrar"
            onChange={(event) => {
              setCapacity(event.target.value);
              if (errors.capacity) {
                setErrors((prev) => ({ ...prev, capacity: undefined }));
              }
            }}
          />
          {errors.capacity ? (
            <p className="field__error" role="alert">
              {errors.capacity}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pen-notes">
            Notas (opcional)
          </label>
          <textarea
            id="pen-notes"
            className="field__input"
            rows={3}
            value={notes}
            maxLength={NOTES_MAX}
            onChange={(event) => {
              setNotes(event.target.value);
              if (errors.notes) {
                setErrors((prev) => ({ ...prev, notes: undefined }));
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
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
