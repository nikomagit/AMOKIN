import type { AppConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 7100,
    logLevel: "silent",
    hentailaBaseUrl: "https://hentaila.com",
    hentailaCdnBaseUrl: "https://cdn.hentaila.com",
    animeAv1BaseUrl: "https://animeav1.com",
    animeAv1CdnBaseUrl: "https://cdn.animeav1.com",
    jkAnimeBaseUrl: "https://jkanime.net",
    animeMappingBaseUrl: "https://animeapi.my.id",
    anilistBaseUrl: "https://graphql.anilist.co",
    metadataBaseUrl: "https://v3-cinemeta.strem.io",
    metadataFallbackBaseUrl: "https://metadata.example",
    tmdbBaseUrl: "https://api.themoviedb.org/3",
    tmdbLanguage: "es-ES",
    requestTimeoutMs: 2_000,
    metadataTimeoutMs: 2_000,
    maxResponseBytes: 1024 * 1024,
    maxSearchQueries: 4,
    maxCandidates: 5,
    maxStreams: 3,
    minMatchScore: 0.72,
    searchCacheTtlMs: 60_000,
    catalogCacheTtlMs: 60_000,
    mediaCacheTtlMs: 60_000,
    metadataCacheTtlMs: 60_000,
    cacheMaxEntries: 50,
    userAgent: "Test/1.0",
    playbackUserAgent: "Mozilla/5.0 TestBrowser/1.0",
    latamTvCatalogUrl: "https://embed.example",
    latamTvPlayerHostSuffixes: ["embed.example", "player.example"],
    externalStreamAddons: [],
    ...overrides,
  };
}

/** Encodes plain test data in the reference-table format used by SvelteKit. */
export function sveltePayload(data: unknown): string {
  const values: unknown[] = [];
  const encode = (value: unknown): number => {
    if (value === undefined) return -1;
    const index = values.length;
    values.push(null);
    if (Array.isArray(value)) {
      values[index] = value.map(encode);
    } else if (value !== null && typeof value === "object") {
      values[index] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encode(item)]),
      );
    } else {
      values[index] = value;
    }
    return index;
  };
  encode(data);
  return JSON.stringify({ type: "data", nodes: [null, null, { type: "data", data: values }] });
}
