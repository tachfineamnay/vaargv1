import {
  A2UI_LIMITS,
  A2UI_PROTOCOL_VERSION,
  FUTURE_VAARG_A2UI_COMPONENTS,
  VAARG_A2UI_CATALOG_ID,
  a2uiCreateSurfaceMessageSchema,
  a2uiDataBindingSchema,
  a2uiDeleteSurfaceMessageSchema,
  a2uiUpdateComponentsMessageSchema,
  a2uiUpdateDataModelMessageSchema,
  extractSurfaceOwnerSessionId,
  isA2UiDataBinding,
  resolvedVaargA2UiComponentSchema,
  type A2UiAgentToRendererMessage,
  type A2UiSurfaceMetadata,
  type ResolvedVaargA2UiComponent,
} from './a2ui.js';
import { isStaleResponse, type RevisionEnvelope } from './experience.js';

export type A2UiValidationErrorCode =
  | 'MESSAGE_TOO_LARGE'
  | 'PROTOTYPE_POLLUTION_REJECTED'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'UNSUPPORTED_RENDERER_FUNCTION'
  | 'FORBIDDEN_PAYLOAD_CONTENT'
  | 'UNAUTHORIZED_CATALOG_ID'
  | 'SURFACE_OWNERSHIP_MISMATCH'
  | 'STALE_SURFACE_REJECTED'
  | 'CONSENT_WITHDRAWN'
  | 'SURFACE_NOT_FOUND'
  | 'INVALID_WIRE_MESSAGE'
  | 'DATA_MODEL_TOO_LARGE'
  | 'INVALID_DATA_BINDING'
  | 'UNSUPPORTED_FUTURE_COMPONENT'
  | 'UNKNOWN_COMPONENT_TYPE'
  | 'DUPLICATE_COMPONENT_ID'
  | 'MISSING_ROOT_COMPONENT'
  | 'MISSING_CHILD_COMPONENT'
  | 'COMPONENT_CYCLE_DETECTED'
  | 'MAX_DEPTH_EXCEEDED'
  | 'ORPHAN_COMPONENT_DETECTED'
  | 'INVALID_COMPONENT_PROPS'
  | 'UNAPPROVED_URL_REJECTED'
  | 'UNVERIFIED_CATALOG_REFERENCE';

export interface ValidatedA2UiSurfaceState {
  surfaceId: string;
  catalogId: string;
  metadata: A2UiSurfaceMetadata;
  dataModel: Record<string, unknown>;
  componentsById: ReadonlyMap<string, ResolvedVaargA2UiComponent>;
  rootId: 'root';
}

export type A2UiValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: A2UiValidationErrorCode;
      message: string;
      path?: string;
    };

