import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data and keeps the previous result on screen while refetching, so
 * charts dim rather than flash empty when a filter changes.
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    load()
      .then((d) => {
        if (id !== latest.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (id === latest.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Filter state lives in the URL so a view can be bookmarked or sent to a colleague. */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const read = useCallback((): T => {
    const params = new URLSearchParams(window.location.search);
    const out = { ...defaults };
    for (const k of Object.keys(defaults) as Array<keyof T & string>) {
      const v = params.get(k);
      if (v !== null) (out as Record<string, string>)[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = useState<T>(read);

  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [read]);

  const update = useCallback(
    (patch: Partial<T>) => {
      setState((prev) => {
        const next = { ...prev, ...patch } as T;
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(next)) if (v && v !== defaults[k]) params.set(k, v);
        const url = `${window.location.pathname}${params.size ? `?${params}` : ''}`;
        window.history.pushState(null, '', url);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [state, update];
}
