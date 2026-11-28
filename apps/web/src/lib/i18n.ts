/**
 * Translation architecture (FL04): typed message keys, an English baseline
 * dictionary, and a `t()` with fallback — prepared so additional locales only
 * need a dictionary entry, without translating the whole application now.
 */
export type Locale = 'en';

export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'nav.collections': 'Collections',
  'nav.products': 'Products',
  'nav.search': 'Search',
  'nav.compare': 'Compare',
  'nav.preferences': 'Preferences',
  'common.retry': 'Try again',
  'common.apply': 'Apply filters',
  'common.clear': 'Clear',
  'common.next': 'Next',
  'common.previous': 'Previous',
  'common.viewAll': 'View all',
  'common.loading': 'Loading…',
  'common.backHome': 'Back to the storefront',
  'common.page': 'Page',
  'empty.notConfigured.title': 'Catalog not configured',
  'empty.notConfigured.description': 'This storefront has no configured catalog provider yet.',
  'empty.notSynced.title': 'Catalog not synced yet',
  'empty.notSynced.description': 'The first catalog sync has not completed for this storefront.',
  'empty.noResults.title': 'Nothing to show',
  'empty.noResults.description': 'No items matched the current state.',
  'empty.noSearch.title': 'Search the catalog',
  'empty.noSearch.description': 'Enter a query to search products.',
  'empty.noCollections.title': 'No collections yet',
  'empty.noCollections.description': 'Collections appear here after the first sync.',
  'empty.compareFew.title': 'Select at least two products',
  'empty.compareFew.description': 'Add products to the comparison from any product card, then open this page.',
  'empty.notFound.title': 'Page not found',
  'empty.notFound.description': 'The page you requested does not exist.',
  'error.title': 'Something went wrong',
  'error.network': 'The storefront API could not be reached.',
  'error.timeout': 'The storefront API did not respond in time.',
  'error.invalidResponse': 'The storefront API returned an unexpected payload.',
  'error.invalidHost': 'This request carried an invalid storefront host.',
  'error.unknownStorefront': 'This domain is not configured as a storefront.',
  'error.notConfigured': 'The catalog provider is not configured for this storefront.',
  'error.notFound': 'The requested catalog entry was not found.',
  'error.badRequest': 'The request was rejected as invalid.',
  'error.unauthorized': 'Authentication is required for this action.',
  'error.forbidden': 'This action is not permitted.',
  'error.conflict': 'The request conflicts with the current state.',
  'error.unprocessable': 'The request could not be processed.',
  'error.unavailable': 'The storefront API is temporarily unavailable.',
  'error.internal': 'An unexpected internal error occurred.',
  'error.requestId': 'Reference',
  'status.NOT_CONFIGURED': 'Not configured',
  'status.NOT_SYNCED': 'Not synced',
  'status.IN_PROGRESS': 'Sync in progress',
  'status.STALE': 'Cached snapshot',
  'status.FRESH': 'Live',
  'status.updatedAt': 'Updated',
  'status.generation': 'Generation',
  'product.inStock': 'In stock',
  'product.outOfStock': 'Out of stock',
  'product.stockCount': '{count} in stock',
  'product.addCompare': 'Add to compare',
  'product.removeCompare': 'Remove from compare',
  'product.compareFull': 'Comparison is full (4 products)',
  'product.selectOptions': 'Select all options to see availability.',
  'product.combinationUnavailable': 'This combination is unavailable.',
  'product.priceRange': 'Price range',
  'product.compareAt': 'Was',
  'product.related': 'Related products',
  'product.relatedCollection': 'Shared collection',
  'product.relatedProductType': 'Same type: {value}',
  'product.compatibility': 'Compatibility',
  'product.compatibilityUnknown': 'Not declared by the merchant.',
  'product.personalization': 'Configuration options',
  'product.attributes': 'Attributes',
  'product.options': 'Options',
  'product.description': 'Description',
  'product.noDescription': 'No description provided.',
  'product.mediaCount': '{image} images · {video} videos',
  'product.viewDetails': 'View details',
  'product.backToProducts': 'All products',
  'filters.title': 'Filters',
  'filters.keyword': 'Keyword',
  'filters.availability': 'Availability',
  'filters.any': 'Any',
  'filters.inStock': 'In stock',
  'filters.outOfStock': 'Out of stock',
  'filters.productType': 'Product type',
  'filters.vendor': 'Vendor',
  'filters.priceMin': 'Min price',
  'filters.priceMax': 'Max price',
  'filters.attribute': 'Attributes',
  'filters.sort': 'Sort',
  'filters.facetsUnavailable': 'Facets are unavailable right now — sorting, keyword and price filters still apply.',
  'sort.title-asc': 'Title A–Z',
  'sort.title-desc': 'Title Z–A',
  'sort.price-asc': 'Price low to high',
  'sort.price-desc': 'Price high to low',
  'sort.updated-desc': 'Newest first',
  'sort.updated-asc': 'Oldest first',
  'compare.title': 'Compare products',
  'compare.remove': 'Remove',
  'compare.unavailable': 'Unavailable',
  'compare.trayCount': '{count} selected for comparison',
  'compare.trayCta': 'Compare now',
  'search.degraded': 'Semantic retrieval unavailable; showing lexical results.',
  'search.bounded': 'Top ranked matches shown. Refine your search for more specific results.',
  'search.title': 'Search',
  'search.placeholder': 'Search products…',
  'search.submit': 'Search',
  'search.resultsFor': 'Results for “{q}”',
  'prefs.title': 'Preferences',
  'prefs.session': 'Visitor session',
  'prefs.sessionLoading': 'Checking session…',
  'prefs.sessionActive': 'Active session',
  'prefs.sessionAnonymous': 'No active session',
  'prefs.sessionExpired': 'Session expired',
  'prefs.sessionError': 'Session error',
  'prefs.expiresAt': 'Expires',
  'prefs.sessionId': 'Session',
  'prefs.createSession': 'Create session',
  'prefs.restoreSession': 'Restore session',
  'prefs.refreshSession': 'Refresh session',
  'prefs.endSession': 'End session',
  'prefs.consents': 'Consent preferences',
  'prefs.consentsHint': 'Changes are recorded only for a verified customer identity.',
  'prefs.sessionRequired': 'Create a session to record consent changes.',
  'prefs.notLinked': 'Not linked to a verified customer identity — updates require identity verification.',
  'prefs.granted': 'Granted',
  'prefs.withdrawn': 'Withdrawn',
  'prefs.notSet': 'Not set',
  'prefs.allow': 'Allow',
  'prefs.withdraw': 'Withdraw',
  'prefs.purpose.analytics': 'Analytics',
  'prefs.purpose.marketing_email': 'Email marketing',
  'prefs.purpose.marketing_push': 'Push notifications',
  'prefs.purpose.personalization': 'Personalization',
  'prefs.purpose.data_retention': 'Data retention',
  'home.eyebrow': 'Storefront',
  'home.categoriesTitle': 'Shop by collection',
  'home.recentTitle': 'Recently updated',
  'home.editorialTitle': 'From the workshop',
  'home.viewCollections': 'All collections',
  'editorial.readMore': 'Journal',
  'boundary.label': 'Adaptive content boundary',
  'adaptive.returnToGeneral': 'Return to general exploration',
  'adaptive.freshness.fresh': 'Grounded live catalog',
  'adaptive.freshness.stale': 'Cached catalog snapshot',
  'adaptive.mode.adaptive': 'Personalized view',
  'adaptive.mode.baseline': 'Non-personalized market view',
  'adaptive.validationFallback': 'Showing standard storefront exploration.',
  'shopper.trigger': 'Personal Shopper',
  'shopper.title': 'Personal Shopper',
  'shopper.subtitle': 'Grounded to active store, market, and availability.',
  'shopper.close': 'Close Personal Shopper',
  'shopper.newConversation': 'New conversation',
  'shopper.inputLabel': 'Ask the Personal Shopper',
  'shopper.placeholder': 'Ask about products, dimensions, compatibility, or comparisons…',
  'shopper.send': 'Send',
  'shopper.stop': 'Stop',
  'shopper.publishProposal': 'Apply to storefront',
  'shopper.publishedBadge': 'Applied to storefront',
  'shopper.staleProposal': 'Context updated — ask to refresh before applying.',
  'shopper.streaming': 'Checking live catalog…',
  'shopper.reconnecting': 'Reconnecting live stream…',
  'shopper.resynced': 'Synchronized latest session state.',
  'shopper.emptyHint': 'Browse normally or ask a question — filters, comparisons, and product selections stay synchronized.',
  'shopper.unavailableRuntime': 'Personal Shopper is currently unavailable. Standard catalog search, filters, and adaptive sections remain active.',
  'shopper.sessionRequired': 'Start a visitor session to chat with the Personal Shopper.',
  'loading.page': 'Loading catalog…',
} as const;

export type MessageKey = keyof typeof en;

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = { en };

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Locale-aware money formatting driven by the verified price currency. */
export function formatMoney(price: { amount: string; currencyCode: string }): string {
  const value = Number(price.amount);
  if (!Number.isFinite(value)) return `${price.amount} ${price.currencyCode}`;
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: price.currencyCode }).format(value);
  } catch {
    return `${price.amount} ${price.currencyCode}`;
  }
}

/** Deterministic UTC date/time rendering for freshness timestamps. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`;
}