export interface A2UiValidationOptions {
  expectedSessionId: string;
  currentRevision?: RevisionEnvelope | null;
  personalizationGranted?: boolean;
  verifiedProductIds?: ReadonlySet<string>;
  verifiedCollectionHandles?: ReadonlySet<string>;
}

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const FORBIDDEN_EXECUTABLE_PATTERN =
  /(<\s*\/?\s*(?:script|iframe|object|embed|style|link|meta|svg|math|form|input|textarea)\b|javascript\s*:|vbscript\s*:|data\s*:\s*(?:text\/html|application\/javascript|image\/svg\+xml)|\bon[a-z]{2,24}\s*=|@import\b|expression\s*\(|\bimport\s*\(|\bdocument\.cookie\b|\blocalStorage\b|\bsessionStorage\b|\bfile:\/\/)/i;

const FUTURE_COMPONENT_SET = new Set<string>(FUTURE_VAARG_A2UI_COMPONENTS);

function utf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Recursively inspects own property names and values before/after parsing to
 * block prototype pollution, renderer RPC (`@call`, `functionCall`,
 * `callRendererFunction`), and executable/HTML/CSS/cookie-access payloads.
 */
export function scanForUnsafeConstructs(
  value: unknown,
  path = '$',
  depth = 0,
): A2UiValidationResult<true> {
  if (depth > 16) {
    return {
      ok: false,
      code: 'MAX_DEPTH_EXCEEDED',
      message: 'Nested object depth exceeded maximum security bound',
      path,
    };
  }
  if (typeof value === 'string') {
    if (FORBIDDEN_EXECUTABLE_PATTERN.test(value)) {
      return {
        ok: false,
        code: 'FORBIDDEN_PAYLOAD_CONTENT',
        message: 'Executable, HTML, CSS, script, or storage/cookie access content is forbidden',
        path,
      };
    }
    return { ok: true, value: true };
  }
  if (!value || typeof value !== 'object') {
    return { ok: true, value: true };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const itemCheck = scanForUnsafeConstructs(value[i], `${path}[${i}]`, depth + 1);
      if (!itemCheck.ok) return itemCheck;
    }
    return { ok: true, value: true };
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return {
      ok: false,
      code: 'PROTOTYPE_POLLUTION_REJECTED',
      message: 'Non-plain object prototype rejected',
      path,
    };
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (POLLUTION_KEYS.has(key)) {
      return {
        ok: false,
        code: 'PROTOTYPE_POLLUTION_REJECTED',
        message: `Forbidden prototype-pollution key "${key}" rejected`,
        path: `${path}.${key}`,
      };
    }
    if (
      key === '@call' ||
      key === 'functionCall' ||
      key === 'callRendererFunction' ||
      key === 'agentFunctionResponse' ||
      key === 'callAgentFunction' ||
      key === 'rendererFunctionResponse'
    ) {
      return {
        ok: false,
        code: 'UNSUPPORTED_RENDERER_FUNCTION',
        message: `Arbitrary renderer/agent function execution ("${key}") is disabled by VAARG security policy`,
        path: `${path}.${key}`,
      };
    }
    const childCheck = scanForUnsafeConstructs(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      depth + 1,
    );
    if (!childCheck.ok) return childCheck;
  }
  return { ok: true, value: true };
}

function unescapeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolves an RFC 6901 JSON Pointer (`/products/0`, `/collections`, etc.)
 * against a plain `dataModel` object with strict segment and anti-pollution bounds.
 */
export function resolveA2UiPointer(
  dataModel: Record<string, unknown>,
  pointer: string,
): A2UiValidationResult<unknown> {
  const parsedPtr = a2uiDataBindingSchema.shape['@path'].safeParse(pointer);
  if (!parsedPtr.success) {
    return {
      ok: false,
      code: 'INVALID_DATA_BINDING',
      message: `Invalid RFC 6901 JSON Pointer "${pointer}"`,
      path: pointer,
    };
  }
  const rawTokens = pointer.slice(1).split('/');
  if (rawTokens.length > A2UI_LIMITS.maxPointerDepth) {
    return {
      ok: false,
      code: 'INVALID_DATA_BINDING',
      message: `JSON Pointer "${pointer}" exceeds max depth ${A2UI_LIMITS.maxPointerDepth}`,
      path: pointer,
    };
  }

  let cursor: unknown = dataModel;
  for (const rawToken of rawTokens) {
    const token = unescapeJsonPointerToken(rawToken);
    if (POLLUTION_KEYS.has(token) || token === '..' || token === '.') {
      return {
        ok: false,
        code: 'PROTOTYPE_POLLUTION_REJECTED',
        message: `Unsafe JSON Pointer segment "${token}"`,
        path: pointer,
      };
    }
    if (!cursor || typeof cursor !== 'object') {
      return {
        ok: false,
        code: 'INVALID_DATA_BINDING',
        message: `Unresolvable JSON Pointer "${pointer}"`,
        path: pointer,
      };
    }
    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(token)) {
        return {
          ok: false,
          code: 'INVALID_DATA_BINDING',
          message: `Expected array index in JSON Pointer "${pointer}"`,
          path: pointer,
        };
      }
      const idx = Number.parseInt(token, 10);
      if (idx < 0 || idx >= cursor.length) {
        return {
          ok: false,
          code: 'INVALID_DATA_BINDING',
          message: `Out-of-bounds array index in JSON Pointer "${pointer}"`,
          path: pointer,
        };
      }
      cursor = cursor[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cursor, token)) {
        return {
          ok: false,
          code: 'INVALID_DATA_BINDING',
          message: `Missing key "${token}" for JSON Pointer "${pointer}"`,
          path: pointer,
        };
      }
      cursor = (cursor as Record<string, unknown>)[token];
    }
  }
  return { ok: true, value: cursor };
}

