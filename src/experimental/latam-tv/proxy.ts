import { randomUUID } from "node:crypto";

type ProxyKind = "playlist" | "resource";

interface ProxyEntry {
  kind: ProxyKind;
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export type LatamTvProxyFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface LatamTvProxyOptions {
  trustedHostSuffixes: string[];
  timeoutMs: number;
  maxPlaylistBytes?: number;
  ttlMs?: number;
  maxEntries?: number;
}

export interface LatamTvProxyPlaylist {
  body: string;
  contentType: string;
}

function extension(url: URL): string {
  const value = /\.(?:aac|bin|key|m4s|mp4|ts|vtt)$/i.exec(url.pathname)?.[0];
  return value?.toLocaleLowerCase("en") ?? ".bin";
}

/**
 * Short-lived, allowlisted HLS relay. The upstream signs playlists for the IP
 * that resolves them, so production playback must fetch playlists and segments
 * through the same AMOKIN instance.
 */
export class LatamTvProxy {
  private readonly entries = new Map<string, ProxyEntry>();
  private readonly trustedHostSuffixes: string[];
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxPlaylistBytes: number;

  constructor(
    private readonly options: LatamTvProxyOptions,
    private readonly request: LatamTvProxyFetch = (url, init) => fetch(url, init),
  ) {
    this.trustedHostSuffixes = options.trustedHostSuffixes
      .map((host) => host.trim().toLocaleLowerCase("en"))
      .filter((host) => /^[a-z0-9.-]+$/.test(host));
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 5_000;
    this.maxPlaylistBytes = options.maxPlaylistBytes ?? 512 * 1024;
  }

  registerPlaylist(url: string, headers: Record<string, string>, origin: string): string {
    const token = this.put("playlist", url, headers, ".m3u8");
    return `${origin}/latam-tv/proxy/playlist/${token}`;
  }

  async getPlaylist(token: string, origin: string): Promise<LatamTvProxyPlaylist | null> {
    const entry = this.get(token, "playlist");
    if (!entry) return null;
    const response = await this.fetchTrusted(entry.url, entry.headers);
    if (!response.ok) throw new Error(`LATAM TV playlist upstream returned ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxPlaylistBytes) {
      throw new Error("LATAM TV playlist is too large");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > this.maxPlaylistBytes || !body.startsWith("#EXTM3U")) {
      throw new Error("LATAM TV playlist payload is invalid");
    }
    return {
      body: this.rewritePlaylist(body, new URL(entry.url), entry.headers, origin),
      contentType: response.headers.get("content-type") ?? "application/vnd.apple.mpegurl",
    };
  }

  async getResource(token: string, range: string | undefined): Promise<Response | null> {
    const entry = this.get(token, "resource");
    if (!entry) return null;
    const headers = { ...entry.headers };
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    return this.fetchTrusted(entry.url, headers);
  }

  private rewritePlaylist(
    body: string,
    playlistUrl: URL,
    headers: Record<string, string>,
    origin: string,
  ): string {
    let nextUriIsPlaylist = false;
    return body.split(/\r?\n/).map((line) => {
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        nextUriIsPlaylist = true;
        return line;
      }
      if (line.startsWith("#")) {
        const uriIsPlaylist = line.startsWith("#EXT-X-MEDIA") || line.startsWith("#EXT-X-I-FRAME-STREAM-INF");
        return line.replace(/URI="([^"]+)"/g, (_match, raw: string) => {
          const url = new URL(raw, playlistUrl);
          const kind: ProxyKind = uriIsPlaylist ? "playlist" : "resource";
          const suffix = kind === "playlist" ? ".m3u8" : extension(url);
          const token = this.put(kind, url.toString(), headers, suffix);
          return `URI="${origin}/latam-tv/proxy/${kind}/${token}"`;
        });
      }
      if (!line.trim()) return line;
      const url = new URL(line.trim(), playlistUrl);
      const kind: ProxyKind = nextUriIsPlaylist ? "playlist" : "resource";
      nextUriIsPlaylist = false;
      const suffix = kind === "playlist" ? ".m3u8" : extension(url);
      const token = this.put(kind, url.toString(), headers, suffix);
      return `${origin}/latam-tv/proxy/${kind}/${token}`;
    }).join("\n");
  }

  private put(
    kind: ProxyKind,
    rawUrl: string,
    headers: Record<string, string>,
    suffix: string,
  ): string {
    const url = new URL(rawUrl);
    if (!this.isTrusted(url)) throw new Error(`Untrusted LATAM TV proxy host: ${url.hostname}`);
    this.cleanup();
    const token = `${randomUUID()}${suffix}`;
    this.entries.set(token, {
      kind,
      url: url.toString(),
      headers: { ...headers },
      expiresAt: Date.now() + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    return token;
  }

  private get(token: string, kind: ProxyKind): ProxyEntry | null {
    if (!/^[a-f0-9-]+\.(?:aac|bin|key|m3u8|m4s|mp4|ts|vtt)$/i.test(token)) return null;
    const entry = this.entries.get(token);
    if (!entry || entry.kind !== kind || entry.expiresAt <= Date.now()) {
      this.entries.delete(token);
      return null;
    }
    entry.expiresAt = Date.now() + this.ttlMs;
    this.entries.delete(token);
    this.entries.set(token, entry);
    return entry;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }

  private isTrusted(url: URL): boolean {
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLocaleLowerCase("en");
    return this.trustedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }

  private async fetchTrusted(rawUrl: string, headers: Record<string, string>): Promise<Response> {
    let url = new URL(rawUrl);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!this.isTrusted(url)) throw new Error(`Untrusted LATAM TV proxy host: ${url.hostname}`);
      const response = await this.request(url.toString(), {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      await response.body?.cancel();
      url = new URL(location, url);
    }
    throw new Error("LATAM TV proxy exceeded redirect limit");
  }
}
