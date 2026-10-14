import { InvalidMediaRequestError } from "../errors.js";
import type { ProviderId } from "../providers/types.js";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POSITIVE_INTEGER = /^\d+$/;

export interface ParsedProviderMediaId {
  provider: ProviderId;
  slug: string;
  episode?: number;
}

export function providerMediaId(provider: ProviderId, slug: string, episode?: number): string {
  if (!SAFE_SLUG.test(slug)) throw new InvalidMediaRequestError("Invalid provider slug");
  if (episode !== undefined && (!Number.isSafeInteger(episode) || episode < 1)) {
    throw new InvalidMediaRequestError("Invalid provider episode");
  }
  return `amokin:${provider}:${slug}${episode === undefined ? "" : `:${episode}`}`;
}

export function parseProviderMediaId(rawId: string): ParsedProviderMediaId | null {
  if (!rawId.startsWith("amokin:")) return null;
  if (rawId.length > 256) throw new InvalidMediaRequestError("Provider ID is too long");
  const parts = rawId.split(":");
  if (parts.length < 3 || parts.length > 4) throw new InvalidMediaRequestError("Malformed AMOKIN ID");
  const provider = parts[1];
  const slug = parts[2];
  const providers: ProviderId[] = [
    "animeav1", "jkanime",
  ];
  if (!providers.includes(provider as ProviderId) || !slug || !SAFE_SLUG.test(slug)) {
    throw new InvalidMediaRequestError("Malformed AMOKIN provider ID");
  }
  if (parts.length === 3) return { provider: provider as ProviderId, slug };
  const rawEpisode = parts[3];
  if (!rawEpisode || !POSITIVE_INTEGER.test(rawEpisode)) {
    throw new InvalidMediaRequestError("Malformed AMOKIN episode ID");
  }
  const episode = Number(rawEpisode);
  if (!Number.isSafeInteger(episode) || episode < 1 || episode > 100_000) {
    throw new InvalidMediaRequestError("Invalid AMOKIN episode number");
  }
  return { provider: provider as ProviderId, slug, episode };
}
