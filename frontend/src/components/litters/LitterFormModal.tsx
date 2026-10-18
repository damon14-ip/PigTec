import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { formatCalendarDate, isValidCalendarDate } from '../../lib/dates';
import type { Animal } from '../../services/animals.service';
import type {
  CreateLitterInput,
  Litter,
  UpdateLitterInput,
} from '../../services/litters.service';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';

/** Límites alineados con el backend (`litters.schemas.ts`). */
const CODE_MAX = 100;
const NOTES_MAX = 2000;

export interface LitterFormModalProps {
  mode: 'create' | 'edit';
  /** Camada a editar (solo en modo `edit`). */
  litter?: Litter;
  /** Catálogo de porcinos (para elegir madre y padre y mostrar códigos). */
  animals: readonly Animal[];
  onClose: () => void;
  /** Registra o edita la camada. Los errores los muestra la página contenedora. */
  onSubmit: (input: CreateLitterInput | UpdateLitterInput) => Promise<void>;
}

interface FieldErrors {
  mother?: string;
  father?: string;
  litterCode?: string;
  birthDate?: string;
  totalBorn?: string;
  bornAlive?: string;
  stillborn?: string;
  notes?: string;
}

/** Resultado de interpretar un campo numérico opcional. */
type ParsedCount =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number };

/** Interpreta un campo de cantidad entera no negativa (vacío permitido). */
function parseCount(raw: string): ParsedCount {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { kind: 'empty' };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { kind: 'invalid' };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { kind: 'invalid' };
  }
  return { kind: 'value', value };
}

/**
 * Formulario "Registrar camada" / "Editar camada".
 *
 * Respeta el contrato real del backend:
 * - la madre es obligatoria al registrar y debe ser hembra;
 * - el padre es opcional y, si se indica, debe ser macho;
 * - las cantidades son enteras y no superan `total_born`;
 * - NO crea porcinos individuales a partir de la camada (el backend no lo
 *   contempla): solo registra los conteos del parto.
 *
 * Antes de guardar se pide confirmación explícita.
 */
