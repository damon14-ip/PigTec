import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../lib/http';
import type { AssistantChatResponse } from '../../services/assistant.service';
import { renderWithAuth } from '../../test/helpers';
import { AssistantPanel } from './AssistantPanel';

const INPUT_LABEL = 'Escribe tu consulta';
const SEND_BUTTON = 'Enviar consulta';

describe('AssistantPanel', () => {
  it('no envia ningun mensaje ni consulta al abrirse', () => {
    const sendMessage = vi.fn();

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      screen.getByText(/No escribo ni modifico registros/),
    ).toBeInTheDocument();
  });

  it('no renderiza nada cuando esta cerrado', () => {
    renderWithAuth(
      <AssistantPanel open={false} onClose={() => undefined} />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no envia al escribir: solo lo hace al pulsar Enviar', async () => {
    const response: AssistantChatResponse = {
      reply: 'Respuesta de prueba',
      usage: null,
      source: 'data',
      quotaRemaining: 7,
    };
    const sendMessage = vi.fn(async () => response);

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: 'resumen general' },
    });
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: SEND_BUTTON }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith(
      'resumen general',
      expect.objectContaining({ signal: expect.anything() }),
    );

    expect(await screen.findByText('Respuesta de prueba')).toBeInTheDocument();
    expect(screen.getByText('Datos del sistema')).toBeInTheDocument();
    expect(
      screen.getByText('Consultas de IA restantes hoy: 7'),
    ).toBeInTheDocument();
  });

  it('muestra el origen de una respuesta local', async () => {
    const sendMessage = vi.fn(async (): Promise<AssistantChatResponse> => ({
      reply: 'Contenido local',
      usage: null,
      source: 'local',
      quotaRemaining: 5,
    }));

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: '¿Qué es PigTec?' },
    });
    fireEvent.click(screen.getByRole('button', { name: SEND_BUTTON }));

    expect(await screen.findByText('Respuesta local')).toBeInTheDocument();
  });

  it('traduce el error de permisos del backend', async () => {
    const sendMessage = vi.fn(async (): Promise<AssistantChatResponse> => {
      throw new ApiError(403, 'forbidden', 'x');
    });

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: 'hola' },
    });
    fireEvent.click(screen.getByRole('button', { name: SEND_BUTTON }));

    expect(
      await screen.findByText('No tienes permisos para esta operacion.'),
    ).toBeInTheDocument();
  });

  it('informa cuando se agota la cuota diaria de IA', async () => {
    const sendMessage = vi.fn(async (): Promise<AssistantChatResponse> => {
      throw new ApiError(429, 'ai_quota_exceeded', 'x');
    });

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: 'consulta' },
    });
    fireEvent.click(screen.getByRole('button', { name: SEND_BUTTON }));

    expect(await screen.findByText(/cuota diaria/)).toBeInTheDocument();
  });

  it('presenta el contenido del asistente con negritas y listas, sin Markdown crudo', async () => {
    const sendMessage = vi.fn(async (): Promise<AssistantChatResponse> => ({
      reply: '**Módulos**\n- Áreas\n- Porcinos',
      usage: null,
      source: 'local',
      quotaRemaining: 5,
    }));

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: '¿Qué módulos tiene PigTec?' },
    });
    fireEvent.click(screen.getByRole('button', { name: SEND_BUTTON }));

    expect(await screen.findByText('Módulos')).toBeInTheDocument();
    expect(screen.getByText('Módulos').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('no envia nada si el campo esta vacio', () => {
    const sendMessage = vi.fn();

    renderWithAuth(
      <AssistantPanel open onClose={() => undefined} sendMessage={sendMessage} />,
    );

    fireEvent.click(screen.getByRole('button', { name: SEND_BUTTON }));

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
