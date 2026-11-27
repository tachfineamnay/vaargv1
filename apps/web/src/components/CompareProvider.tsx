'use client';

import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { CompareReporter } from './ExperienceReporter';

/** Comparison holds at most four products (matches the API bound). */
export const MAX_COMPARE = 4;

export interface CompareContextValue {
  ids: string[];
  has(id: string): boolean;
  toggle(id: string): void;
  remove(id: string): void;
  setIds(ids: string[]): void;
  clear(): void;
}

const CompareContext = createContext<CompareContextValue | null>(null);

export function useCompare(): CompareContextValue {
  const value = useContext(CompareContext);
  if (!value) throw new Error('useCompare must be used inside CompareProvider');
  return value;
}

export function CompareProvider({
  children,
  initialIds = [],
}: {
  children: ReactNode;
  /** Optional seeded selection (e.g. server-known state); defaults to empty. */
  initialIds?: string[];
}): ReactElement {
  const [ids, setIdsState] = useState<string[]>(() => [...new Set(initialIds)].slice(0, MAX_COMPARE));
  const value = useMemo<CompareContextValue>(
    () => ({
      ids,
      has: (id) => ids.includes(id),
      toggle: (id) =>
        setIdsState((current) =>
          current.includes(id)
            ? current.filter((entry) => entry !== id)
            : current.length >= MAX_COMPARE
              ? current
              : [...current, id],
        ),
      remove: (id) => setIdsState((current) => current.filter((entry) => entry !== id)),
      setIds: (next) => setIdsState([...new Set(next)].slice(0, MAX_COMPARE)),
      clear: () => setIdsState([]),
    }),
    [ids],
  );
  return (
    <CompareContext.Provider value={value}>
      <CompareReporter />
      {children}
    </CompareContext.Provider>
  );
}
