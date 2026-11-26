/**
 * Editorial content (FL04): static, config-driven brand copy for the home
 * composition — no fabricated reviews, prices or product claims.
 */
export interface EditorialEntry {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
}

export const EDITORIAL_ENTRIES: EditorialEntry[] = [
  {
    slug: 'materials-with-a-record',
    title: 'Materials with a record',
    excerpt: 'Every piece lists what it is made of, where it was assembled and when it last changed.',
    body: 'Specifications are published from the same verified catalog data the storefront runs on — no parallel copy deck, no drifted numbers.',
  },
  {
    slug: 'fit-before-fashion',
    title: 'Fit before fashion',
    excerpt: 'Sizes, options and availability are shown per variant, not averaged into a single claim.',
    body: 'If a combination is out of stock, the storefront says so. It never substitutes a different variant to make a page look complete.',
  },
];
