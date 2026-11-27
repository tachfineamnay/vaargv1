'use client';

import { useState, type ReactElement } from 'react';
import type { CatalogV1ProductDetail } from '@vaarg/shared';
import { t } from '../lib/i18n';

/** Main image + thumbnail gallery (client state only; data comes from the server). */
export function ProductGallery({
  images,
  mediaCount,
}: {
  images: CatalogV1ProductDetail['images'];
  mediaCount: CatalogV1ProductDetail['mediaCount'];
}): ReactElement {
  const [index, setIndex] = useState(0);
  const active = images[index];
  const videoCount = mediaCount.video + mediaCount.externalVideo + mediaCount.model3d;
  return (
    <div className="gallery" data-testid="product-gallery">
      <div className="gallery__main">
        {active ? (
          <img src={active.url} alt={active.altText ?? ''} width={640} height={640} />
        ) : (
          <span className="tile__placeholder tile__placeholder--large" aria-hidden="true" />
        )}
      </div>
      {images.length > 1 ? (
        <ul className="gallery__thumbs">
          {images.map((image, position) => (
            <li key={`${image.url}-${position}`}>
              <button
                type="button"
                aria-current={position === index}
                aria-label={`Image ${position + 1}`}
                onClick={() => setIndex(position)}
              >
                <img src={image.url} alt="" width={72} height={72} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {videoCount > 0 ? (
        <p className="gallery__count">{t('product.mediaCount', { image: mediaCount.image, video: videoCount })}</p>
      ) : null}
    </div>
  );
}