function applyDataModelUpdate(
  current: Record<string, unknown>,
  pointer: string,
  value: unknown,
): A2UiValidationResult<Record<string, unknown>> {
  if (pointer === '/') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        code: 'INVALID_WIRE_MESSAGE',
        message: 'Root updateDataModel value ("/") must be a JSON object',
        path: '/',
      };
    }
    return { ok: true, value: structuredClone(value as Record<string, unknown>) };
  }

  const rawTokens = pointer.slice(1).split('/');
  if (rawTokens.length === 0 || rawTokens.length > A2UI_LIMITS.maxPointerDepth) {
    return {
      ok: false,
      code: 'INVALID_DATA_BINDING',
      message: `Invalid updateDataModel path "${pointer}"`,
      path: pointer,
    };
  }

  const next = structuredClone(current);
  let target: Record<string, unknown> = next;
  for (let i = 0; i < rawTokens.length - 1; i += 1) {
    const token = unescapeJsonPointerToken(rawTokens[i]!);
    if (POLLUTION_KEYS.has(token)) {
      return {
        ok: false,
        code: 'PROTOTYPE_POLLUTION_REJECTED',
        message: `Forbidden segment "${token}" in updateDataModel`,
        path: pointer,
      };
    }
    const existing = target[token];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      const created: Record<string, unknown> = {};
      target[token] = created;
      target = created;
    } else {
      target = existing as Record<string, unknown>;
    }
  }

  const leaf = unescapeJsonPointerToken(rawTokens[rawTokens.length - 1]!);
  if (POLLUTION_KEYS.has(leaf)) {
    return {
      ok: false,
      code: 'PROTOTYPE_POLLUTION_REJECTED',
      message: `Forbidden leaf segment "${leaf}" in updateDataModel`,
      path: pointer,
    };
  }
  if (value === null) {
    delete target[leaf];
  } else {
    target[leaf] = structuredClone(value);
  }
  return { ok: true, value: next };
}

function resolveBindingsDeep(
  raw: unknown,
  dataModel: Record<string, unknown>,
  path: string,
  depth = 0,
): A2UiValidationResult<unknown> {
  if (depth > 10) {
    return {
      ok: false,
      code: 'MAX_DEPTH_EXCEEDED',
      message: 'Binding resolution exceeded maximum nesting depth',
      path,
    };
  }
  if (isA2UiDataBinding(raw)) {
    const bound = a2uiDataBindingSchema.safeParse(raw);
    if (!bound.success) {
      return {
        ok: false,
        code: 'INVALID_DATA_BINDING',
        message: bound.error.issues.map((i) => i.message).join('; '),
        path,
      };
    }
    return resolveA2UiPointer(dataModel, bound.data['@path']);
  }
  if (Array.isArray(raw)) {
    const out: unknown[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const res = resolveBindingsDeep(raw[i], dataModel, `${path}[${i}]`, depth + 1);
      if (!res.ok) return res;
      out.push(res.value);
    }
    return { ok: true, value: out };
  }
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const res = resolveBindingsDeep(v, dataModel, `${path}.${k}`, depth + 1);
      if (!res.ok) return res;
      out[k] = res.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value: raw };
}

function verifyApprovedImageUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.internal') ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '[::1]'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function verifyResolvedCatalogAndUrls(
  component: ResolvedVaargA2UiComponent,
  options: A2UiValidationOptions,
): A2UiValidationResult<true> {
  const checkProduct = (product: { id: string; image: { url: string } | null }): A2UiValidationResult<true> => {
    if (options.verifiedProductIds && !options.verifiedProductIds.has(product.id)) {
      return {
        ok: false,
        code: 'UNVERIFIED_CATALOG_REFERENCE',
        message: `Unverified product reference "${product.id}" in component "${component.id}"`,
        path: component.id,
      };
    }
    if (product.image && !verifyApprovedImageUrl(product.image.url)) {
      return {
        ok: false,
        code: 'UNAPPROVED_URL_REJECTED',
        message: `Unapproved image URL in product "${product.id}"`,
        path: component.id,
      };
    }
    return { ok: true, value: true };
  };

  const checkCollection = (collection: {
    handle: string;
    image: { url: string } | null;
  }): A2UiValidationResult<true> => {
    if (options.verifiedCollectionHandles && !options.verifiedCollectionHandles.has(collection.handle)) {
      return {
        ok: false,
        code: 'UNVERIFIED_CATALOG_REFERENCE',
        message: `Unverified collection handle "${collection.handle}" in component "${component.id}"`,
        path: component.id,
      };
    }
    if (collection.image && !verifyApprovedImageUrl(collection.image.url)) {
      return {
        ok: false,
        code: 'UNAPPROVED_URL_REJECTED',
        message: `Unapproved image URL in collection "${collection.handle}"`,
        path: component.id,
      };
    }
    return { ok: true, value: true };
  };

  switch (component.component) {
    case 'CategoryTile':
    case 'CollectionGrid':
      for (const col of component.collections) {
        const res = checkCollection(col);
        if (!res.ok) return res;
      }
      return { ok: true, value: true };
    case 'ProductCard':
      return checkProduct(component.product);
    case 'ProductGrid':
    case 'ProductComparator':
      for (const prod of component.products) {
        const res = checkProduct(prod);
        if (!res.ok) return res;
      }
      return { ok: true, value: true };
    case 'Recommendations':
      for (const prod of component.products) {
        const res = checkProduct(prod);
        if (!res.ok) return res;
      }
      if (component.items) {
        for (const item of component.items) {
          const res = checkProduct(item.summary);
          if (!res.ok) return res;
        }
      }
      return { ok: true, value: true };
    case 'ProductGallery':
      for (const img of component.images) {
        if (!verifyApprovedImageUrl(img.url)) {
          return {
            ok: false,
            code: 'UNAPPROVED_URL_REJECTED',
            message: `Unapproved gallery image URL in "${component.id}"`,
            path: component.id,
          };
        }
      }
      return { ok: true, value: true };
    default:
      return { ok: true, value: true };
  }
}

