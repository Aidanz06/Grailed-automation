import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StyleEditor } from '@/components/StyleEditor';

/*
 * UX audit #3: every close path must respect a dirty template. The modal
 * already blocked backdrop/Escape while dirty, but the header X, the footer
 * Close, and the style-switch dropdown silently discarded edits.
 */

function renderEditor() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const toast = vi.fn();
  render(<StyleEditor stylesRaw={null} onSaved={onSaved} onClose={onClose} toast={toast} />);
  return { onClose, onSaved, toast };
}

function dirtyTheTemplate() {
  const box = screen.getByRole('textbox', { name: 'description template' });
  box.textContent = 'entirely new template text';
  fireEvent.input(box);
}

describe('StyleEditor dirty-close guard (UX audit #3)', () => {
  it('clean template: X closes immediately, no guard strip', () => {
    const { onClose } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'close style editor' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dirty template: header X shows the guard instead of closing', () => {
    const { onClose } = renderEditor();
    dirtyTheTemplate();
    fireEvent.click(screen.getByRole('button', { name: 'close style editor' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/unsaved changes/i)).toBeTruthy();
    // Keep editing dismisses the strip without closing.
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dirty template: footer Close guards too, and Discard then closes', () => {
    const { onClose } = renderEditor();
    dirtyTheTemplate();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
