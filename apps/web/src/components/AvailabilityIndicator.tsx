import type { ReactElement } from 'react';
import { t } from '../lib/i18n';

export function AvailabilityIndicator({
  available,
  quantity,
}: {
  available: boolean;
  quantity?: number | null | undefined;
}): ReactElement {
  const label = !available
    ? t('product.outOfStock')
    : typeof quantity === 'number' && quantity > 0
      ? t('product.stockCount', { count: quantity })
      : t('product.inStock');
  return (
    <span
      className={`badge badge--${available ? 'in' : 'out'}`}
      data-testid="availability"
      data-available={String(available)}
    >
      {label}
    </span>
  );
}
