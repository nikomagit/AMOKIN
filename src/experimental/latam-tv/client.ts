import { fetchText, type FetchText } from "../../lib/http.js";
import { AsyncTtlCache } from "../../lib/cache.js";

export interface LatamTvClientOptions {
  catalogUrl?: string;
  trustedPlayerHostSuffixes?: string[];
  timeoutMs: number;
  maxResponseBytes: number;
  userAgent: string;
  maxStreams?: number;
  catalogCacheTtlMs?: number;
}

export interface LatamTvChannel {
  id: string;
  type: "tv";
  name: string;
  genre: LatamTvGenre;
  sourceUrl: string;
}

export interface LatamTvStream {
  name: string;
  title: string;
  type: "hls";
  url: string;
  headers: Record<string, string>;
}

interface EmbedOption {
  name: string;
  url: string;
}

const DEFAULT_CATALOG_URL = "https://embed.saohgdassregions.com/";
const CHANNEL_ID_PREFIX = "latam-tv:";
export const LATAM_TV_CATALOG_ID = "latam-tv";
export const LATAM_TV_GENRES = ["Deportes", "Regionales"] as const;
export type LatamTvGenre = (typeof LATAM_TV_GENRES)[number];

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x2f|47);/gi, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function cleanUrl(value: string): string {
  return decodeHtml(value).replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
}

function sameHost(url: URL, host: string): boolean {
  return url.hostname.toLocaleLowerCase("en") === host.toLocaleLowerCase("en");
}

