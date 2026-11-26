import type { CatalogV1ProductDetail, CatalogV1Variant } from '@vaarg/shared';

/**
 * Deterministic variant selection (FL04):
 * - an explicit `?variant=` id wins when it matches a real variant;
 * - otherwise the first `availableForSale` variant is selected — an
 *   unavailable variant is never selected silently;
 * - a full option selection resolves to exactly one variant or to nothing —
 *   a non-matching combination is surfaced as unavailable, never substituted.
 */
export type OptionSelection = Record<string, string>;
export type ProductOption = CatalogV1ProductDetail['options'][number];

export function selectionFromVariant(variant: CatalogV1Variant, options: ProductOption[]): OptionSelection {
  const selection: OptionSelection = {};
  for (const option of options) {
    const match = variant.selectedOptions.find((entry) => entry.name === option.name);
    if (match) selection[option.name] = match.value;
  }
  return selection;
}

/** True when every product option has a chosen value. */
export function isSelectionComplete(options: ProductOption[], selection: OptionSelection): boolean {
  return options.every((option) => typeof selection[option.name] === 'string');
}

/** Exact variant for a complete selection; null when incomplete or unmatched. */
export function findVariant(
  variants: CatalogV1Variant[],
  options: ProductOption[],
  selection: OptionSelection,
): CatalogV1Variant | null {
  if (!isSelectionComplete(options, selection)) return null;
  return (
    variants.find((variant) =>
      options.every((option) =>
        variant.selectedOptions.some((entry) => entry.name === option.name && entry.value === selection[option.name]),
      ),
    ) ?? null
  );
}

/**
 * Initial selection: explicit variant id first (even an unavailable one — the
 * user asked for it), then the first available variant, then no selection.
 */
export function initialSelection(
  variants: CatalogV1Variant[],
  options: ProductOption[],
  preferredVariantId?: string,
): OptionSelection | null {
  if (preferredVariantId) {
    const preferred = variants.find((variant) => variant.id === preferredVariantId);
    if (preferred) return selectionFromVariant(preferred, options);
  }
  // No option axes: there is no choice to make — resolve the single path.
  if (options.length === 0) return {};
  const firstAvailable = variants.find((variant) => variant.availableForSale);
  return firstAvailable ? selectionFromVariant(firstAvailable, options) : null;
}
