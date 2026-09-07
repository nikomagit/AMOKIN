export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  hentailaBaseUrl: string;
  hentailaCdnBaseUrl: string;
  animeAv1BaseUrl: string;
  animeAv1CdnBaseUrl: string;
  jkAnimeBaseUrl: string;
  animeMappingBaseUrl: string;
  anilistBaseUrl: string;
  metadataBaseUrl: string;
  metadataFallbackBaseUrl: string;
  tmdbBaseUrl: string;
  tmdbApiKey?: string;
  tmdbLanguage: string;
  requestTimeoutMs: number;
  metadataTimeoutMs: number;
  maxResponseBytes: number;
  maxSearchQueries: number;
  maxCandidates: number;
  maxStreams: number;
  minMatchScore: number;
  searchCacheTtlMs: number;
  catalogCacheTtlMs: number;
  mediaCacheTtlMs: number;
  metadataCacheTtlMs: number;
  cacheMaxEntries: number;
  userAgent: string;
  playbackUserAgent: string;
  externalStreamAddons: ExternalStreamAddonConfig[];
}

export interface ExternalStreamAddonConfig {
  name: string;
  manifestUrl: string;
  idFormat: "imdb" | "imdb-or-kitsu" | "imdb-or-tmdb-underscore";
  position: "before-local" | "after-local" | "last";
}

function optionalSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (/[\r\n]/.test(value)) throw new Error(`${name} contains invalid characters`);
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function decimal(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function baseUrl(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name]?.trim() || fallback;
  const value = new URL(raw);
  if (!(value.protocol === "http:" || value.protocol === "https:")) {
    throw new Error(`${name} must use http or https`);
  }
  if (value.username || value.password) {
    throw new Error(`${name} must not contain embedded credentials`);
  }
  value.pathname = value.pathname.replace(/\/+$/, "");
  value.search = "";
  value.hash = "";
  return value.toString().replace(/\/$/, "");
}

