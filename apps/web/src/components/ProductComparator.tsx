import type { ReactElement } from 'react';
import Link from 'next/link';
import type { CatalogV1Comparison } from '@vaarg/shared';
import { t } from '../lib/i18n';
import { CompareRemoveButton } from './CompareRemoveButton';

/**
 * Deterministic comparison table: rows come from the API (union of compared
 * attributes, ordered by the API); columns align with the `?ids=` URL order.
 */
export function ProductComparator({
  comparison,
  ids,
}: {
  comparison: CatalogV1Comparison;
  ids: string[];
}): ReactElement {
  return (
    <div className="comparator" data-testid="product-comparator">
      <table>
        <caption className="sr-only">{t('compare.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('compare.title')}</th>
            {comparison.products.map((entry, index) => (
              <th scope="col" key={`${entry.ref}-${index}`}>
                {entry.summary ? (
                  <Link href={`/products/${entry.summary.handle}`}>{entry.summary.title}</Link>
                ) : (
                  <span>{t('compare.unavailable')}</span>
                )}
                <CompareRemoveButton index={index} ids={ids} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row, rowIndex) => (
            <tr key={`${row.label}-${rowIndex}`}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, columnIndex) => (
                <td key={columnIndex}>{value ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
