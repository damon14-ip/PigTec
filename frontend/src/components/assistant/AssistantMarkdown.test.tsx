import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AssistantMarkdown,
  decodeHtmlEntities,
  unescapeMarkdown,
} from './AssistantMarkdown';

describe('AssistantMarkdown', () => {
  it('presenta las negritas sin mostrar los asteriscos', () => {
    const { container } = render(
      <AssistantMarkdown text="Hola **mundo** cruel" />,
    );

    expect(screen.getByText('mundo').tagName).toBe('STRONG');
    expect(container.textContent).toBe('Hola mundo cruel');
    expect(container.textContent).not.toContain('**');
  });

  it('presenta las listas con vinetas como una lista real', () => {
    render(<AssistantMarkdown text={'Disponibles:\n- uno\n- dos'} />);

    expect(screen.getByRole('list')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('uno');
    expect(items[1].textContent).toBe('dos');
  });

  it('separa los parrafos por lineas en blanco', () => {
    const { container } = render(
      <AssistantMarkdown text={'Primero\n\nSegundo'} />,
    );

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('Primero');
    expect(paragraphs[1].textContent).toBe('Segundo');
  });

  it('decodifica entidades HTML y no las muestra literales', () => {
    const { container } = render(
      <AssistantMarkdown text="hola&#x20;mundo &amp; adios" />,
    );

    expect(container.textContent).toBe('hola mundo & adios');
    expect(container.textContent).not.toContain('&#x20;');
  });

  it('interpreta el Markdown escapado por el proveedor', () => {
    const { container } = render(
      <AssistantMarkdown text={'\\*\\*Negrita\\*\\*\n\\- item'} />,
    );

    expect(screen.getByText('Negrita').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(container.textContent).not.toContain('\\*');
  });

  it('no interpreta HTML de la respuesta (seguro contra XSS)', () => {
    const { container } = render(
      <AssistantMarkdown
        text={'<img src=x onerror="alert(1)"> <script>alert(2)</script>'}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    // El contenido sospechoso se muestra como texto literal, sin ejecutarse.
    expect(container.textContent).toContain('<img');
    expect(container.textContent).toContain('<script>');
  });

  it('las funciones de limpieza son deterministas', () => {
    expect(decodeHtmlEntities('a&#x20;b &amp; c')).toBe('a b & c');
    expect(unescapeMarkdown('\\*\\*x\\*\\*')).toBe('**x**');
  });
});