function optionalManifestUrl(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = optionalSecret(env, name);
  if (!raw) return undefined;
  const value = new URL(raw);
  if (!(value.protocol === "http:" || value.protocol === "https:")) {
    throw new Error(`${name} must use http or https`);
  }
  if (value.username || value.password || !value.pathname.endsWith("/manifest.json")) {
    throw new Error(`${name} must be an addon manifest URL without embedded basic-auth credentials`);
  }
  value.hash = "";
  return value.toString();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = integer(env, "PORT", 7100, 1, 65_535);
  const tmdbApiKey = optionalSecret(env, "TMDB_API_KEY");
  const tmdbLanguage = env.TMDB_LANGUAGE?.trim() || "es-ES";
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(tmdbLanguage)) {
    throw new Error("TMDB_LANGUAGE must look like es or es-ES");
  }
  const externalStreamAddons: ExternalStreamAddonConfig[] = [];
  const latinobridPmManifestUrl = optionalManifestUrl(env, "LATINOBRID_PM_MANIFEST_URL");
  const latinobridTbManifestUrl = optionalManifestUrl(env, "LATINOBRID_TB_MANIFEST_URL");
  const nubePlusManifestUrl = optionalManifestUrl(env, "NUBE_PLUS_MANIFEST_URL");
  const nubeDebridManifestUrl = optionalManifestUrl(env, "NUBE_DEBRID_MANIFEST_URL");
  const noTorrentManifestUrl = optionalManifestUrl(env, "NOTORRENT_MANIFEST_URL");
  if (latinobridPmManifestUrl) {
    externalStreamAddons.push({
      name: "Latinobrid PM",
      manifestUrl: latinobridPmManifestUrl,
      idFormat: "imdb",
      position: "before-local",
    });
  }
  if (latinobridTbManifestUrl) {
    externalStreamAddons.push({
      name: "Latinobrid TB",
      manifestUrl: latinobridTbManifestUrl,
      idFormat: "imdb",
      position: "before-local",
    });
  }
  if (nubePlusManifestUrl) {
    externalStreamAddons.push({
      name: "Nube+",
      manifestUrl: nubePlusManifestUrl,
      idFormat: "imdb",
      position: "before-local",
    });
  }
  if (nubeDebridManifestUrl) {
    externalStreamAddons.push({
      name: "Nube Debrid",
      manifestUrl: nubeDebridManifestUrl,
      idFormat: "imdb-or-kitsu",
      position: "after-local",
    });
  }
  if (noTorrentManifestUrl) {
    externalStreamAddons.push({
      name: "NoTorrent",
      manifestUrl: noTorrentManifestUrl,
      idFormat: "imdb-or-tmdb-underscore",
      position: "last",
    });
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    logLevel: env.LOG_LEVEL?.trim() || "info",
    hentailaBaseUrl: baseUrl(env, "HENTAILA_BASE_URL", "https://hentaila.com"),
    hentailaCdnBaseUrl: baseUrl(env, "HENTAILA_CDN_BASE_URL", "https://cdn.hentaila.com"),
    animeAv1BaseUrl: baseUrl(env, "ANIMEAV1_BASE_URL", "https://animeav1.com"),
    animeAv1CdnBaseUrl: baseUrl(env, "ANIMEAV1_CDN_BASE_URL", "https://cdn.animeav1.com"),
    jkAnimeBaseUrl: baseUrl(env, "JKANIME_BASE_URL", "https://jkanime.net"),
    animeMappingBaseUrl: baseUrl(env, "ANIME_MAPPING_BASE_URL", "https://animeapi.my.id"),
    anilistBaseUrl: baseUrl(env, "ANILIST_BASE_URL", "https://graphql.anilist.co"),
    metadataBaseUrl: baseUrl(env, "METADATA_BASE_URL", "https://v3-cinemeta.strem.io"),
    metadataFallbackBaseUrl: baseUrl(
      env,
      "METADATA_FALLBACK_BASE_URL",
      "https://94c8cb9f702d-tmdb-addon.baby-beamup.club",
    ),
    tmdbBaseUrl: baseUrl(env, "TMDB_BASE_URL", "https://api.themoviedb.org/3"),
    ...(tmdbApiKey ? { tmdbApiKey } : {}),
    tmdbLanguage,
    requestTimeoutMs: integer(env, "REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
    metadataTimeoutMs: integer(env, "METADATA_TIMEOUT_MS", 6_000, 1_000, 60_000),
    maxResponseBytes: integer(
      env,
      "MAX_RESPONSE_BYTES",
      5 * 1024 * 1024,
      64 * 1024,
      20 * 1024 * 1024,
    ),
    maxSearchQueries: integer(env, "MAX_SEARCH_QUERIES", 4, 1, 8),
    maxCandidates: integer(env, "MAX_CANDIDATES", 5, 1, 12),
    maxStreams: integer(env, "MAX_STREAMS", 8, 1, 16),
    minMatchScore: decimal(env, "MIN_MATCH_SCORE", 0.72, 0.5, 1),
    searchCacheTtlMs: integer(
      env,
      "SEARCH_CACHE_TTL_MS",
      60_000,
      0,
      24 * 60 * 60_000,
    ),
    catalogCacheTtlMs: integer(
      env,
      "CATALOG_CACHE_TTL_MS",
      15 * 60_000,
      0,
      24 * 60 * 60_000,
    ),
    mediaCacheTtlMs: integer(
      env,
      "MEDIA_CACHE_TTL_MS",
      6 * 60 * 60_000,
      0,
      7 * 24 * 60 * 60_000,
    ),
    metadataCacheTtlMs: integer(
      env,
      "METADATA_CACHE_TTL_MS",
      24 * 60 * 60_000,
      0,
      7 * 24 * 60 * 60_000,
    ),
    cacheMaxEntries: integer(env, "CACHE_MAX_ENTRIES", 500, 1, 10_000),
    userAgent:
      env.USER_AGENT?.trim() || "AMOKIN/2.1 (+self-hosted)",
    playbackUserAgent:
      env.PLAYBACK_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    externalStreamAddons,
  };
}
