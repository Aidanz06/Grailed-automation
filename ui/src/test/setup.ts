import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest's jsdom environment ships a method-less localStorage stub — the app
// (and Onboarding gate) needs a working one, so back it with a real Map.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
}
if (typeof sessionStorage === 'undefined' || typeof sessionStorage.setItem !== 'function') {
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true });
}

// RTL only auto-cleans when test globals are injected; we import explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom lacks a few layout APIs that Radix primitives (ScrollArea in Home)
// touch at mount. Observers never need to fire for these tests.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): never[] {
    return [];
  }
}
const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= ObserverStub;
g.IntersectionObserver ??= ObserverStub;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

Element.prototype.scrollIntoView ??= () => {};
