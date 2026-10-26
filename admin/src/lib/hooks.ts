import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Envelope, type PageMeta } from './api';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'any') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function useAdminList<T>(
  key: unknown[],
  path: string,
  params: Record<string, unknown> = {},
): {
  data: T[];
  meta?: PageMeta;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const query = useQuery<Envelope<T[]>>({
    queryKey: [...key, params],
    queryFn: () => api.get<T[]>(`${path}${buildQuery(params)}`),
  });
  return {
    data: query.data?.data ?? [],
    meta: query.data?.meta,
    loading: query.isLoading,
    error: (query.error as Error) ?? null,
    refetch: () => void query.refetch(),
  };
}

export function useAdminItem<T>(key: unknown[], path: string, enabled = true) {
  return useQuery<Envelope<T>>({
    queryKey: key,
    queryFn: () => api.get<T>(path),
    enabled,
  });
}

export function useInvalidate() {
  const client = useQueryClient();
  return (keys: string[]) => {
    for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
  };
}

export function useDebouncedValueRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
