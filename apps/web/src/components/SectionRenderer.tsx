import type { ReactElement } from 'react';
import Link from 'next/link';
import type { Section } from '../lib/composition';
import { t } from '../lib/i18n';
import { CategoryTileGrid } from './CategoryTile';
import { CollectionGrid } from './CollectionCard';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { ProductComparator } from './ProductComparator';
import { ProductGrid } from './ProductCard';

function CommerceGrid({
  title,
  products,
  footerHref,
  footerLabel,
}: {
  title: string;
  products: Parameters<typeof ProductGrid>[0]['products'];
  footerHref?: string | undefined;
  footerLabel?: string | undefined;
}): ReactElement {
  return (
    <>
      <div className="section__head">
        <h2>{title}</h2>
        {footerHref ? (
          <Link className="section__link" href={footerHref}>
            {footerLabel ?? t('common.viewAll')} →
          </Link>
        ) : null}
      </div>
      <ProductGrid products={products} />
    </>
  );
}

function renderSection(section: Section): ReactElement {
  switch (section.type) {
    case 'hero':
      return (
        <>
          <p className="eyebrow">{t('home.eyebrow')}</p>
          <h1>{section.title}</h1>
          <p className="hero__subtitle">{section.subtitle}</p>
        </>
      );
    case 'category-tiles':
      return (
        <>
          <div className="section__head">
            <h2>{t('home.categoriesTitle')}</h2>
            <Link className="section__link" href="/collections">
              {t('home.viewCollections')} →
            </Link>
          </div>
          <CategoryTileGrid collections={section.collections} />
        </>
      );
    case 'collection-grid':
      return <CollectionGrid collections={section.collections} />;
    case 'product-grid':
      return (
        <CommerceGrid
          title={section.title}
          products={section.products}
          footerHref={section.footerHref}
          footerLabel={section.footerLabel}
        />
      );
    case 'featured-selection':
      return (
        <CommerceGrid
          title={section.title}
          products={section.products}
          footerHref={section.footerHref}
          footerLabel={section.footerLabel}
        />
      );
    case 'recommendations':
      return <ProductGrid products={section.items.map((item) => item.summary)} />;
    case 'comparison':
      return <ProductComparator comparison={section.comparison} ids={section.ids} />;
    case 'editorial':
      return (
        <>
          <div className="section__head">
            <h2>{t('home.editorialTitle')}</h2>
          </div>
          <div className="editorial" data-testid="editorial">
            {section.entries.map((entry) => (
              <article key={entry.slug} data-testid="editorial-entry" className="editorial__entry">
                <h3>{entry.title}</h3>
                <p className="editorial__excerpt">{entry.excerpt}</p>
                <p>{entry.body}</p>
              </article>
            ))}
          </div>
        </>
      );
    case 'state-empty':
      return <EmptyState kind={section.kind} />;
    case 'state-error':
      return <ErrorState error={section.error} />;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

/** Component registry: one wrapper with stable data attributes per section. */
export function SectionRenderer({ section }: { section: Section }): ReactElement {
  return (
    <section
      className={`section section--${section.type}`}
      data-section={section.type}
      data-section-id={section.id}
    >
      {renderSection(section)}
    </section>
  );
}