function validateComponentTree(
  rawComponents: ReadonlyArray<Record<string, unknown>>,
  dataModel: Record<string, unknown>,
  options: A2UiValidationOptions,
): A2UiValidationResult<ReadonlyMap<string, ResolvedVaargA2UiComponent>> {
  if (rawComponents.length < 1 || rawComponents.length > A2UI_LIMITS.maxComponents) {
    return {
      ok: false,
      code: 'INVALID_WIRE_MESSAGE',
      message: `Component count (${rawComponents.length}) must be between 1 and ${A2UI_LIMITS.maxComponents}`,
    };
  }

  const resolvedMap = new Map<string, ResolvedVaargA2UiComponent>();
  const rawById = new Map<string, Record<string, unknown>>();

  for (const rawComp of rawComponents) {
    const id = typeof rawComp.id === 'string' ? rawComp.id : '';
    const compType = typeof rawComp.component === 'string' ? rawComp.component : '';
    if (!id) {
      return {
        ok: false,
        code: 'INVALID_COMPONENT_PROPS',
        message: 'Every A2UI component requires a string id',
      };
    }
    if (rawById.has(id)) {
      return {
        ok: false,
        code: 'DUPLICATE_COMPONENT_ID',
        message: `Duplicate A2UI component id "${id}"`,
        path: id,
      };
    }
    if (compType === 'Surface') {
      return {
        ok: false,
        code: 'UNKNOWN_COMPONENT_TYPE',
        message: 'Reserved "Surface" type must not appear in updateComponents',
        path: id,
      };
    }
    if (FUTURE_COMPONENT_SET.has(compType)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_FUTURE_COMPONENT',
        message: `Component "${compType}" belongs to a future phase (FL08–FL10) and is not enabled`,
        path: id,
      };
    }
    if (
      rawComp['@catalogId'] !== undefined &&
      rawComp['@catalogId'] !== VAARG_A2UI_CATALOG_ID
    ) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_CATALOG_ID',
        message: `Component "${id}" specifies unauthorized @catalogId`,
        path: id,
      };
    }
    rawById.set(id, rawComp);
  }

  if (!rawById.has('root')) {
    return {
      ok: false,
      code: 'MISSING_ROOT_COMPONENT',
      message: 'A2UI surface must define a component with id "root"',
      path: 'root',
    };
  }

  // Resolve data bindings and validate every component's strict schema
  for (const [id, rawComp] of rawById.entries()) {
    const bound = resolveBindingsDeep(rawComp, dataModel, `components.${id}`);
    if (!bound.ok) return bound;

    const compType = (bound.value as Record<string, unknown>).component;
    const parsedComp = resolvedVaargA2UiComponentSchema.safeParse(bound.value);
    if (!parsedComp.success) {
      const knownTypes = new Set([
        'AdaptiveBento',
        'CategoryTile',
        'CollectionGrid',
        'ProductCard',
        'ProductGrid',
        'ProductGallery',
        'Recommendations',
        'ProductComparator',
        'SuggestionChips',
        'GuidedQuestions',
      ]);
      if (typeof compType !== 'string' || !knownTypes.has(compType)) {
        return {
          ok: false,
          code: 'UNKNOWN_COMPONENT_TYPE',
          message: `Unknown A2UI component type "${String(compType)}"`,
          path: id,
        };
      }
      return {
        ok: false,
        code: 'INVALID_COMPONENT_PROPS',
        message: `Invalid props on "${id}" (${compType}): ${parsedComp.error.issues.map((i) => i.message).join('; ')}`,
        path: id,
      };
    }

    const refCheck = verifyResolvedCatalogAndUrls(parsedComp.data, options);
    if (!refCheck.ok) return refCheck;

    resolvedMap.set(id, parsedComp.data);
  }

  // Validate child existence, DAG acyclicity, max depth, and full reachability from "root"
  const state = new Map<string, 'visiting' | 'visited'>();
  const walk = (nodeId: string, depth: number): A2UiValidationResult<true> => {
    if (depth > A2UI_LIMITS.maxDepth) {
      return {
        ok: false,
        code: 'MAX_DEPTH_EXCEEDED',
        message: `A2UI component tree exceeded max depth ${A2UI_LIMITS.maxDepth} at "${nodeId}"`,
        path: nodeId,
      };
    }
    const currentState = state.get(nodeId);
    if (currentState === 'visiting') {
      return {
        ok: false,
        code: 'COMPONENT_CYCLE_DETECTED',
        message: `Cycle detected in A2UI component graph involving "${nodeId}"`,
        path: nodeId,
      };
    }
    if (currentState === 'visited') {
      return { ok: true, value: true };
    }

    const node = resolvedMap.get(nodeId);
    if (!node) {
      return {
        ok: false,
        code: 'MISSING_CHILD_COMPONENT',
        message: `Referenced child component "${nodeId}" does not exist`,
        path: nodeId,
      };
    }

    state.set(nodeId, 'visiting');
    if (node.component === 'AdaptiveBento') {
      for (const childId of node.children) {
        if (!resolvedMap.has(childId)) {
          return {
            ok: false,
            code: 'MISSING_CHILD_COMPONENT',
            message: `Container "${nodeId}" references missing child "${childId}"`,
            path: `${nodeId}.children`,
          };
        }
        const childWalk = walk(childId, depth + 1);
        if (!childWalk.ok) return childWalk;
      }
    }
    state.set(nodeId, 'visited');
    return { ok: true, value: true };
  };

  const rootWalk = walk('root', 1);
  if (!rootWalk.ok) return rootWalk;

  // Inspect remaining nodes so disconnected cycles are flagged as cycles before orphans
  for (const id of resolvedMap.keys()) {
    if (!state.has(id)) {
      // Check if unreachable subgraph contains a cycle first
      const subState = new Map<string, 'visiting' | 'visited'>();
      const checkCycle = (nid: string): boolean => {
        if (subState.get(nid) === 'visiting') return true;
        if (subState.get(nid) === 'visited') return false;
        subState.set(nid, 'visiting');
        const n = resolvedMap.get(nid);
        if (n?.component === 'AdaptiveBento') {
          for (const cid of n.children) {
            if (resolvedMap.has(cid) && checkCycle(cid)) return true;
          }
        }
        subState.set(nid, 'visited');
        return false;
      };
      if (checkCycle(id)) {
        return {
          ok: false,
          code: 'COMPONENT_CYCLE_DETECTED',
          message: `Cycle detected in A2UI component graph involving "${id}"`,
          path: id,
        };
      }
      return {
        ok: false,
        code: 'ORPHAN_COMPONENT_DETECTED',
        message: `Component "${id}" is unreachable from "root"`,
        path: id,
      };
    }
  }

  return { ok: true, value: resolvedMap };
}

