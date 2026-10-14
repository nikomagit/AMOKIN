import { UpstreamHttpError, UpstreamPayloadError } from "../../errors.js";
import { AsyncTtlCache } from "../../lib/cache.js";
import { fetchText, type FetchText } from "../../lib/http.js";
import { parseSvelteDataResponse } from "../../lib/svelte-data.js";
import type {
  DirectMediaProvider,
  ProviderCatalogKind,
  ProviderCatalogPage,
  ProviderCategory,
  ProviderEmbed,
  ProviderEpisodePage,
  ProviderEpisodeSummary,
  ProviderGenre,
  ProviderId,
  ProviderMedia,
  ProviderSearchResult,
} from "../types.js";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SvelteProviderOptions {
  id: ProviderId;
  name: string;
  baseUrl: string;
  cdnBaseUrl: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  searchCacheTtlMs: number;
  mediaCacheTtlMs: number;
  catalogCacheTtlMs: number;
  cacheMaxEntries: number;
  userAgent: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function decimal(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function safeSlug(value: unknown): string | undefined {
  const slug = text(value);
  return slug && SAFE_SLUG.test(slug) ? slug : undefined;
}

function httpUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseCategory(value: unknown): ProviderCategory | undefined {
  const source = record(value);
  if (!source) return undefined;
  const id = integer(source.id);
  const name = text(source.name);
  const slug = safeSlug(source.slug);
  if (id === undefined && !name && !slug) return undefined;
  return {
    ...(id === undefined ? {} : { id }),
    ...(name ? { name } : {}),
    ...(slug ? { slug } : {}),
  };
}

function parseGenre(value: unknown): ProviderGenre | undefined {
  const source = record(value);
  const name = text(source?.name);
  if (!source || !name) return undefined;
  const id = integer(source.id);
  const slug = safeSlug(source.slug);
  return { name, ...(id === undefined ? {} : { id }), ...(slug ? { slug } : {}) };
}

function parseSearchResult(value: unknown): ProviderSearchResult | undefined {
  const source = record(value);
  const title = text(source?.title);
  const slug = safeSlug(source?.slug);
  if (!source || !title || !slug) return undefined;
  const id = text(source.id) ?? String(integer(source.id) ?? "");
  if (!id) return undefined;
  const synopsis = text(source.synopsis);
  const category = parseCategory(source.category);
  return { id, title, slug, ...(synopsis ? { synopsis } : {}), ...(category ? { category } : {}) };
}

function parseEpisodeSummary(value: unknown): ProviderEpisodeSummary | undefined {
  const source = record(value);
  const number = integer(source?.number);
  if (!source || number === undefined || number < 1) return undefined;
  const id = integer(source.id);
  const season = integer(source.season);
  const relativeNumber = integer(source.relativeNumber);
  const title = text(source.title);
  const publishedAt = text(source.publishedAt);
  return {
    number,
    ...(id === undefined ? {} : { id }),
    ...(season === undefined ? {} : { season }),
    ...(relativeNumber === undefined ? {} : { relativeNumber }),
    ...(title ? { title } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

function parseMedia(value: unknown): ProviderMedia | undefined {
  const source = record(value);
  const title = text(source?.title);
  const slug = safeSlug(source?.slug);
  if (!source || !title || !slug) return undefined;
  const akaSource = record(source.aka);
  const aka: Record<string, string> = {};
  for (const [locale, rawTitle] of Object.entries(akaSource ?? {})) {
    const alias = text(rawTitle);
    if (alias && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(locale)) aka[locale] = alias;
  }
  const genres = (Array.isArray(source.genres) ? source.genres : [])
    .map(parseGenre).filter((genre): genre is ProviderGenre => Boolean(genre));
  const episodes = (Array.isArray(source.episodes) ? source.episodes : [])
    .map(parseEpisodeSummary).filter((episode): episode is ProviderEpisodeSummary => Boolean(episode));
  const id = integer(source.id);
  const startDate = text(source.startDate);
  const endDate = text(source.endDate);
  const synopsis = text(source.synopsis);
  const poster = httpUrl(source.poster);
  const backdrop = httpUrl(source.backdrop);
  const status = integer(source.status);
  const runtime = integer(source.runtime);
  const score = decimal(source.score);
  const votes = integer(source.votes);
  const episodesCount = integer(source.episodesCount);
  const category = parseCategory(source.category);
  return {
    title, slug, aka, genres, episodes,
    ...(id === undefined ? {} : { id }),
    ...(synopsis ? { synopsis } : {}),
    ...(poster ? { poster } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(status === undefined ? {} : { status }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(score === undefined ? {} : { score }),
    ...(votes === undefined ? {} : { votes }),
    ...(episodesCount === undefined ? {} : { episodesCount }),
    ...(source.seasons === undefined || source.seasons === null ? {} : { seasons: source.seasons }),
    ...(category ? { category } : {}),
  };
}

function parseEmbeds(value: unknown): ProviderEmbed[] {
  const groups = record(value);
  if (!groups) return [];
  const embeds: ProviderEmbed[] = [];
  for (const [language, rawEmbeds] of Object.entries(groups)) {
    if (!Array.isArray(rawEmbeds)) continue;
    for (const rawEmbed of rawEmbeds) {
      const embed = record(rawEmbed);
      const server = text(embed?.server);
      const url = httpUrl(embed?.url);
      if (server && url) embeds.push({ server, url, language: language.toUpperCase() });
    }
  }
  return embeds;
}

function catalogQuery(kind: ProviderCatalogKind): URLSearchParams {
  const query = new URLSearchParams();
  if (kind === "popular") query.set("order", "popular");
  if (kind === "airing") query.set("status", "emision");
  return query;
}

export class SvelteMediaClient implements DirectMediaProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly searchCache: AsyncTtlCache<string, ProviderSearchResult[]>;
  private readonly catalogCache: AsyncTtlCache<string, ProviderCatalogPage>;
  private readonly mediaCache: AsyncTtlCache<string, ProviderMedia | null>;
  private readonly episodeCache: AsyncTtlCache<string, ProviderEpisodePage | null>;

  constructor(private readonly optionsConfig: SvelteProviderOptions, private readonly request: FetchText = fetchText) {
    this.id = optionsConfig.id;
    this.name = optionsConfig.name;
    this.baseUrl = optionsConfig.baseUrl;
    this.cdnBaseUrl = optionsConfig.cdnBaseUrl;
    this.searchCache = new AsyncTtlCache(optionsConfig.searchCacheTtlMs, optionsConfig.cacheMaxEntries);
    this.catalogCache = new AsyncTtlCache(optionsConfig.catalogCacheTtlMs, optionsConfig.cacheMaxEntries);
    this.mediaCache = new AsyncTtlCache(optionsConfig.mediaCacheTtlMs, optionsConfig.cacheMaxEntries);
    this.episodeCache = new AsyncTtlCache(optionsConfig.searchCacheTtlMs, optionsConfig.cacheMaxEntries);
  }

  search(query: string): Promise<ProviderSearchResult[]> {
    const cleaned = query.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!cleaned) return Promise.resolve([]);
    return this.searchCache.getOrCreate(cleaned.toLocaleLowerCase("en"), async () => {
      const url = this.dataUrl("catalogo");
      url.searchParams.set("search", cleaned);
      return this.parseCatalogData(await this.request(url, this.requestOptions())).results;
    });
  }

  getCatalog(kind: ProviderCatalogKind, page: number): Promise<ProviderCatalogPage> {
    if (!Number.isSafeInteger(page) || page < 1) return Promise.resolve(this.emptyCatalog());
    return this.catalogCache.getOrCreate(`${kind}:${page}`, async () => {
      const url = this.dataUrl("catalogo");
      for (const [name, value] of catalogQuery(kind)) url.searchParams.append(name, value);
      if (page > 1) url.searchParams.set("page", String(page));
      return this.parseCatalogData(await this.request(url, this.requestOptions()));
    });
  }

  getMedia(slug: string): Promise<ProviderMedia | null> {
    if (!SAFE_SLUG.test(slug)) return Promise.resolve(null);
    return this.mediaCache.getOrCreate(slug, async () => {
      try {
        const data = parseSvelteDataResponse(await this.request(this.dataUrl(`media/${encodeURIComponent(slug)}`), this.requestOptions()), this.name);
        const media = parseMedia(data.media);
        if (!media) throw new UpstreamPayloadError(this.name, "invalid media record");
        return media;
      } catch (error) {
        if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
        throw error;
      }
    });
  }

  getEpisode(slug: string, episode: number): Promise<ProviderEpisodePage | null> {
    if (!SAFE_SLUG.test(slug) || !Number.isSafeInteger(episode) || episode < 1) return Promise.resolve(null);
    return this.episodeCache.getOrCreate(`${slug}:${episode}`, async () => {
      try {
        const data = parseSvelteDataResponse(await this.request(this.dataUrl(`media/${encodeURIComponent(slug)}/${episode}`), this.requestOptions()), this.name);
        const media = parseMedia(data.media);
        const episodeNumber = integer(record(data.episode)?.number);
        if (!media || episodeNumber === undefined || episodeNumber < 1) {
          throw new UpstreamPayloadError(this.name, "invalid episode record");
        }
        return { media, episodeNumber, embeds: parseEmbeds(data.embeds) };
      } catch (error) {
        if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
        throw error;
      }
    });
  }

  private dataUrl(path: string): URL { return new URL(`${path}/__data.json`, `${this.baseUrl}/`); }

  private parseCatalogData(body: string): ProviderCatalogPage {
    const data = parseSvelteDataResponse(body, this.name);
    const pagination = record(data.pagination);
    const filters = record(data.filters);
    const results = (Array.isArray(data.results) ? data.results : [])
      .map(parseSearchResult).filter((result): result is ProviderSearchResult => Boolean(result));
    return {
      results,
      currentPage: integer(pagination?.currentPage) ?? 1,
      recordsPerPage: integer(pagination?.recordsPerPage) ?? results.length,
      totalPages: integer(pagination?.totalPages) ?? (results.length ? 1 : 0),
      totalRecords: integer(pagination?.totalRecords) ?? integer(data.total) ?? results.length,
      orderKey: text(data.orderKey) ?? "default",
      status: integer(filters?.status) ?? null,
    };
  }

  private emptyCatalog(): ProviderCatalogPage {
    return { results: [], currentPage: 1, recordsPerPage: 20, totalPages: 0, totalRecords: 0, orderKey: "default", status: null };
  }

  private requestOptions() {
    return {
      timeoutMs: this.optionsConfig.requestTimeoutMs,
      maxBytes: this.optionsConfig.maxResponseBytes,
      upstream: this.name,
      headers: { accept: "application/json", "accept-language": "es-ES,es;q=0.9,en;q=0.8", "user-agent": this.optionsConfig.userAgent },
    };
  }
}
