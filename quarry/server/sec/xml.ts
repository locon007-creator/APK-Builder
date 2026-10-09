import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,   // keep raw strings; we convert explicitly
  trimValues: true,
  isArray: (name) => ['infoTable', 'reportingOwner', 'nonDerivativeTransaction', 'derivativeTransaction', 'footnote', 'footnoteId'].includes(name),
});

export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

export type Node = Record<string, unknown> | string | undefined | null;

export function child(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function text(node: unknown, ...path: string[]): string | null {
  const v = child(node, ...path);
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    const s = String(v).trim();
    return s === '' ? null : s;
  }
  // Elements such as <value>…</value> wrapped in another element
  if (typeof v === 'object' && 'value' in (v as object)) return text(v, 'value');
  if (typeof v === 'object' && '#text' in (v as object)) return text(v, '#text');
  return null;
}

export function num(node: unknown, ...path: string[]): number | null {
  const s = text(node, ...path);
  if (s == null) return null;
  const n = Number(s.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function bool(node: unknown, ...path: string[]): boolean {
  const s = text(node, ...path);
  return s != null && /^(1|true|y|yes)$/i.test(s);
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Depth-first search for the first key matching a predicate (namespace-agnostic fallback). */
export function findKey(node: unknown, pred: (key: string) => boolean, depth = 0): unknown {
  if (node == null || typeof node !== 'object' || depth > 12) return undefined;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (pred(k)) return v;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const found = findKey(v, pred, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
