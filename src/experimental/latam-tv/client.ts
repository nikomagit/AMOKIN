import { fetchText, type FetchText } from "../../lib/http.js";

export const SPORTS_TV_BASE_URL = "https://futbollibrefullhd.org/";
export const SPORTS_TV_HOST_SUFFIXES = ["tvf90.com", "ftlly.com"];
// Keep protocol IDs stable for clients that already installed AMOKIN.
export const LATAM_TV_CATALOG_ID = "latam-tv";
export const LATAM_TV_GENRES = ["Deportes"] as const;
export type LatamTvGenre = (typeof LATAM_TV_GENRES)[number];

export interface LatamTvClientOptions {
  catalogUrl?: string;
  trustedPlayerHostSuffixes?: string[];
  timeoutMs: number;
  maxResponseBytes: number;
  userAgent: string;
  maxStreams?: number;
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
const CHANNELS = [
  { slug: "directvsports", name: "DSport", path: "directv-sports-online" },
  { slug: "directvsportsplus", name: "DSport+", path: "directv-sports-plus-online" },
  { slug: "espn", name: "ESPN", path: "espn-1" },
  { slug: "espn2", name: "ESPN2", path: "espn-2" },
  { slug: "espn3", name: "ESPN3", path: "espn-3" },
] as const;

export function latamTvChannelSlug(id: string): string | null {
  const slug = id.startsWith("latam-tv:") ? id.slice("latam-tv:".length) : "";
  return CHANNELS.some((channel) => channel.slug === slug) ? slug : null;
}
function clean(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#(?:x2f|47);/gi, "/").replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
}

/** Five curated sports channels, resolved from their public pages on demand. */
export class LatamTvClient {
  private readonly base: URL;
  private readonly hosts: string[];
  constructor(
    private readonly options: LatamTvClientOptions,
    private readonly request: FetchText = fetchText,
  ) {
    this.base = new URL(options.catalogUrl ?? SPORTS_TV_BASE_URL);
    if (!/^https?:$/.test(this.base.protocol) || this.base.username || this.base.password) {
      throw new Error("Sports TV base URL must use HTTP or HTTPS without credentials");
    }
    this.hosts = [this.base.hostname, ...(options.trustedPlayerHostSuffixes ?? SPORTS_TV_HOST_SUFFIXES)]
      .map((host) => host.trim().toLowerCase()).filter((host) => /^[a-z0-9.-]+$/.test(host));
  }
  async getChannels(): Promise<LatamTvChannel[]> {
    return CHANNELS.map((channel) => ({
      id: `latam-tv:${channel.slug}`,
      type: "tv",
      name: channel.name,
      genre: "Deportes",
      sourceUrl: new URL(`/en-vivo/${channel.path}`, this.base).toString(),
    }));
  }
  async getChannel(id: string): Promise<LatamTvChannel | null> {
    return (await this.getChannels()).find((channel) => channel.id === id) ?? null;
  }
  async resolveChannel(id: string): Promise<LatamTvStream[]> {
    const channel = await this.getChannel(id);
    return channel ? this.resolve(channel) : [];
  }
  async resolve(channel: LatamTvChannel): Promise<LatamTvStream[]> {
    const expected = await this.getChannel(channel.id);
    if (!expected || expected.sourceUrl !== channel.sourceUrl) return [];
    const visited = new Set<string>();
    const streams = new Map<string, LatamTvStream>();
    const walk = async (url: URL, referer: string, depth: number): Promise<void> => {
      if (depth > 3 || !this.trusted(url) || visited.has(url.href) || visited.size >= 8) return;
      visited.add(url.href);
      const body = await this.request(url, {
        timeoutMs: this.options.timeoutMs,
        maxBytes: this.options.maxResponseBytes,
        upstream: `Sports TV ${channel.name}`,
        headers: { Referer: referer, "User-Agent": this.options.userAgent },
      });
      const playlistPattern = /(?:(?:var|let|const)\s+playbackURL\s*=\s*|(?:source|file)\s*:\s*)["']([^"']+)["']/gi;
      for (const match of body.matchAll(playlistPattern)) {
        const playlist = this.url(match[1] ?? "", url);
        if (!playlist || !this.trusted(playlist) || !/\.m3u8$/i.test(playlist.pathname)) continue;
        streams.set(playlist.href, {
          name: "AMOKIN • Deportes",
          title: `${channel.name}\nEn vivo`,
          type: "hls",
          url: playlist.href,
          headers: { Accept: "*/*", Origin: url.origin, Referer: url.href, "User-Agent": this.options.userAgent },
        });
      }
      if (streams.size) return;
      const frames = [...body.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
        .map((match) => this.url(match[1] ?? "", url))
        .filter((frame): frame is URL => frame !== null && this.trusted(frame));
      for (const frame of frames) {
        try { await walk(frame, url.href, depth + 1); } catch { /* another announced player may work */ }
      }
    };
    await walk(new URL(channel.sourceUrl), this.base.href, 0);
    return [...streams.values()].slice(0, this.options.maxStreams ?? 4);
  }
  private url(raw: string, base: URL): URL | null {
    try { return new URL(clean(raw), base); } catch { return null; }
  }
  private trusted(url: URL): boolean {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    return this.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  }
}
