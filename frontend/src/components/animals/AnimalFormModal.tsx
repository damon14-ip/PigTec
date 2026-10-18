import { useMemo, useState, type FormEvent } from 'react';
import type { Area } from '../../services/areas.service';
import type { Pen } from '../../services/pens.service';
import {
  ANIMAL_ORIGINS,
  ANIMAL_ORIGIN_LABELS,
  ANIMAL_SEXES,
  ANIMAL_SEX_LABELS,
  type Animal,
  type AnimalOrigin,
  type AnimalSex,
  type CreateAnimalInput,
  type UpdateAnimalInput,
} from '../../services/animals.service';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/** Limites alineados con el backend (`animals.schemas.ts`). */
const EAR_TAG_MAX = 100;
const BREED_MAX = 200;
const NOTES_MAX = 2000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de calendario real en formato `YYYY-MM-DD` (rechaza p. ej. 2026-02-30). */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export interface AnimalFormModalProps {
  mode: 'create' | 'edit';
  /** Porcino a editar (solo en modo `edit`). */
  animal?: Animal;
  /** Areas para etiquetar los corrales con su ubicacion. */
  areas: readonly Area[];
  /** Corrales disponibles (el selector solo ofrece los activos). */
  pens: readonly Pen[];
  /**
   * Numero de porcinos registrados por corral (inventario ya cargado). Se usa
   * SOLO para advertir sobre la capacidad; nunca bloquea el guardado porque el
   * backend no impone esa regla (decision pendiente).
   */
  occupancy: ReadonlyMap<string, number>;
  onClose: () => void;
  onSubmit: (input: CreateAnimalInput | UpdateAnimalInput) => Promise<void>;
}

interface FieldErrors {
  earTag?: string;
  breed?: string;
  birthDate?: string;
  entryDate?: string;
  notes?: string;
}

/**
 * Formulario de alta/edicion de porcinos.
 *
 * El codigo PigTec (`animal_code`) NUNCA se edita: lo genera la base de datos.
 * En el alta se puede elegir el corral inicial (solo corrales ACTIVOS) y la
 * fecha de ingreso; en la edicion esos campos no se envian porque el backend los
 * reserva a los movimientos.
 */
