import { describe, expect, it } from 'vitest';
import {
  currentListSearch,
  hasPreviousPage,
  nextPageListSearch,
  parseListParams,
  previousPageListSearch,
} from '../src/lib/params';

describe('parseListParams', () => {
  it('extracts validated api params and keeps ui form values', () => {
    const params = parseListParams(
      {
        q: 'linen',
        limit: '12',
        sort: 'price-asc',
        currency: 'EUR',
        priceMin: '10.50',
        priceMax: '99',
        available: 'true',
        productType: 'Shirt',
        vendor: 'Acme',
        attribute: 'Size:M',
        collection: 'summer',
      },
      'products',
    );
    expect(params.api).toEqual({
      q: 'linen',
      limit: '12',
      sort: 'price-asc',
      priceMin: '10.50',
      priceMax: '99',
      available: 'true',
      productType: 'Shirt',
      vendor: 'Acme',
      attribute: 'Size:M',
      collection: 'summer',
    });
    // Market currency is owned by the binding — never taken from the URL.
    expect(params.api.currency).toBeUndefined();
    expect(params.ui.attribute).toBe('Size:M');
    expect(params.ui.sort).toBe('price-asc');
    expect(params.ui.priceMin).toBe('10.50');
  });

  it('drops keys that fail the shared contracts from the api request', () => {
    const params = parseListParams(
      {
        priceMin: 'abc',
        limit: '999',
        sort: 'bogus',
        attribute: 'nocolon',
        available: 'sometimes',
        unknownKey: 'nope',
      },
      'products',
    );
    expect(params.api).toEqual({});
    // The ui view is the sanitized state (invalid keys dropped, defaults applied).
    expect(params.ui.priceMin).toBe('');
    expect(params.ui.sort).toBe('title-asc');
    expect(params.ui.limit).toBe('');
  });

  it('drops unknown tracking params without breaking the rest of the query', () => {
    const params = parseListParams({ q: 'linen', utm_source: 'newsletter', fbclid: 'abc' }, 'products');
    expect(params.api).toEqual({ q: 'linen' });
    expect(currentListSearch(params)).toBe('?q=linen');
  });

  it('extracts the comma-joined cursor trail and keeps the live cursor', () => {
    const params = parseListParams({ q: 'linen', cursor: 'page2', c: 'trailA,trailB' }, 'products');
    expect(params.api.cursor).toBe('page2');
    expect('c' in params.api).toBe(false);
    expect(params.cursor).toBe('page2');
    expect(params.trail).toEqual(['trailA', 'trailB']);
  });

  it('uses the first value of repeated search params', () => {
    const params = parseListParams({ limit: ['12', '999'] }, 'products');
    expect(params.api.limit).toBe('12');
  });

  it('applies the collections schema (no product-only keys)', () => {
    const params = parseListParams({ limit: '10', sort: 'price-asc' }, 'collections');
    // `limit` is shared; `sort` is product-only and gets dropped.
    expect(params.api).toEqual({ limit: '10' });
    expect('sort' in params.api).toBe(false);
  });
});

describe('list URL serialization', () => {
  it('currentListSearch keeps only validated api params plus the trail', () => {
    const params = parseListParams({ q: 'a', cursor: 'c', c: 'x', junk: '1' }, 'products');
    expect(currentListSearch(params)).toBe('?cursor=c&q=a&c=x');
  });

  it('next pushes the current cursor onto the trail (base64url-safe)', () => {
    const first = parseListParams({}, 'products');
    expect(nextPageListSearch(first, 'next')).toBe('?cursor=next');
    const withCursor = parseListParams({ cursor: 'c1' }, 'products');
    expect(nextPageListSearch(withCursor, 'c2')).toBe('?cursor=c2&c=c1');
  });

  it('next trail entries never contain commas of their own', () => {
    const params = parseListParams({ cursor: 'eyJvIjoxfQ' }, 'products');
    const search = nextPageListSearch(params, 'eyJvIjoyfQ');
    expect(search).toBe('?cursor=eyJvIjoyfQ&c=eyJvIjoxfQ');
    // The only commas are the trail separator, never inside a cursor.
    const parsed = new URLSearchParams(search);
    expect(parsed.get('cursor')).toBe('eyJvIjoyfQ');
    expect((parsed.get('c') ?? '').split(',')).toEqual(['eyJvIjoxfQ']);
  });

  it('previous pops the trail into the cursor', () => {
    const params = parseListParams({ cursor: 'c2', c: 'c1' }, 'products');
    expect(previousPageListSearch(params)).toBe('?cursor=c1');
    expect(hasPreviousPage(params)).toBe(true);
  });

  it('previous with an empty trail drops the cursor (back to page one)', () => {
    const params = parseListParams({ cursor: 'only' }, 'products');
    expect(previousPageListSearch(params)).toBe('');
    expect(hasPreviousPage(params)).toBe(true); // still on page two — prev exists
  });

  it('empty state serializes to an empty query', () => {
    const params = parseListParams({}, 'products');
    expect(currentListSearch(params)).toBe('');
    expect(hasPreviousPage(params)).toBe(false);
  });
});
