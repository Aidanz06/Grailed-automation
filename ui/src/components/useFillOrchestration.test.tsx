import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Item } from '@/types';
import { useFillOrchestration } from './useFillOrchestration';

/*
 * S-1 PR-a acceptance: unit tests for the fill gate logic that previously
 * lived untestable inside DraftEditor — probe→blocked→force, the one-time
 * first-fill prompt, autoFill consume-once, and fillSignal skip-mount.
 * The api module is fully mocked; localStorage comes from jsdom.
 */

const mockApi = vi.hoisted(() => ({
  getChromeStatus: vi.fn(),
  getFillChanges: vi.fn(),
  onFillProgress: vi.fn(() => () => {}),
  saveItem: vi.fn(),
  fillListing: vi.fn(),
  markSubmitted: vi.fn(),
  duplicateItem: vi.fn(),
  launchChrome: vi.fn(),
  openSellTab: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mockApi }));

const item = {
  id: 1,
  status: 'draft',
  content: { title: 'T', description: 'D', tags: [] },
  range: null,
  attributes: {},
  descParts: null,
  measurements: [],
  photos: [],
  flags: [],
} as unknown as Item;

function args(over: Partial<Parameters<typeof useFillOrchestration>[0]> = {}) {
  return {
    item,
    update: vi.fn(),
    toast: vi.fn(),
    nextDraft: null,
    autoFill: false,
    onAutoFillConsumed: vi.fn(),
    onMarkListedAndNext: vi.fn(),
    fillSignal: 0,
    confirmed: false,
    lastSavedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('tailor.firstFillConfirmed', '1'); // most tests are past the one-time prompt
  mockApi.getFillChanges.mockResolvedValue(null);
  mockApi.getChromeStatus.mockResolvedValue({ ready: true });
  mockApi.saveItem.mockResolvedValue({});
  mockApi.fillListing.mockResolvedValue({ ok: true, results: {} });
});

describe('fresh-Sell-form gate (probe → blocked → force)', () => {
  it('blocks the fill when the probe says Chrome is not ready', async () => {
    mockApi.getChromeStatus.mockResolvedValue({ ready: false, reason: 'no-sell-form' });
    const { result } = renderHook(useFillOrchestration, { initialProps: args() });
    await act(() => result.current.fillListing());
    expect(result.current.fillBlocked).toMatchObject({ ready: false });
    expect(mockApi.fillListing).not.toHaveBeenCalled();
  });

  it('"Fill anyway" (force) skips the probe and proceeds', async () => {
    mockApi.getChromeStatus.mockResolvedValue({ ready: false, reason: 'no-sell-form' });
    const { result } = renderHook(useFillOrchestration, { initialProps: args() });
    await act(() => result.current.fillListing({ force: true }));
    await waitFor(() => expect(mockApi.fillListing).toHaveBeenCalledWith(1, undefined));
    expect(mockApi.getChromeStatus).not.toHaveBeenCalled(); // no probe on the force path
    expect(result.current.fillBlocked).toBeNull();
  });

  it('a probe IPC failure fails open — a deliberate click still fills', async () => {
    mockApi.getChromeStatus.mockRejectedValue(new Error('ipc down'));
    const { result } = renderHook(useFillOrchestration, { initialProps: args() });
    await act(() => result.current.fillListing());
    await waitFor(() => expect(mockApi.fillListing).toHaveBeenCalled());
  });
});

describe('one-time first-fill prompt', () => {
  it('defers the very first fill to the prompt, then proceeds on confirm', async () => {
    localStorage.clear(); // never confirmed
    const { result } = renderHook(useFillOrchestration, { initialProps: args() });
    await act(() => result.current.fillListing());
    expect(result.current.firstFillPrompt).toEqual({ force: false, changedOnly: false });
    expect(mockApi.getChromeStatus).not.toHaveBeenCalled();
    expect(mockApi.fillListing).not.toHaveBeenCalled();

    await act(() => result.current.confirmFirstFill());
    await waitFor(() => expect(mockApi.fillListing).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('tailor.firstFillConfirmed')).toBe('1');
  });
});

describe('autoFill ("listed, fill next") consume-once', () => {
  it('fires exactly once per item even across re-renders', async () => {
    const a = args({ autoFill: true });
    const { rerender } = renderHook(useFillOrchestration, { initialProps: a });
    await waitFor(() => expect(mockApi.fillListing).toHaveBeenCalledTimes(1));
    expect(a.onAutoFillConsumed).toHaveBeenCalledTimes(1);
    rerender({ ...a });
    await act(async () => {});
    expect(mockApi.fillListing).toHaveBeenCalledTimes(1);
  });

  it('arms instead of firing when Chrome is not on a fresh Sell form', async () => {
    mockApi.getChromeStatus.mockResolvedValue({ ready: false, reason: 'no-sell-form' });
    const { result } = renderHook(useFillOrchestration, { initialProps: args({ autoFill: true }) });
    await waitFor(() => expect(result.current.armed).toBe(true));
    expect(result.current.fillBlocked).toMatchObject({ ready: false });
    expect(mockApi.fillListing).not.toHaveBeenCalled();
  });

  it('never auto-fires blind when the probe itself fails', async () => {
    mockApi.getChromeStatus.mockRejectedValue(new Error('ipc down'));
    const { result } = renderHook(useFillOrchestration, { initialProps: args({ autoFill: true }) });
    await waitFor(() => expect(result.current.armed).toBe(true));
    expect(mockApi.fillListing).not.toHaveBeenCalled();
  });
});

describe('fillSignal (F hotkey) skip-mount', () => {
  it('ignores the mount-time value and fires only on a NEW signal', async () => {
    const a = args({ fillSignal: 3 });
    const { rerender } = renderHook(useFillOrchestration, { initialProps: a });
    await act(async () => {});
    expect(mockApi.fillListing).not.toHaveBeenCalled(); // stale mount-time signal ignored

    rerender({ ...a, fillSignal: 4 });
    await waitFor(() => expect(mockApi.fillListing).toHaveBeenCalledTimes(1));
  });
});
