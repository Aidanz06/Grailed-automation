import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '@/App';
import { ONBOARDED_KEY } from '@/components/Onboarding';

/*
 * Mock-mode smoke test (plan Step 0.1 — smoke level ONLY, no component
 * behavior tests here). Under jsdom there is no window.tailor bridge, so
 * lib/api.ts serves MOCK_ITEMS exactly like `npm run ui:dev` in a browser.
 */
describe('App (mock mode)', () => {
  it('mounts and renders the Home header', async () => {
    localStorage.setItem(ONBOARDED_KEY, '1'); // skip the first-run welcome
    render(<App />);

    // Wordmark + the header's primary action = Home actually mounted.
    expect(await screen.findByText('Studio')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /new batch/i })).toBeTruthy();
  });
});
