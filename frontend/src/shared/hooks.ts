import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
export function useResource<T>(path: string) {
  const generation = useRef(0);
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const result = await api<T>(path);
      if (requestId !== generation.current) return;
      setData(result);
      setError('');
    } catch (error) {
      if (requestId === generation.current) setError((error as Error).message);
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  return { data, error, loading, reload, setData };
}
