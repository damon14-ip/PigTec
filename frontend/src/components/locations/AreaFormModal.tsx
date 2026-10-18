import { useState, type FormEvent } from 'react';
import type {
  Area,
  CreateAreaInput,
  UpdateAreaInput,
} from '../../services/areas.service';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/** Limites alineados con el backend (`areas.schemas.ts`). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

export interface AreaFormModalProps {
  mode: 'create' | 'edit';
  /** Area a editar (solo en modo `edit`). */
  area?: Area;
  onClose: () => void;
  /**
   * Ejecuta la operacion. La funcion padre cierra la ventana si tiene exito y
   * muestra la notificacion de error si falla.
   */
  onSubmit: (input: CreateAreaInput | UpdateAreaInput) => Promise<void>;
}

interface FieldErrors {
  name?: string;
  description?: string;
}

/**
 * Formulario de alta/edicion de areas. Valida con las MISMAS reglas que el
 * backend (nombre obligatorio y maximo 200; descripcion opcional maximo 2000),
 * pero el backend sigue siendo la autoridad final.
 */
export function AreaFormModal({
  mode,
  area,
  onClose,
  onSubmit,
}: AreaFormModalProps) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(area?.name ?? '');
  const [description, setDescription] = useState(area?.description ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): CreateAreaInput | null {
    const next: FieldErrors = {};
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      next.name = 'El nombre es obligatorio.';
    } else if (trimmedName.length > NAME_MAX) {
      next.name = `El nombre no puede superar ${NAME_MAX} caracteres.`;
    }

    const trimmedDescription = description.trim();
    if (trimmedDescription.length > DESCRIPTION_MAX) {
      next.description = `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      return null;
    }
    return { name: trimmedName, description: trimmedDescription || null };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const input = validate();
    if (!input) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={isEdit ? 'Editar área' : 'Nueva área'}
      onClose={onClose}
      dismissable={!submitting}
    >
      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="area-name">
            Nombre
          </label>
          <input
            id="area-name"
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
          <label className="field__label" htmlFor="area-description">
            Descripción (opcional)
          </label>
          <textarea
            id="area-description"
            className="field__input"
            rows={3}
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(event) => {
              setDescription(event.target.value);
              if (errors.description) {
                setErrors((prev) => ({ ...prev, description: undefined }));
              }
            }}
          />
          {errors.description ? (
            <p className="field__error" role="alert">
              {errors.description}
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
