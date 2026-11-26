'use client';

import { useEffect } from 'react';
import { useCompare } from './CompareProvider';

/** Keep the compare context aligned with the authoritative `?ids=` URL state. */
export function CompareSync({ ids }: { ids: string[] }): null {
  const compare = useCompare();
  const signature = ids.join(',');
  useEffect(() => {
    compare.setIds(ids);
  }, [signature]);
  return null;
}
