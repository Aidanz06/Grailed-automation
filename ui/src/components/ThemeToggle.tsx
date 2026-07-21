import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

// Toggles the `dark` class on <html> and persists the choice. Initial value is
// read from the class the pre-paint script in index.html already applied.
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    // Mirror to the settings store (audit #19) so the NEXT launch's window
    // background matches — main reads it only at createWindow. Deliberately a
    // second copy of the choice; localStorage stays the renderer's truth.
    api.setThemePreference(dark ? 'dark' : 'light').catch(() => {});
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setDark((v) => !v)}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