export function LitterFormModal({
  mode,
  litter,
  animals,
  onClose,
  onSubmit,
}: LitterFormModalProps) {
  const [litterCode, setLitterCode] = useState(litter?.litter_code ?? '');
  const [motherId, setMotherId] = useState(litter?.mother_id ?? '');
  const [fatherId, setFatherId] = useState(litter?.father_id ?? '');
  const [birthDate, setBirthDate] = useState(litter?.birth_date ?? '');
  const [totalBorn, setTotalBorn] = useState(
    litter?.total_born !== null && litter?.total_born !== undefined
      ? String(litter.total_born)
      : '',
  );
  const [bornAlive, setBornAlive] = useState(
    litter?.born_alive !== null && litter?.born_alive !== undefined
      ? String(litter.born_alive)
      : '',
  );
  const [stillborn, setStillborn] = useState(
    litter?.stillborn !== null && litter?.stillborn !== undefined
      ? String(litter.stillborn)
      : '',
  );
  const [notes, setNotes] = useState(litter?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingInput, setPendingInput] = useState<
    CreateLitterInput | UpdateLitterInput | null
  >(null);

  const mothers = useMemo(
    () => animals.filter((animal) => animal.sex === 'female'),
    [animals],
  );
  const fathers = useMemo(
    () => animals.filter((animal) => animal.sex === 'male'),
    [animals],
  );

  const motherRequired = mode === 'create';
  const selectedMother = animals.find((animal) => animal.id === motherId) ?? null;
  const selectedFather = animals.find((animal) => animal.id === fatherId) ?? null;

  /** Valida en el cliente y devuelve el cuerpo exacto del `POST`/`PATCH`. */
  function buildInput(): CreateLitterInput | UpdateLitterInput | null {
    const next: FieldErrors = {};

    if (motherRequired && !motherId) {
      next.mother = 'Selecciona la madre de la camada.';
    }

    if (litterCode.trim().length > CODE_MAX) {
      next.litterCode = `El código no puede superar ${CODE_MAX} caracteres.`;
    }

    if (birthDate && !isValidCalendarDate(birthDate)) {
      next.birthDate = 'La fecha del parto no es válida.';
    }

    const total = parseCount(totalBorn);
    const alive = parseCount(bornAlive);
    const dead = parseCount(stillborn);

    if (total.kind === 'invalid') {
      next.totalBorn = 'La cantidad debe ser un número entero no negativo.';
    }
    if (alive.kind === 'invalid') {
      next.bornAlive = 'La cantidad debe ser un número entero no negativo.';
    }
    if (dead.kind === 'invalid') {
      next.stillborn = 'La cantidad debe ser un número entero no negativo.';
    }

    if (total.kind === 'value') {
      if (alive.kind === 'value' && alive.value > total.value) {
        next.bornAlive = 'Los vivos no pueden superar el total de nacidos.';
      }
      if (dead.kind === 'value' && dead.value > total.value) {
        next.stillborn = 'Los muertos no pueden superar el total de nacidos.';
      }
    }

    if (notes.trim().length > NOTES_MAX) {
      next.notes = `Las observaciones no pueden superar ${NOTES_MAX} caracteres.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      return null;
    }

    const trimmedCode = litterCode.trim();
    const trimmedNotes = notes.trim();

    if (mode === 'create') {
      if (!motherId) {
        return null;
      }
      return {
        mother_id: motherId,
        ...(trimmedCode ? { litter_code: trimmedCode } : {}),
        ...(fatherId ? { father_id: fatherId } : {}),
        ...(birthDate ? { birth_date: birthDate } : {}),
        ...(total.kind === 'value' ? { total_born: total.value } : {}),
        ...(alive.kind === 'value' ? { born_alive: alive.value } : {}),
        ...(dead.kind === 'value' ? { stillborn: dead.value } : {}),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      };
    }

    // Edición: los campos vacíos se envían como `null` para poder limpiarlos.
    return {
      litter_code: trimmedCode === '' ? null : trimmedCode,
      ...(motherId ? { mother_id: motherId } : {}),
      father_id: fatherId === '' ? null : fatherId,
      birth_date: birthDate === '' ? null : birthDate,
      total_born: total.kind === 'value' ? total.value : null,
      born_alive: alive.kind === 'value' ? alive.value : null,
      stillborn: dead.kind === 'value' ? dead.value : null,
      notes: trimmedNotes === '' ? null : trimmedNotes,
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
      <p>
        {mode === 'create'
          ? 'Se registrará esta camada:'
          : 'Se guardarán estos cambios en la camada:'}
      </p>
      <dl className="detail-grid">
        <div>
          <dt>Código</dt>
          <dd>{litterCode.trim() || 'Sin código'}</dd>
        </div>
        <div>
          <dt>Madre</dt>
          <dd>{selectedMother?.animal_code ?? '—'}</dd>
        </div>
        <div>
          <dt>Padre</dt>
          <dd>{selectedFather?.animal_code ?? 'Sin registrar'}</dd>
        </div>
        <div>
          <dt>Fecha del parto</dt>
          <dd>{birthDate ? formatCalendarDate(birthDate) : 'No registrada'}</dd>
        </div>
        <div>
          <dt>Nacidos / vivos / muertos</dt>
          <dd>
            {totalBorn.trim() || '—'} / {bornAlive.trim() || '—'} /{' '}
            {stillborn.trim() || '—'}
          </dd>
        </div>
      </dl>
      <p>
        La camada no se elimina y no crea porcinos individuales: los lechones se
        asocian a la camada desde el módulo de porcinos.
      </p>
    </>
  );

  return (
    <>
      <Modal
        title={mode === 'create' ? 'Registrar camada' : 'Editar camada'}
        onClose={onClose}
        dismissable={!submitting && !pendingInput}
      >
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="litter-mother">
              {motherRequired ? 'Madre' : 'Madre (opcional)'}
            </label>
            <select
              id="litter-mother"
              className="field__input"
              value={motherId}
              onChange={(event) => {
                setMotherId(event.target.value);
                if (errors.mother) {
                  setErrors((previous) => ({ ...previous, mother: undefined }));
                }
              }}
            >
              <option value="">
                {motherRequired ? 'Selecciona la madre…' : 'Sin cambios'}
              </option>
              {mothers.map((animal) => (
                <option key={animal.id} value={animal.id}>
                  {animal.animal_code}
                  {animal.ear_tag_code ? ` · Arete ${animal.ear_tag_code}` : ''}
                </option>
              ))}
            </select>
            {errors.mother ? (
              <p className="field__error" role="alert">
                {errors.mother}
              </p>
            ) : null}
            <p className="field__hint">
              {mothers.length === 0
                ? 'No hay porcinos hembra registrados todavía.'
                : 'Solo se ofrecen porcinos de sexo hembra (regla del backend).'}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="litter-father">
              Padre (opcional)
            </label>
            <select
              id="litter-father"
              className="field__input"
              value={fatherId}
              onChange={(event) => {
                setFatherId(event.target.value);
                if (errors.father) {
                  setErrors((previous) => ({ ...previous, father: undefined }));
                }
              }}
            >
              <option value="">Sin registrar</option>
              {fathers.map((animal) => (
                <option key={animal.id} value={animal.id}>
                  {animal.animal_code}
                  {animal.ear_tag_code ? ` · Arete ${animal.ear_tag_code}` : ''}
                </option>
              ))}
            </select>
            <p className="field__hint">
              Solo se ofrecen porcinos de sexo macho (regla del backend).
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="litter-code">
              Código de camada (opcional)
            </label>
            <input
              id="litter-code"
              className="field__input"
              type="text"
              value={litterCode}
              maxLength={CODE_MAX}
              onChange={(event) => {
                setLitterCode(event.target.value);
                if (errors.litterCode) {
                  setErrors((previous) => ({
                    ...previous,
                    litterCode: undefined,
                  }));
                }
              }}
            />
            {errors.litterCode ? (
              <p className="field__error" role="alert">
                {errors.litterCode}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="litter-birth-date">
              Fecha del parto (opcional)
            </label>
            <input
              id="litter-birth-date"
              className="field__input"
              type="date"
              value={birthDate}
              onChange={(event) => {
                setBirthDate(event.target.value);
                if (errors.birthDate) {
                  setErrors((previous) => ({
                    ...previous,
                    birthDate: undefined,
                  }));
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
            <label className="field__label" htmlFor="litter-total-born">
              Total nacidos
            </label>
            <input
              id="litter-total-born"
              className="field__input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={totalBorn}
              onChange={(event) => {
                setTotalBorn(event.target.value);
                if (errors.totalBorn) {
                  setErrors((previous) => ({
                    ...previous,
                    totalBorn: undefined,
                  }));
                }
              }}
            />
            {errors.totalBorn ? (
              <p className="field__error" role="alert">
                {errors.totalBorn}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="litter-born-alive">
              Nacidos vivos
            </label>
            <input
              id="litter-born-alive"
              className="field__input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={bornAlive}
              onChange={(event) => {
                setBornAlive(event.target.value);
                if (errors.bornAlive) {
                  setErrors((previous) => ({
                    ...previous,
                    bornAlive: undefined,
                  }));
                }
              }}
            />
            {errors.bornAlive ? (
              <p className="field__error" role="alert">
                {errors.bornAlive}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="litter-stillborn">
              Nacidos muertos
            </label>
            <input
              id="litter-stillborn"
              className="field__input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={stillborn}
              onChange={(event) => {
                setStillborn(event.target.value);
                if (errors.stillborn) {
                  setErrors((previous) => ({
                    ...previous,
                    stillborn: undefined,
                  }));
                }
              }}
            />
            {errors.stillborn ? (
              <p className="field__error" role="alert">
                {errors.stillborn}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="litter-notes">
              Observaciones (opcional)
            </label>
            <textarea
              id="litter-notes"
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

          <Alert variant="info" title="Sin generación automática de lechones">
            Este registro guarda la camada y sus conteos. El backend no crea
            porcinos individuales a partir de una camada; los lechones existentes
            se asocian a la camada desde el módulo de porcinos.
          </Alert>

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
          title={
            mode === 'create'
              ? 'Confirmar registro de la camada'
              : 'Confirmar edición de la camada'
          }
          message={confirmMessage}
          confirmLabel={mode === 'create' ? 'Registrar camada' : 'Guardar cambios'}
          confirmVariant="primary"
          busy={submitting}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPendingInput(null)}
        />
      ) : null}
    </>
  );
}
