import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SaveChip } from '@/components/SaveChip';
import { DraftEditor } from '@/components/DraftEditor';
import { api } from '@/lib/api';
import { makeItem } from '@/test/fixtures';

/*
 * UX audit #9/#6: a failed debounced save must stay VISIBLE ("Not saved —
 * retry", clickable) and keep retrying — the old behavior toasted once, went
 * back to idle (chip unmounts), and silence looked like success.
 */

describe('SaveChip failed state', () => {
  it('renders a persistent retry chip that fires onRetry on click', () => {
    const onRetry = vi.fn();
    render(<SaveChip state="failed" onRetry={onRetry} />);
    const chip = screen.getByRole('button', { name: /not saved — retry/i });
    fireEvent.click(chip);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('DraftEditor failed → retry → saved (UX audit #9)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function renderEditor() {
    const item = makeItem({ dirty: true });
    const noop = () => {};
    render(
      <DraftEditor
        item={item}
        update={() => {}}
        stylesRaw={null}
        onEditStyles={noop}
        toast={noop}
        nextDraft={null}
        autoFill={false}
        onAutoFillConsumed={noop}
        onMarkListedAndNext={noop}
      />
    );
  }

  it('shows the retry chip on failure, then auto-retries into saved', async () => {
    vi.useFakeTimers();
    const save = vi
      .spyOn(api, 'saveItem')
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    renderEditor();

    // Debounce fires, the save rejects → the chip must stay visible as failed.
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /not saved — retry/i })).toBeTruthy();

    // ~5s later the automatic retry re-runs the save (plus the 800ms debounce)
    // and the normal saved flow resumes.
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /not saved — retry/i })).toBeNull();
    expect(screen.getByText(/^saved just now$/i)).toBeTruthy();
  });
});
