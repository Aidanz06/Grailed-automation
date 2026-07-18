import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DISARM_MS, TwoStepDelete } from '@/components/TwoStepDelete';

describe('TwoStepDelete', () => {
  afterEach(() => vi.useRealTimers());

  it('first click arms (Sure? + confirm aria-label), second deletes', () => {
    const onDelete = vi.fn();
    render(<TwoStepDelete variant="row" title="draft" onDelete={onDelete} />);
    const btn = screen.getByRole('button', { name: 'delete draft' });
    fireEvent.click(btn);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Sure?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'confirm delete draft' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    // Disarmed again after the delete fires.
    expect(screen.getByRole('button', { name: 'delete draft' })).toBeTruthy();
  });

  it('auto-disarms after 3.5s without deleting', () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    render(<TwoStepDelete variant="card" title="draft" onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'delete draft' }));
    act(() => vi.advanceTimersByTime(DISARM_MS - 1));
    expect(screen.getByRole('button', { name: 'confirm delete draft' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.getByRole('button', { name: 'delete draft' })).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('clicks never bubble to the card underneath', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <TwoStepDelete variant="card" title="draft" onDelete={() => {}} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'delete draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm delete draft' }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
