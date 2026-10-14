import type { AppConfig } from "../../config.js";
import { UpstreamHttpError, UpstreamPayloadError } from "../../errors.js";
import { AsyncTtlCache } from "../../lib/cache.js";
import { fetchText, type FetchText } from "../../lib/http.js";
import type {
  DirectMediaProvider,
  ProviderCatalogKind,
  ProviderCatalogPage,
  ProviderEmbed,
  ProviderEpisodePage,
  ProviderGenre,
  ProviderMedia,
  ProviderSearchResult,
} from "../types.js";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&#x([a-f\d]+);/gi, (_match, number: string) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function first(body: string, pattern: RegExp): string | undefined {
  const value = pattern.exec(body)?.[1];
  return value ? decodeHtml(value) : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function publicUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(decodeHtml(value), `${base}/`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function categorySlug(value: string): string {
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
  if (/pelicula|movie/.test(normalized)) return "pelicula";
  if (/ova/.test(normalized)) return "ova";
  if (/especial|special/.test(normalized)) return "especial";
  return "tv-anime";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class JkAnimeClient implements DirectMediaProvider {
  readonly id = "jkanime" as const;
  readonly name = "JKAnime";
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly searchCache: AsyncTtlCache<string, ProviderSearchResult[]>;
  private readonly mediaCache: AsyncTtlCache<string, ProviderMedia | null>;
  private readonly episodeCache: AsyncTtlCache<string, ProviderEpisodePage | null>;

  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {
    this.baseUrl = config.jkAnimeBaseUrl;
    this.cdnBaseUrl = config.jkAnimeBaseUrl;
    this.searchCache = new AsyncTtlCache(config.searchCacheTtlMs, config.cacheMaxEntries);
    this.mediaCache = new AsyncTtlCache(config.mediaCacheTtlMs, config.cacheMaxEntries);
    this.episodeCache = new AsyncTtlCache(config.searchCacheTtlMs, config.cacheMaxEntries);
  }

  search(query: string): Promise<ProviderSearchResult[]> {
    const cleaned = query.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!cleaned) return Promise.resolve([]);
    return this.searchCache.getOrCreate(cleaned.toLocaleLowerCase("es"), async () => {
      const url = new URL("buscar", `${this.baseUrl}/`);
      url.searchParams.set("q", cleaned);
      return this.parseSearch(await this.request(url, this.requestOptions(this.baseUrl)));
    });
  }

  getCatalog(_kind: ProviderCatalogKind, _page: number): Promise<ProviderCatalogPage> {
    return Promise.resolve({
      results: [], currentPage: 1, recordsPerPage: 0, totalPages: 0,
      totalRecords: 0, orderKey: "default", status: null,
    });
  }

  getMedia(slug: string): Promise<ProviderMedia | null> {
    if (!SAFE_SLUG.test(slug)) return Promise.resolve(null);
    return this.mediaCache.getOrCreate(slug, async () => {
      try {
        const url = new URL(`${encodeURIComponent(slug)}/`, `${this.baseUrl}/`);
        return this.parseMedia(slug, await this.request(url, this.requestOptions(this.baseUrl)));
      } catch (error) {
        if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
        throw error;
      }
    });
  }

  getEpisode(slug: string, episode: number): Promise<ProviderEpisodePage | null> {
    if (!SAFE_SLUG.test(slug) || !Number.isSafeInteger(episode) || episode < 1) return Promise.resolve(null);
    return this.episodeCache.getOrCreate(`${slug}:${episode}`, async () => {
      const media = await this.getMedia(slug);
      if (!media || !media.episodes.some((item) => item.number === episode)) return null;
      const pageUrl = new URL(`${encodeURIComponent(slug)}/${episode}/`, `${this.baseUrl}/`);
      try {
        const body = await this.request(pageUrl, this.requestOptions(new URL(`${slug}/`, `${this.baseUrl}/`).toString()));
        const embeds = this.parseEmbeds(body);
        return { media, episodeNumber: episode, embeds };
      } catch (error) {
        if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
        throw error;
      }
    });
  }

  private parseSearch(body: string): ProviderSearchResult[] {
    const results = new Map<string, ProviderSearchResult>();
    const links = body.matchAll(/<h5[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h5>/gi);
    for (const match of links) {
      const url = publicUrl(match[1], this.baseUrl);
      const title = decodeHtml(match[2] ?? "");
      if (!url || !title) continue;
      const parsed = new URL(url);
      if (parsed.hostname !== new URL(this.baseUrl).hostname) continue;
      const parts = parsed.pathname.split("/").filter(Boolean);
      const slug = parts.length === 1 ? parts[0] : undefined;
      if (!slug || !SAFE_SLUG.test(slug) || results.has(slug)) continue;
      results.set(slug, { id: slug, title, slug });
    }
    return [...results.values()];
  }

  private parseMedia(slug: string, body: string): ProviderMedia {
    const info = /<div[^>]+class=["'][^"']*anime_info[^"']*["'][^>]*>([\s\S]*?)<div[^>]+class=["'][^"']*anisabi_player/gi.exec(body)?.[1] ?? body;
    const title = first(info, /<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!title) throw new UpstreamPayloadError("JKAnime", "missing anime title");
    const alias = first(info, /<h3[^>]*>[\s\S]*?<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/i);
    const synopsis = first(info, /<p[^>]+class=["'][^"']*scroll[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const poster = publicUrl(
      /<div[^>]+class=["'][^"']*movpic[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)/i.exec(body)?.[1],
      this.baseUrl,
    );
    const rawType = first(body, /<li[^>]+rel=["']tipo["'][^>]*>\s*<span[^>]*>\s*Tipo:\s*<\/span>\s*([^<]+)/i) ?? "Serie";
    const declaredEpisodes = positiveInteger(first(body, /<span[^>]*>\s*Episodios:\s*<\/span>\s*(\d+)/i));
    const latestEpisode = positiveInteger(
      body.match(/<a\b[^>]*href=["'][^"']*\/(\d+)\/?["'][^>]*id=["']uep["']/i)?.[1]
      ?? body.match(/<a\b[^>]*id=["']uep["'][^>]*href=["'][^"']*\/(\d+)\/?["']/i)?.[1],
    );
    const episodesCount = declaredEpisodes ?? latestEpisode;
    if (episodesCount === undefined) throw new UpstreamPayloadError("JKAnime", "missing episode count");
    const year = first(body, /<span[^>]*>\s*Temporada:\s*<\/span>[\s\S]{0,300}?(\d{4})/i)
      ?? first(body, /<span[^>]*>\s*Emitido:\s*<\/span>[\s\S]{0,200}?(\d{4})/i);
    const runtime = positiveInteger(first(body, /<span[^>]*>\s*Duracion:\s*<\/span>\s*(\d+)/i));
    const rawStatus = first(body, /<span[^>]*>\s*Estado:\s*<\/span>[\s\S]{0,200}?>([^<]+)<\/div>/i);
    const status = rawStatus && /emisi[oó]n|airing/i.test(rawStatus) ? 2 : rawStatus ? 0 : undefined;
    const genres: ProviderGenre[] = [];
    const seenGenres = new Set<string>();
    for (const match of body.matchAll(/href=["'][^"']*\/genero\/([a-z0-9%-]+)\/?["'][^>]*>([^<]+)<\/a>/gi)) {
      const name = decodeHtml(match[2] ?? "");
      if (!name || seenGenres.has(name.toLocaleLowerCase("es"))) continue;
      seenGenres.add(name.toLocaleLowerCase("es"));
      genres.push({ name, slug: safeDecodeURIComponent(match[1] ?? "") });
    }
    const aka = alias && alias !== title ? { "en-us": alias } : {};
    return {
      title,
      slug,
      aka,
      genres,
      episodes: Array.from({ length: episodesCount }, (_, index) => ({ number: index + 1 })),
      episodesCount,
      category: { name: rawType, slug: categorySlug(rawType) },
      ...(synopsis ? { synopsis } : {}),
      ...(poster ? { poster } : {}),
      ...(year ? { startDate: `${year}-01-01` } : {}),
      ...(runtime === undefined ? {} : { runtime }),
      ...(status === undefined ? {} : { status }),
    };
  }

  private parseEmbeds(body: string): ProviderEmbed[] {
    const embeds: ProviderEmbed[] = [];
    const seen = new Set<string>();
    for (const match of body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
      const value = publicUrl(match[1], this.baseUrl);
      if (!value || seen.has(value)) continue;
      const url = new URL(value);
      if (url.hostname !== new URL(this.baseUrl).hostname) continue;
      const player = url.pathname.match(/^\/jkplayer\/(umv?|UMV?)\/?$/)?.[1]?.toLocaleUpperCase("en");
      if (!player) continue;
      seen.add(value);
      embeds.push({ server: `JKAnime ${player}`, language: "SUB-ES", url: value });
    }
    return embeds;
  }

  private requestOptions(referer: string) {
    return {
      timeoutMs: this.config.requestTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream: "JKAnime",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
        referer,
        "user-agent": this.config.userAgent,
      },
    };
  }
}
