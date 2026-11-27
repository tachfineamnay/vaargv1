import type { AdaptiveSection } from '@vaarg/shared';
import type { Section } from './composition';

/**
 * Adaptive section mapping (FL05): shared adaptive composition contracts →
 * the typed storefront section model. One adaptive section may expand into
 * several sections (collections + products); every derived section keeps a
 * stable id so React reconciliation never remounts unrelated content.
 * Props are taken only from the validated shared envelope — never invented.
 */
export function adaptiveToSections(sections: readonly AdaptiveSection[]): Section[] {
  const result: Section[] = [];
  for (const section of sections) {
    switch (section.component) {
      case 'CategoryTile':
      case 'CollectionGrid': {
        const collections = section.collections.map((entry) => ({
          slug: entry.handle,
          title: entry.title,
          productCount: entry.productCount,
        }));
        if (collections.length > 0) {
          result.push({
            id: `${section.id}:collections`,
            type: 'collection-tiles',
            title: section.component === 'CollectionGrid' ? section.title : '',
            collections,
          });
        }
        break;
      }
      case 'ProductGrid':
        result.push({
          id: section.id,
          type: 'product-grid',
          title: section.title,
          products: section.products,
          ...(section.footerHref !== undefined ? { footerHref: section.footerHref } : {}),
          ...(section.footerLabel !== undefined ? { footerLabel: section.footerLabel } : {}),
        });
        break;
      case 'ProductCard':
        result.push({
          id: section.id,
          type: 'product-grid',
          title: section.product.title,
          products: [section.product],
        });
        break;
      case 'Recommendations':
        result.push({
          id: section.id,
          type: 'product-grid',
          title: section.title,
          products: section.products,
        });
        break;
      case 'ProductComparator':
        // Attribute rows live on the compare page; the adaptive section lists
        // the verified selected products and links to the full comparison.
        result.push({
          id: section.id,
          type: 'product-grid',
          title: 'Compare',
          products: section.products,
          footerHref: `/compare?ids=${section.products.map((entry) => entry.id).join(',')}`,
          footerLabel: 'Compare',
        });
        break;
      case 'SuggestionChips':
        result.push({
          id: section.id,
          type: 'suggestion-chips',
          title: '',
          chips: section.chips.map((chip) => ({ label: chip.label, href: chip.href })),
        });
        break;
      default: {
        const exhaustive: never = section;
        void exhaustive;
      }
    }
  }
  return result;
}
