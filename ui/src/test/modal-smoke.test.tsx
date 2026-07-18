import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { ONBOARDED_KEY } from '@/components/Onboarding';

/*
 * Open/close smoke per migrated modal (Step 3.1 acceptance): dialog role +
 * aria-modal present, and each modal's close affordances match the R8 table.
 * Smoke level only — behavior inside the modals is not tested here.
 */

beforeEach(() => {
  localStorage.setItem(ONBOARDED_KEY, '1');
});

describe('GuideMenu (shared Modal)', () => {
  it('opens as a dialog; Escape does NOT close (U6 — X button only)', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'open guide' }));
    const dialog = await screen.findByRole('dialog', { name: 'Guide' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Guide' })).toBeTruthy(); // still open
    fireEvent.click(screen.getByRole('button', { name: 'close guide' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guide' })).toBeNull());
  });
});

describe('DefaultsMenu (shared Modal)', () => {
  it('opens as an accessible dialog with its Selects present', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'open defaults' }));
    const dialog = await screen.findByRole('dialog', { name: 'Defaults' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The description-style Radix Select rendered inside the trapped dialog.
    expect(screen.getByRole('combobox', { name: 'default description style' })).toBeTruthy();
  });

  it('closes on Escape (QW-8) and via its X button', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'open defaults' }));
    const dialog = await screen.findByRole('dialog', { name: 'Defaults' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Defaults' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'open defaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'close defaults' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Defaults' })).toBeNull());
  });
});