/**
 * Validates and applies an ordered batch of A2UI 1.0 messages against an
 * optional existing surface map, returning an updated immutable surface map.
 * On ANY validation error, fails closed and leaves existing surfaces untouched.
 */
export function applyAndValidateA2UiSurfaceMessages(
  messages: readonly unknown[],
  options: A2UiValidationOptions,
  existingSurfaces: ReadonlyMap<string, ValidatedA2UiSurfaceState> = new Map(),
): A2UiValidationResult<Map<string, ValidatedA2UiSurfaceState>> {
  const working = new Map<string, ValidatedA2UiSurfaceState>(existingSurfaces);
  const rawComponentsWork = new Map<string, ReadonlyArray<Record<string, unknown>>>();

  for (let idx = 0; idx < messages.length; idx += 1) {
    const rawMsg = messages[idx];
    if (!rawMsg || typeof rawMsg !== 'object' || Array.isArray(rawMsg)) {
      return {
        ok: false,
        code: 'INVALID_WIRE_MESSAGE',
        message: `A2UI message at index ${idx} must be a JSON object`,
      };
    }

    let msgBytes = 0;
    try {
      msgBytes = utf8ByteLength(rawMsg);
    } catch {
      return {
        ok: false,
        code: 'INVALID_WIRE_MESSAGE',
        message: 'Unserializable A2UI message',
      };
    }
    if (msgBytes > A2UI_LIMITS.maxMessageBytes) {
      return {
        ok: false,
        code: 'MESSAGE_TOO_LARGE',
        message: `A2UI message (${msgBytes} bytes) exceeds max ${A2UI_LIMITS.maxMessageBytes} bytes`,
      };
    }

    const unsafeScan = scanForUnsafeConstructs(rawMsg, `messages[${idx}]`);
    if (!unsafeScan.ok) return unsafeScan;

    const rec = rawMsg as Record<string, unknown>;
    if (rec.version !== A2UI_PROTOCOL_VERSION) {
      return {
        ok: false,
        code: 'UNSUPPORTED_PROTOCOL_VERSION',
        message: `Expected A2UI protocol version "${A2UI_PROTOCOL_VERSION}", received "${String(rec.version)}"`,
      };
    }

    if ('createSurface' in rec) {
      const parsed = a2uiCreateSurfaceMessageSchema.safeParse(rawMsg);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_WIRE_MESSAGE',
          message: `Invalid createSurface: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        };
      }
      const { surfaceId, catalogId, metadata, dataModel, components } = parsed.data.createSurface;
      if (catalogId !== VAARG_A2UI_CATALOG_ID) {
        return {
          ok: false,
          code: 'UNAUTHORIZED_CATALOG_ID',
          message: `Unauthorized A2UI catalogId "${catalogId}"`,
          path: 'createSurface.catalogId',
        };
      }

      const ownerSessionId = extractSurfaceOwnerSessionId(surfaceId);
      if (
        !ownerSessionId ||
        ownerSessionId !== options.expectedSessionId ||
        metadata.sessionId !== options.expectedSessionId
      ) {
        return {
          ok: false,
          code: 'SURFACE_OWNERSHIP_MISMATCH',
          message: 'A2UI surface session ownership does not match active visitor session',
          path: 'createSurface.surfaceId',
        };
      }

      if (
        options.personalizationGranted === false &&
        metadata.personalizationApplied === true
      ) {
        return {
          ok: false,
          code: 'CONSENT_WITHDRAWN',
          message: 'Personalized A2UI surface rejected because personalization consent is withdrawn',
          path: 'createSurface.metadata.personalizationApplied',
        };
      }

      if (
        options.currentRevision &&
        isStaleResponse(options.currentRevision, {
          sessionId: metadata.sessionId,
          contextVersion: metadata.contextVersion,
          experienceRevision: metadata.experienceRevision,
        })
      ) {
        return {
          ok: false,
          code: 'STALE_SURFACE_REJECTED',
          message: 'Stale A2UI surface rejected (older contextVersion or experienceRevision)',
          path: 'createSurface.metadata',
        };
      }

      const initialModel = dataModel ? structuredClone(dataModel) : {};
      if (utf8ByteLength(initialModel) > A2UI_LIMITS.maxDataModelBytes) {
        return {
          ok: false,
          code: 'DATA_MODEL_TOO_LARGE',
          message: 'Initial A2UI dataModel exceeds byte limit',
        };
      }

      let resolvedComponents: ReadonlyMap<string, ResolvedVaargA2UiComponent> = new Map();
      if (components && components.length > 0) {
        const treeRes = validateComponentTree(components, initialModel, options);
        if (!treeRes.ok) return treeRes;
        resolvedComponents = treeRes.value;
        rawComponentsWork.set(surfaceId, components);
      }

      working.set(surfaceId, {
        surfaceId,
        catalogId,
        metadata,
        dataModel: initialModel,
        componentsById: resolvedComponents,
        rootId: 'root',
      });
      continue;
    }

    if ('updateDataModel' in rec) {
      const parsed = a2uiUpdateDataModelMessageSchema.safeParse(rawMsg);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_WIRE_MESSAGE',
          message: `Invalid updateDataModel: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        };
      }
      const { surfaceId, path, value } = parsed.data.updateDataModel;
      if (extractSurfaceOwnerSessionId(surfaceId) !== options.expectedSessionId) {
        return {
          ok: false,
          code: 'SURFACE_OWNERSHIP_MISMATCH',
          message: 'updateDataModel surfaceId does not belong to active visitor session',
        };
      }
      const surface = working.get(surfaceId);
      if (!surface) {
        return {
          ok: false,
          code: 'SURFACE_NOT_FOUND',
          message: `Cannot updateDataModel on unknown surface "${surfaceId}"`,
        };
      }

      const updatedModelRes = applyDataModelUpdate(surface.dataModel, path, value);
      if (!updatedModelRes.ok) return updatedModelRes;
      if (utf8ByteLength(updatedModelRes.value) > A2UI_LIMITS.maxDataModelBytes) {
        return {
          ok: false,
          code: 'DATA_MODEL_TOO_LARGE',
          message: `Surface dataModel exceeds max ${A2UI_LIMITS.maxDataModelBytes} bytes`,
        };
      }

      // If components already exist on this surface, re-validate bindings against updated dataModel
      const existingRawComps = rawComponentsWork.get(surfaceId);
      let nextComponents = surface.componentsById;
      if (existingRawComps && existingRawComps.length > 0) {
        const reval = validateComponentTree(existingRawComps, updatedModelRes.value, options);
        if (!reval.ok) return reval;
        nextComponents = reval.value;
      }

      working.set(surfaceId, {
        ...surface,
        dataModel: updatedModelRes.value,
        componentsById: nextComponents,
      });
      continue;
    }

    if ('updateComponents' in rec) {
      const parsed = a2uiUpdateComponentsMessageSchema.safeParse(rawMsg);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_WIRE_MESSAGE',
          message: `Invalid updateComponents: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        };
      }
      const { surfaceId, components } = parsed.data.updateComponents;
      if (extractSurfaceOwnerSessionId(surfaceId) !== options.expectedSessionId) {
        return {
          ok: false,
          code: 'SURFACE_OWNERSHIP_MISMATCH',
          message: 'updateComponents surfaceId does not belong to active visitor session',
        };
      }
      const surface = working.get(surfaceId);
      if (!surface) {
        return {
          ok: false,
          code: 'SURFACE_NOT_FOUND',
          message: `Cannot updateComponents on unknown surface "${surfaceId}"`,
        };
      }

      const treeRes = validateComponentTree(components, surface.dataModel, options);
      if (!treeRes.ok) return treeRes;

      const totalBytes =
        utf8ByteLength(surface.dataModel) + utf8ByteLength(components);
      if (totalBytes > A2UI_LIMITS.maxTotalSurfaceBytes) {
        return {
          ok: false,
          code: 'MESSAGE_TOO_LARGE',
          message: `Total surface state (${totalBytes} bytes) exceeds ${A2UI_LIMITS.maxTotalSurfaceBytes} bytes`,
        };
      }

      rawComponentsWork.set(surfaceId, components);
      working.set(surfaceId, {
        ...surface,
        componentsById: treeRes.value,
      });
      continue;
    }

    if ('deleteSurface' in rec) {
      const parsed = a2uiDeleteSurfaceMessageSchema.safeParse(rawMsg);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_WIRE_MESSAGE',
          message: `Invalid deleteSurface: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        };
      }
      const { surfaceId } = parsed.data.deleteSurface;
      if (extractSurfaceOwnerSessionId(surfaceId) !== options.expectedSessionId) {
        return {
          ok: false,
          code: 'SURFACE_OWNERSHIP_MISMATCH',
          message: 'deleteSurface surfaceId does not belong to active visitor session',
        };
      }
      working.delete(surfaceId);
      rawComponentsWork.delete(surfaceId);
      continue;
    }

    return {
      ok: false,
      code: 'INVALID_WIRE_MESSAGE',
      message: 'Unsupported A2UI message variant',
    };
  }

  for (const [sid, surface] of working.entries()) {
    if (surface.componentsById.size === 0 || !surface.componentsById.has('root')) {
      return {
        ok: false,
        code: 'MISSING_ROOT_COMPONENT',
        message: `Surface "${sid}" was created without a valid "root" component tree`,
        path: sid,
      };
    }
  }

  return { ok: true, value: working };
}

export function isValidA2UiAgentMessage(raw: unknown): raw is A2UiAgentToRendererMessage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const unsafe = scanForUnsafeConstructs(raw);
  if (!unsafe.ok) return false;
  return (
    a2uiCreateSurfaceMessageSchema.safeParse(raw).success ||
    a2uiUpdateDataModelMessageSchema.safeParse(raw).success ||
    a2uiUpdateComponentsMessageSchema.safeParse(raw).success ||
    a2uiDeleteSurfaceMessageSchema.safeParse(raw).success
  );
}
