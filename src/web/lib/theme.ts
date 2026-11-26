import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Light (white) by default; the choice is remembered in this browser. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* private mode: the choice just won't be remembered */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
