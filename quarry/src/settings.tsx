import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readLocal, writeLocal } from './storage.ts';
import { api } from './api.ts';

export type Theme = 'system' | 'light' | 'dark';

interface Settings {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Historical cutoff (YYYY-MM-DD) or null for "now". */
  asOf: string | null;
  setAsOf: (d: string | null) => void;
}

const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (readLocal('quarry.theme') as Theme) || 'system');
  const [asOf, setAsOfState] = useState<string | null>(() => readLocal('quarry.asOf'));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => { api.setAsOf(asOf); }, [asOf]);
  // Keep the module-level value in sync before the first render's fetches.
  api.setAsOf(asOf);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeLocal('quarry.theme', t === 'system' ? null : t);
    api.put('/api/preferences', { theme: t }).catch(() => {});
  }, []);
  const setAsOf = useCallback((d: string | null) => {
    setAsOfState(d);
    writeLocal('quarry.asOf', d);
    api.clearCache();
  }, []);

  const value = useMemo(() => ({ theme, setTheme, asOf, setAsOf }), [theme, setTheme, asOf, setAsOf]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings outside provider');
  return v;
}