function matchesTrustedSuffix(url: URL, suffixes: readonly string[]): boolean {
  const host = url.hostname.toLocaleLowerCase("en");
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function validHttpUrl(value: string, base: URL): URL | null {
  try {
    const url = new URL(cleanUrl(value), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function channelId(slug: string): string {
  return `${CHANNEL_ID_PREFIX}${slug}`;
}

export function latamTvChannelSlug(id: string): string | null {
  const raw = id.startsWith(CHANNEL_ID_PREFIX) ? id.slice(CHANNEL_ID_PREFIX.length) : "";
  return /^[a-z0-9][a-z0-9_-]*$/i.test(raw) ? raw.toLocaleLowerCase("en") : null;
}

function channelGenre(body: string, index: number): LatamTvGenre {
  const markers = [...body.matchAll(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bcategory\b[^"']*["'][^>]*\bid\s*=\s*["'](deportes|regionales)["']/gi)]
    .filter((match) => (match.index ?? -1) <= index);
  const category = markers.at(-1)?.[1]?.toLocaleLowerCase("en");
  return category === "deportes" ? "Deportes" : "Regionales";
}

/**
 * Isolated resolver for the LATAM TV source. It deliberately resolves the
 * short-lived HLS playlist only when a channel is selected.
 */
export class LatamTvClient {
  private readonly catalogUrl: URL;
  private readonly trustedPlayerHostSuffixes: string[];
  private readonly maxStreams: number;
  private readonly catalogCache: AsyncTtlCache<"channels", LatamTvChannel[]>;

  constructor(
    private readonly options: LatamTvClientOptions,
    private readonly request: FetchText = fetchText,
  ) {
    this.catalogUrl = new URL(options.catalogUrl ?? DEFAULT_CATALOG_URL);
    if (this.catalogUrl.protocol !== "https:" && this.catalogUrl.protocol !== "http:") {
      throw new Error("LATAM TV catalog URL must use HTTP or HTTPS");
    }
    this.trustedPlayerHostSuffixes = [
      this.catalogUrl.hostname.toLocaleLowerCase("en"),
      ...(options.trustedPlayerHostSuffixes ?? ["saohgdassregions.com", "ksdjugfssddeports.com"])
        .map((host) => host.trim().toLocaleLowerCase("en"))
        .filter((host) => /^[a-z0-9.-]+$/.test(host)),
    ];
    this.maxStreams = options.maxStreams ?? 4;
    this.catalogCache = new AsyncTtlCache(options.catalogCacheTtlMs ?? 10 * 60_000, 1);
  }

  async getChannels(): Promise<LatamTvChannel[]> {
    return this.catalogCache.getOrCreate("channels", () => this.fetchChannels());
  }

  private async fetchChannels(): Promise<LatamTvChannel[]> {
    const body = await this.get(this.catalogUrl, "LATAM TV catalog", this.catalogUrl.toString());
    const channels = new Map<string, LatamTvChannel>();
    const pattern = /class\s*=\s*["'][^"']*\bchannel-name\b[^"']*["'][^>]*>\s*([^<]+?)\s*<\/div>[\s\S]{0,2500}?<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
    for (const match of body.matchAll(pattern)) {
      const name = decodeHtml(match[1] ?? "").replace(/\s+/g, " ");
      const source = validHttpUrl(match[2] ?? "", this.catalogUrl);
      if (!name || !source || !sameHost(source, this.catalogUrl.hostname)) continue;
      const slug = source.pathname.match(/^\/([a-z0-9_-]+)\.php$/i)?.[1]?.toLocaleLowerCase("en");
      if (!slug) continue;
      channels.set(channelId(slug), {
        id: channelId(slug),
        type: "tv",
        name,
        genre: channelGenre(body, match.index ?? 0),
        sourceUrl: source.toString(),
      });
    }
    return [...channels.values()];
  }

  async resolveChannel(id: string): Promise<LatamTvStream[]> {
    const channel = await this.getChannel(id);
    return channel ? this.resolve(channel) : [];
  }

  async getChannel(id: string): Promise<LatamTvChannel | null> {
    const slug = latamTvChannelSlug(id);
    if (!slug) return null;
    return (await this.getChannels()).find((candidate) => candidate.id === channelId(slug)) ?? null;
  }

  async resolve(channel: LatamTvChannel): Promise<LatamTvStream[]> {
    if (!sameHost(new URL(channel.sourceUrl), this.catalogUrl.hostname)) return [];
    const channelPage = new URL(channel.sourceUrl);
    const channelBody = await this.get(channelPage, `LATAM TV channel ${channel.name}`, this.catalogUrl.toString());
    const embeds = this.extractEmbedOptions(channelBody, channelPage);
    const settled = await Promise.allSettled(embeds.map((embed) => this.resolveEmbed(embed, channel)));
    const streams = new Map<string, LatamTvStream>();
    for (const result of settled) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const key = result.value.url.toLocaleLowerCase("en");
      if (!streams.has(key)) streams.set(key, result.value);
    }
    return [...streams.values()].slice(0, this.maxStreams);
  }

  private extractEmbedOptions(body: string, channelPage: URL): EmbedOption[] {
    const found = new Map<string, EmbedOption>();
    const labelled = /<h2[^>]*>\s*([^<]+?)\s*<\/h2>[\s\S]{0,5000}?<input\b[^>]*\bvalue\s*=\s*(["'])([\s\S]*?)\2/gi;
    for (const match of body.matchAll(labelled)) {
      const iframe = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(decodeHtml(match[3] ?? ""));
      const url = iframe && validHttpUrl(iframe[1] ?? "", channelPage);
      if (!url || !sameHost(url, this.catalogUrl.hostname)) continue;
      found.set(url.toString(), { name: decodeHtml(match[1] ?? "Player"), url: url.toString() });
    }
    if (found.size > 0) return [...found.values()];

    const fallback = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    for (const match of body.matchAll(fallback)) {
      const url = validHttpUrl(match[1] ?? "", channelPage);
      if (!url || !sameHost(url, this.catalogUrl.hostname) || !/^\/embed2?\//i.test(url.pathname)) continue;
      const name = /^\/embed2\//i.test(url.pathname) ? "JW Player" : "Clappr";
      found.set(url.toString(), { name, url: url.toString() });
    }
    return [...found.values()];
  }

  private async resolveEmbed(embed: EmbedOption, channel: LatamTvChannel): Promise<LatamTvStream | null> {
    const embedUrl = new URL(embed.url);
    const wrapper = await this.get(embedUrl, `LATAM TV ${embed.name}`, channel.sourceUrl);
    const iframePattern = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    const playerCandidates = [...wrapper.matchAll(iframePattern)]
      .map((match) => validHttpUrl(match[1] ?? "", embedUrl))
      .filter((url): url is URL => url !== null);
    const playerUrl = playerCandidates.find((url) => !/\/chat\.php$/i.test(url.pathname));
    if (!playerUrl || !matchesTrustedSuffix(playerUrl, this.trustedPlayerHostSuffixes)) return null;

    const playerBody = await this.get(playerUrl, `LATAM TV ${embed.name} player`, embedUrl.toString());
    const playlist = this.extractPlaylist(playerBody, playerUrl);
    if (!playlist) return null;
    return {
      name: `LATAM TV • ${embed.name}`,
      title: `${channel.name}\n${embed.name}`,
      type: "hls",
      url: playlist.toString(),
      headers: this.playbackHeaders(playerUrl),
    };
  }

  private extractPlaylist(body: string, playerUrl: URL): URL | null {
    const pattern = /(?:const\s+(?:playbackURL|playbackUrl)\s*=\s*|(?:source|file)\s*:\s*)["']((?:https?:)?(?:\\?\/|\/)[^"']+)["']/gi;
    for (const match of body.matchAll(pattern)) {
      const url = validHttpUrl(match[1] ?? "", playerUrl);
      if (!url || !matchesTrustedSuffix(url, this.trustedPlayerHostSuffixes)) continue;
      if (/\.m3u8$/i.test(url.pathname) || /\/playlist\.php$/i.test(url.pathname)) return url;
    }
    return null;
  }

  private playbackHeaders(playerUrl: URL): Record<string, string> {
    return {
      Accept: "*/*",
      Origin: playerUrl.origin,
      Referer: playerUrl.toString(),
      "User-Agent": this.options.userAgent,
    };
  }

  private get(url: URL, upstream: string, referer: string): Promise<string> {
    return this.request(url, {
      timeoutMs: this.options.timeoutMs,
      maxBytes: this.options.maxResponseBytes,
      upstream,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: referer,
        "User-Agent": this.options.userAgent,
      },
    });
  }
}
