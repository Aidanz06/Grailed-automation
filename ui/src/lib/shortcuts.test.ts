import { describe, expect, it } from 'vitest';
import { isTypingTarget, isWidgetTarget, matchShortcut } from '@/lib/shortcuts';

/** Minimal keydown stand-in — matchShortcut only reads keys/modifiers/target. */
function ev(
  key: string,
  over: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>> & { target?: EventTarget | null } = {}
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: document.body,
    ...over,
  } as unknown as KeyboardEvent;
}

describe('matchShortcut — plain keys', () => {
  it('J/↓ and K/↑ navigate drafts', () => {
    expect(matchShortcut(ev('j'))).toBe('nextDraft');
    expect(matchShortcut(ev('ArrowDown'))).toBe('nextDraft');
    expect(matchShortcut(ev('k'))).toBe('prevDraft');
    expect(matchShortcut(ev('ArrowUp'))).toBe('prevDraft');
  });

  it('F fills, ? opens the guide (shift allowed — "?" IS shifted)', () => {
    expect(matchShortcut(ev('f'))).toBe('fill');
    expect(matchShortcut(ev('?', { shiftKey: true }))).toBe('help');
  });

  it('modifiers disqualify plain-letter bindings', () => {
    expect(matchShortcut(ev('j', { shiftKey: true }))).toBeNull();
    expect(matchShortcut(ev('j', { metaKey: true }))).toBeNull();
    expect(matchShortcut(ev('f', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev('x'))).toBeNull();
  });
});

describe('matchShortcut — modifier chords', () => {
  it('Cmd/Ctrl+Enter saves, Cmd/Ctrl+K opens the palette', () => {
    expect(matchShortcut(ev('Enter', { metaKey: true }))).toBe('saveAndNext');
    expect(matchShortcut(ev('Enter', { ctrlKey: true }))).toBe('saveAndNext');
    expect(matchShortcut(ev('k', { metaKey: true }))).toBe('palette');
    expect(matchShortcut(ev('K', { ctrlKey: true }))).toBe('palette');
  });

  it('alt or shift break the chords', () => {
    expect(matchShortcut(ev('Enter', { metaKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(ev('k', { metaKey: true, shiftKey: true }))).toBeNull();
  });
});

describe('matchShortcut — typing guard', () => {
  it('plain letters never fire from a text field', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(matchShortcut(ev('j', { target: document.createElement(tag) }))).toBeNull();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(matchShortcut(ev('f', { target: editable }))).toBeNull();
  });

  it('worksInInputs chords still fire while typing', () => {
    const input = document.createElement('input');
    expect(matchShortcut(ev('Enter', { metaKey: true, target: input }))).toBe('saveAndNext');
    expect(matchShortcut(ev('k', { ctrlKey: true, target: input }))).toBe('palette');
  });
});

describe('matchShortcut — widget guard', () => {
  it('keys belong to buttons/menus/comboboxes, not shortcuts', () => {
    expect(matchShortcut(ev('j', { target: document.createElement('button') }))).toBeNull();
    const combo = document.createElement('div');
    combo.setAttribute('role', 'combobox');
    expect(matchShortcut(ev('ArrowDown', { target: combo }))).toBeNull();
    // nested: a span inside a menu still counts (closest())
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const inner = document.createElement('span');
    menu.appendChild(inner);
    expect(matchShortcut(ev('k', { target: inner }))).toBeNull();
  });
});

describe('target classifiers', () => {
  it('handle null and plain elements', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isWidgetTarget(null)).toBe(false);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isWidgetTarget(document.createElement('div'))).toBe(false);
  });
});