export function AnimalFormModal({
  mode,
  animal,
  areas,
  pens,
  occupancy,
  onClose,
  onSubmit,
}: AnimalFormModalProps) {
  const isEdit = mode === 'edit';

  const [earTag, setEarTag] = useState(animal?.ear_tag_code ?? '');
  const [sex, setSex] = useState<AnimalSex>(animal?.sex ?? 'unknown');
  const [breed, setBreed] = useState(animal?.breed ?? '');
  const [birthDate, setBirthDate] = useState(animal?.birth_date ?? '');
  const [origin, setOrigin] = useState<AnimalOrigin | ''>(animal?.origin ?? '');
  const [penId, setPenId] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [notes, setNotes] = useState(animal?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const areaNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const area of areas) {
      map.set(area.id, area.name);
    }
    return map;
  }, [areas]);

  // Solo corrales ACTIVOS: los inactivos estan dados de baja logica y no se
  // ofrecen para un nuevo registro.
  const activePens = useMemo(
    () => pens.filter((pen) => pen.status === 'active'),
    [pens],
  );

  const selectedPen = activePens.find((pen) => pen.id === penId) ?? null;

  function penLabel(pen: Pen): string {
    const areaName = areaNameById.get(pen.area_id);
    const namePart = pen.name ? ` · ${pen.name}` : '';
    return areaName ? `${areaName} · ${pen.code}${namePart}` : `${pen.code}${namePart}`;
  }

  function validate(): CreateAnimalInput | null {
    const next: FieldErrors = {};
    const trimmedEarTag = earTag.trim();
    if (trimmedEarTag.length > EAR_TAG_MAX) {
      next.earTag = `El arete no puede superar ${EAR_TAG_MAX} caracteres.`;
    }

    const trimmedBreed = breed.trim();
    if (trimmedBreed.length > BREED_MAX) {
      next.breed = `La raza no puede superar ${BREED_MAX} caracteres.`;
    }

    if (birthDate && !isCalendarDate(birthDate)) {
      next.birthDate = 'La fecha de nacimiento no es una fecha válida.';
    }

    if (!isEdit && entryDate && !isCalendarDate(entryDate)) {
      next.entryDate = 'La fecha de ingreso no es una fecha válida.';
    }

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > NOTES_MAX) {
      next.notes = `Las notas no pueden superar ${NOTES_MAX} caracteres.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      return null;
    }

    const base: CreateAnimalInput = {
      ear_tag_code: trimmedEarTag || null,
      sex,
      breed: trimmedBreed || null,
      birth_date: birthDate || null,
      origin: origin || null,
      notes: trimmedNotes || null,
    };

    if (isEdit) {
      return base;
    }
    return {
      ...base,
      current_pen_id: penId || null,
      ...(entryDate ? { entry_date: entryDate } : {}),
    };
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

  /** Aviso de capacidad del corral elegido (nunca bloquea el guardado). */
  function renderCapacityNotice() {
    if (isEdit || !selectedPen) {
      return null;
    }
    const current = occupancy.get(selectedPen.id) ?? 0;
    const projected = current + 1;
    if (selectedPen.capacity === null) {
      return (
        <Alert variant="warning" title="Capacidad no registrada">
          Este corral no tiene capacidad registrada, así que no se puede
          verificar la disponibilidad. Puedes guardar de todos modos.
        </Alert>
      );
    }
    if (projected >= selectedPen.capacity) {
      return (
        <Alert variant="warning" title="Capacidad completa o superada">
          El corral <strong>{selectedPen.code}</strong> tiene {current} porcino
          {current === 1 ? '' : 's'} registrado{current === 1 ? '' : 's'} y una
          capacidad de {selectedPen.capacity}; al registrar este porcino se
          alcanzaría o superaría. El sistema no impide guardarlo porque la
          validación obligatoria de capacidad está pendiente de aprobación.
        </Alert>
      );
    }
    return (
      <Alert variant="info" title="Ocupación del corral">
        {current} de {selectedPen.capacity} lugares ocupados en{' '}
        {selectedPen.code}.
      </Alert>
    );
  }

  return (
    <Modal
      title={isEdit ? 'Editar porcino' : 'Nuevo porcino'}
      onClose={onClose}
      dismissable={!submitting}
    >
      <form className="form" onSubmit={handleSubmit} noValidate>
        {isEdit && animal ? (
          <div className="field">
            <span className="field__label">Código PigTec</span>
            <p className="field__static">
              <span className="code-chip">{animal.animal_code}</span>
            </p>
            <p className="field__hint">
              El código PigTec es único, permanente e inmutable: no se puede
              editar.
            </p>
          </div>
        ) : (
          <Alert variant="info" title="Código automático">
            El código PigTec (formato <strong>PIG-000000</strong>) lo genera el
            sistema al guardar y no se puede escribir manualmente.
          </Alert>
        )}

        <div className="field">
          <label className="field__label" htmlFor="animal-ear-tag">
            Arete (opcional)
          </label>
          <input
            id="animal-ear-tag"
            className="field__input"
            value={earTag}
            maxLength={EAR_TAG_MAX}
            onChange={(event) => {
              setEarTag(event.target.value);
              if (errors.earTag) {
                setErrors((prev) => ({ ...prev, earTag: undefined }));
              }
            }}
          />
          {errors.earTag ? (
            <p className="field__error" role="alert">
              {errors.earTag}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="animal-sex">
            Sexo
          </label>
          <select
            id="animal-sex"
            className="field__input"
            value={sex}
            onChange={(event) => setSex(event.target.value as AnimalSex)}
          >
            {ANIMAL_SEXES.map((value) => (
              <option key={value} value={value}>
                {ANIMAL_SEX_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="animal-breed">
            Raza (opcional)
          </label>
          <input
            id="animal-breed"
            className="field__input"
            value={breed}
            maxLength={BREED_MAX}
            onChange={(event) => {
              setBreed(event.target.value);
              if (errors.breed) {
                setErrors((prev) => ({ ...prev, breed: undefined }));
              }
            }}
          />
          {errors.breed ? (
            <p className="field__error" role="alert">
              {errors.breed}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="animal-birth-date">
            Fecha de nacimiento (opcional)
          </label>
          <input
            id="animal-birth-date"
            className="field__input"
            type="date"
            value={birthDate}
            onChange={(event) => {
              setBirthDate(event.target.value);
              if (errors.birthDate) {
                setErrors((prev) => ({ ...prev, birthDate: undefined }));
              }
            }}
          />
          {errors.birthDate ? (
            <p className="field__error" role="alert">
              {errors.birthDate}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="animal-origin">
            Origen
          </label>
          <select
            id="animal-origin"
            className="field__input"
            value={origin}
            onChange={(event) =>
              setOrigin(event.target.value as AnimalOrigin | '')
            }
          >
            <option value="">No registrado</option>
            {ANIMAL_ORIGINS.map((value) => (
              <option key={value} value={value}>
                {ANIMAL_ORIGIN_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {!isEdit ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="animal-pen">
                Corral inicial (opcional)
              </label>
              <select
                id="animal-pen"
                className="field__input"
                value={penId}
                onChange={(event) => setPenId(event.target.value)}
              >
                <option value="">Sin corral asignado</option>
                {activePens.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {penLabel(pen)}
                  </option>
                ))}
              </select>
              {activePens.length === 0 ? (
                <p className="field__hint">
                  No hay corrales activos. Puedes registrar el porcino sin
                  corral y asignarlo después con un movimiento.
                </p>
              ) : null}
            </div>

            {renderCapacityNotice()}

            <div className="field">
              <label className="field__label" htmlFor="animal-entry-date">
                Fecha de ingreso (opcional)
              </label>
              <input
                id="animal-entry-date"
                className="field__input"
                type="date"
                value={entryDate}
                onChange={(event) => {
                  setEntryDate(event.target.value);
                  if (errors.entryDate) {
                    setErrors((prev) => ({ ...prev, entryDate: undefined }));
                  }
                }}
              />
              <p className="field__hint">
                Si se deja vacía, se usa la fecha del día.
              </p>
              {errors.entryDate ? (
                <p className="field__error" role="alert">
                  {errors.entryDate}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor="animal-notes">
            Notas (opcional)
          </label>
          <textarea
            id="animal-notes"
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
