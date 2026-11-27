'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import {
  emptyExplorationCriteria,
  type ExplorationCriteria,
  type InteractionEvent,
} from '@vaarg/shared';
import { ingestInteractions } from '../lib/experience-client';
import { useCompare } from './CompareProvider';
import { useOptionalSession } from './SessionProvider';

/** Distributive omit of the client-assigned eventId. */
type EventDraft = InteractionEvent extends infer E
  ? E extends InteractionEvent
    ? Omit<E, 'eventId'>
    : never
  : never;

function postDraft(draft: EventDraft, keepalive: boolean): void {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return;
  const event: InteractionEvent = { ...draft, eventId: crypto.randomUUID() } as InteractionEvent;
  // Fire-and-forget: adaptation telemetry must never block navigation.
  void ingestInteractions([event], undefined, { keepalive });
}

function useSessionReady(): boolean {
  const session = useOptionalSession();
  return session?.view === 'active';
}

/** Posts a page-view style event once, when the visitor session is active. */
function OnceReporter({ draft }: { draft: EventDraft }): null {
  const ready = useSessionReady();
  const postedRef = useRef(false);
  useEffect(() => {
    if (!ready || postedRef.current) return;
    postedRef.current = true;
    postDraft(draft, false);
    // Post once per mount: `draft` is intentionally not a dependency.
  }, [ready]);
  return null;
}

export function ProductViewReporter({ productRef }: { productRef: string }): ReactElement | null {
  return <OnceReporter draft={{ type: 'product_viewed', productRef }} />;
}

export function CollectionViewReporter({ collection }: { collection: string }): ReactElement | null {
  return <OnceReporter draft={{ type: 'collection_viewed', collection }} />;
}

export function SearchViewReporter({ query }: { query: string }): ReactElement | null {
  if (!query) return null;
  return <OnceReporter draft={{ type: 'search_submitted', query }} />;
}

function text(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * filter_changed from the server-rendered GET filter form: observes submit
 * (never prevents it) and reports the resulting criteria with `keepalive`
 * so the navigation is not debounced or delayed.
 */
export function FilterReporter(): ReactElement {
  const ready = useSessionReady();
  const spanRef = useRef<HTMLSpanElement>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => {
    const form = spanRef.current?.closest('form');
    if (!form) return;
    const onSubmit = (): void => {
      if (!readyRef.current) return;
      const data = new FormData(form as HTMLFormElement);
      const attribute = text(data.get('attribute'));
      const attributes: ExplorationCriteria['attributes'] = [];
      if (attribute) {
        const separator = attribute.indexOf(':');
        const name = separator > 0 ? attribute.slice(0, separator) : attribute;
        const value = separator > 0 ? attribute.slice(separator + 1) : '';
        if (value) attributes.push({ name, value });
      }
      const criteria: ExplorationCriteria = {
        ...emptyExplorationCriteria(),
        query: text(data.get('q')),
        productType: text(data.get('productType')),
        vendor: text(data.get('vendor')),
        collection: text(data.get('collection')),
        priceMin: text(data.get('priceMin')),
        priceMax: text(data.get('priceMax')),
        attributes,
      };
      postDraft({ type: 'filter_changed', filters: criteria }, true);
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);
  return <span ref={spanRef} hidden aria-hidden="true" />;
}

/**
 * comparison_changed from the shared compare selection: reports added and
 * removed refs when the selection actually changes (initial state is not a
 * change). Mounted once inside CompareProvider.
 */
export function CompareReporter(): null {
  const ready = useSessionReady();
  const compare = useCompare();
  const idsKey = compare.ids.join(',');
  const prevRef = useRef<string[]>([]);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const firstRef = useRef(true);
  useEffect(() => {
    const current = idsKey ? idsKey.split(',') : [];
    const previous = prevRef.current;
    prevRef.current = current;
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    const added = current.filter((entry) => !previous.includes(entry));
    const removed = previous.filter((entry) => !current.includes(entry));
    if (added.length === 0 && removed.length === 0) return;
    if (!readyRef.current) return;
    postDraft({ type: 'comparison_changed', added, removed }, false);
  }, [idsKey]);
  return null;
}
