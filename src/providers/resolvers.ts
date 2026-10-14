import type { AppConfig } from "../config.js";
import { fetchText, type FetchText } from "../lib/http.js";
import type { ProviderEmbed } from "./types.js";

export interface ResolvedDirectStream {
  server: string;
  language: string;
  url: string;
  type: "hls" | "mp4";
  label: "HLS" | "MP4";
  headers: Record<string, string>;
  quality?: string;
  subtitles?: Array<{ id: string; url: string; language: string }>;
}

export interface DirectStreamResolver {
  resolveAll(embeds: ProviderEmbed[], episodePageUrl: string): Promise<ResolvedDirectStream[]>;
}

function cleanMediaUrl(value: string): string {
  return value.replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").trim();
}

function allowedHost(url: URL, domain: string): boolean {
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

function validatedUrl(value: string, domains: string[], extension: RegExp): string | null {
  try {
    const parsed = new URL(cleanMediaUrl(value));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!domains.some((domain) => allowedHost(parsed, domain))) return null;
    if (!extension.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function directHeaders(embedUrl: URL, userAgent: string): Record<string, string> {
  return { Accept: "*/*", Origin: embedUrl.origin, Referer: embedUrl.toString(), "User-Agent": userAgent };
}

function firstMatch(body: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match?.[1]) return cleanMediaUrl(match[1]);
  }
  return null;
}

export class DirectStreamResolverRegistry implements DirectStreamResolver {
  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {}

  async resolveAll(embeds: ProviderEmbed[], episodePageUrl: string): Promise<ResolvedDirectStream[]> {
    return (await this.resolveEmbeds(embeds, episodePageUrl)).slice(0, this.config.maxStreams);
  }

  private async resolveEmbeds(embeds: ProviderEmbed[], episodePageUrl: string): Promise<ResolvedDirectStream[]> {
    const settled = await Promise.allSettled(
      embeds.filter((embed) => this.isSupported(embed)).map(async (embed) => {
        const stream = await this.resolve(embed, episodePageUrl);
        return stream ? [stream] : [];
      }),
    );
    const deduplicated = new Map<string, ResolvedDirectStream>();
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const stream of result.value) {
        const key = stream.url.toLocaleLowerCase("en");
        if (!deduplicated.has(key)) deduplicated.set(key, stream);
      }
    }
    return [...deduplicated.values()];
  }

  private isSupported(embed: ProviderEmbed): boolean {
    const server = embed.server.toLocaleLowerCase("en");
    return ["hls", "mp4upload"].includes(server) || server.startsWith("jkanime ");
  }

  private async resolve(embed: ProviderEmbed, episodePageUrl: string): Promise<ResolvedDirectStream | null> {
    const server = embed.server.toLocaleLowerCase("en");
    if (server === "hls") return this.resolveHls(embed);
    if (server === "mp4upload") return this.resolveMp4Upload(embed, episodePageUrl);
    if (server.startsWith("jkanime ")) return this.resolveJkAnime(embed, episodePageUrl);
    return null;
  }

  private resolveHls(embed: ProviderEmbed): ResolvedDirectStream | null {
    const source = new URL(embed.url);
    if (source.hostname !== "player.zilla-networks.com") return null;
    const id = source.pathname.match(/^\/play\/([a-f\d]{32})\/?$/i)?.[1];
    if (!id) return null;
    return {
      server: embed.server,
      language: embed.language,
      url: new URL(`/m3u8/${id}`, source.origin).toString(),
      type: "hls",
      label: "HLS",
      headers: {
        ...directHeaders(source, this.config.playbackUserAgent),
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
    };
  }

  private async resolveMp4Upload(embed: ProviderEmbed, episodePageUrl: string): Promise<ResolvedDirectStream | null> {
    const source = new URL(embed.url);
    if (!allowedHost(source, "mp4upload.com") || !/\/embed[-/]/i.test(source.pathname)) return null;
    const body = await this.request(source, this.pageOptions("MP4Upload", episodePageUrl));
    const match = firstMatch(body, [
      /player\.src\s*\(\s*\{[\s\S]{0,1000}?src\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
      /<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    ]);
    const url = match && validatedUrl(match, ["mp4upload.com"], /\.mp4$/i);
    if (!url) return null;
    return { server: embed.server, language: embed.language, url, type: "mp4", label: "MP4", headers: directHeaders(source, this.config.playbackUserAgent) };
  }

  private async resolveJkAnime(embed: ProviderEmbed, episodePageUrl: string): Promise<ResolvedDirectStream | null> {
    const source = new URL(embed.url);
    const expectedHost = new URL(this.config.jkAnimeBaseUrl).hostname;
    if (source.hostname !== expectedHost || !/^\/jkplayer\/umv?\/?$/i.test(source.pathname)) return null;
    const body = await this.request(source, this.pageOptions("JKAnime player", episodePageUrl));
    const match = firstMatch(body, [
      /\burl\s*:\s*["'](https?:\\?\/\\?\/[^"']+?\.m3u8(?:\?[^"']*)?)["']/i,
      /(?:file|src)\s*:\s*["'](https?:\\?\/\\?\/[^"']+?\.m3u8(?:\?[^"']*)?)["']/i,
    ]);
    const url = match && validatedUrl(match, ["playmudos.com"], /\.m3u8$/i);
    if (!url) return null;
    return {
      server: embed.server,
      language: embed.language,
      url,
      type: "hls",
      label: "HLS",
      headers: directHeaders(source, this.config.playbackUserAgent),
    };
  }

  private pageOptions(upstream: string, referer: string) {
    return {
      timeoutMs: this.config.requestTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
        referer,
        "user-agent": this.config.playbackUserAgent,
      },
    };
  }
}
