import { UpstreamPayloadError } from "../errors.js";

const SPECIAL = new Map<number, unknown>([
  [-1, undefined],
  [-2, Number.NaN],
  [-3, Number.POSITIVE_INFINITY],
  [-4, Number.NEGATIVE_INFINITY],
  [-5, -0],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Decodes the reference-table representation used by SvelteKit's public
 * __data.json responses. It never evaluates JavaScript from the upstream page.
 */
export function unflattenSvelteData(values: unknown[]): unknown {
  const memo = new Map<number, unknown>();

  const decodeReference = (reference: unknown): unknown => {
    if (typeof reference !== "number" || !Number.isInteger(reference)) {
      throw new Error("invalid Svelte data reference");
    }
    if (reference < 0) {
      if (!SPECIAL.has(reference)) throw new Error("unknown Svelte data sentinel");
      return SPECIAL.get(reference);
    }
    if (reference >= values.length) throw new Error("Svelte data reference is out of bounds");
    if (memo.has(reference)) return memo.get(reference);

    const raw = values[reference];
    if (Array.isArray(raw)) {
      const decoded: unknown[] = [];
      memo.set(reference, decoded);
      for (const item of raw) decoded.push(decodeReference(item));
      return decoded;
    }
    if (isRecord(raw)) {
      const decoded: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      memo.set(reference, decoded);
      for (const [key, item] of Object.entries(raw)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        decoded[key] = decodeReference(item);
      }
      return decoded;
    }
    memo.set(reference, raw);
    return raw;
  };

  return decodeReference(0);
}

export function parseSvelteDataResponse(body: string, upstream = "Svelte provider"): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new UpstreamPayloadError(upstream, "invalid JSON response");
  }
  if (!isRecord(payload) || !Array.isArray(payload.nodes)) {
    throw new UpstreamPayloadError(upstream, "missing Svelte data nodes");
  }

  for (let index = payload.nodes.length - 1; index >= 0; index -= 1) {
    const node = payload.nodes[index];
    if (!isRecord(node) || !Array.isArray(node.data)) continue;
    try {
      const decoded = unflattenSvelteData(node.data);
      if (isRecord(decoded)) return decoded;
    } catch {
      throw new UpstreamPayloadError(upstream, "unsupported Svelte data payload");
    }
  }
  throw new UpstreamPayloadError(upstream, "no route data in response");
}
