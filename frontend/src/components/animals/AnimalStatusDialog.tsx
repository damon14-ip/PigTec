import { useState } from 'react';
import {
  ADMINISTRATIVE_ANIMAL_STATUSES,
  ADMINISTRATIVE_ANIMAL_STATUS_LABELS,
  type AdministrativeAnimalStatus,
  type Animal,
} from '../../services/animals.service';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export interface AnimalStatusDialogProps {
  animal: Animal;
  busy: boolean;
  onConfirm: (status: AdministrativeAnimalStatus) => void;
  onCancel: () => void;
}

/**
 * Cambio de estado administrativo de un porcino. Solo ofrece `active`,
 * `inactive` y `missing`: los estados `sold`, `dead` y `transferred_out` se
 * derivan de movimientos y eventos sanitarios y no se fijan a mano.
 */
export function AnimalStatusDialog({
  animal,
  busy,
  onConfirm,
  onCancel,
}: AnimalStatusDialogProps) {
  const options = ADMINISTRATIVE_ANIMAL_STATUSES.filter(
    (status) => status !== animal.status,
  );
  const [status, setStatus] = useState<AdministrativeAnimalStatus>(
    options[0] ?? 'inactive',
  );

  return (
    <Modal
      title="Cambiar estado del porcino"
      onClose={onCancel}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(status)}
            loading={busy}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="form">
        <p className="modal__message">
          Porcino <strong>{animal.animal_code}</strong>. El cambio queda
          registrado con la fecha de actualización; no se elimina historial.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="animal-status">
            Nuevo estado
          </label>
          <select
            id="animal-status"
            className="field__input"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AdministrativeAnimalStatus)
            }
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {ADMINISTRATIVE_ANIMAL_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="field__hint">
            «Vendido», «Fallecido» y «Transferido» se registran con movimientos o
            eventos sanitarios, no desde aquí.
          </p>
        </div>
      </div>
    </Modal>
  );
}
