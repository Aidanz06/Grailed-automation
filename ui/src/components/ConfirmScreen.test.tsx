import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ConfirmScreen } from '@/components/ConfirmScreen';
import { makeItem } from '@/test/fixtures';

/*
 * UX audit #24: the advertised Cmd/Ctrl+Enter "save & next" chord silently
 * no-oped on the LAST confirm card (go(1) clamps) while the button switched
 * to "Done" — finishing the pass is the obvious intent, so it calls onDone().
 */

function unreadyDraft(id: number) {
  const item = makeItem({ id });
  item.content!.title = ''; // fails readiness → lands in the confirm queue
  return item;
}

describe('ConfirmScreen last-card save & next (UX audit #24)', () => {
  it('Cmd+Enter on the final card calls onDone instead of no-oping', () => {
    const onDone = vi.fn();
    render(<ConfirmScreen drafts={[unreadyDraft(1)]} toast={() => {}} onOpenItem={() => {}} onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Enter mid-queue still advances (onDone only fires at the end)', () => {
    const onDone = vi.fn();
    render(
      <ConfirmScreen
        drafts={[unreadyDraft(1), unreadyDraft(2)]}
        toast={() => {}}
        onOpenItem={() => {}}
        onDone={onDone}
      />
    );
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onDone).not.toHaveBeenCalled();
    // Now on the last card — the same chord finishes the pass.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
