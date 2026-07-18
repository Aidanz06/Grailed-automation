import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TOAST_CAP, ToastStack, appendToast, toastDuration, type Toast } from '@/components/ToastStack';

const t = (id: number, msg = `toast ${id}`): Toast => ({ id, msg });

describe('appendToast queue', () => {
  it('stacks new toasts at the end', () => {
    expect(appendToast([t(1)], t(2)).map((x) => x.id)).toEqual([1, 2]);
  });

  it('caps at 3, dropping the oldest', () => {
    let list: Toast[] = [];
    for (let i = 1; i <= 5; i++) list = appendToast(list, t(i));
    expect(list).toHaveLength(TOAST_CAP);
    expect(list.map((x) => x.id)).toEqual([3, 4, 5]);
  });
});

describe('toastDuration', () => {
  it('keeps the length-scaled window: 2.8s floor, 9s ceiling', () => {
    expect(toastDuration('saved')).toBe(2800);
    expect(toastDuration('x'.repeat(100))).toBe(5500);
    expect(toastDuration('x'.repeat(500))).toBe(9000);
  });
});

describe('ToastStack', () => {
  afterEach(() => vi.useRealTimers());

  it('renders every toast in a polite live region with a dismiss button', () => {
    const { container } = render(<ToastStack toasts={[t(1, 'first'), t(2, 'second')]} onDismiss={() => {}} />);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'dismiss notification' })).toHaveLength(2);
  });

  it('✕ dismisses that toast only', () => {
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[t(1, 'first'), t(2, 'second')]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'dismiss notification' })[0]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('auto-expires each toast on its own length-scaled timer', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[t(1, 'short'), t(2, 'x'.repeat(200))]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2799);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); // past the short toast's 2800ms
    expect(onDismiss).toHaveBeenCalledWith(1);
    expect(onDismiss).not.toHaveBeenCalledWith(2);
    vi.advanceTimersByTime(9000); // past the long toast's ceiling
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
