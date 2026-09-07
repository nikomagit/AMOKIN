import type { AppConfig, ExternalStreamAddonConfig } from "../config.js";
import { UpstreamPayloadError } from "../errors.js";
import { fetchText, type FetchText } from "../lib/http.js";
import type { AddonStream, StreamSearchService } from "../types.js";

type ExternalStream = AddonStream & Record<string, unknown>;

function remoteMediaId(source: ExternalStreamAddonConfig, rawId: string): string | null {
  if (/^tt\d+(?::\d+:\d+)?$/.test(rawId)) return rawId;
  if (source.idFormat === "imdb-or-tmdb-underscore") {
    const tmdb = /^tmdb:(\d+(?::\d+:\d+)?)$/.exec(rawId);
    if (tmdb?.[1]) return `tmdb_${tmdb[1]}`;
  }
  return null;
}

function streamEndpoint(manifestUrl: string, type: string, id: string): URL {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(
    /\/manifest\.json$/,
    `/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`,
  );
  return url;
}

function directStreams(payload: string, upstream: string): ExternalStream[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new UpstreamPayloadError(upstream, "returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { streams?: unknown }).streams)) {
    throw new UpstreamPayloadError(upstream, "returned an invalid streams envelope");
  }
  return (parsed as { streams: unknown[] }).streams.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const stream = candidate as Record<string, unknown>;
    if (typeof stream.url !== "string") return [];
    let url: URL;
    try {
      url = new URL(stream.url);
    } catch {
      return [];
    }
    if (!(url.protocol === "http:" || url.protocol === "https:")) return [];
    const { infoHash: _infoHash, sources: _sources, externalUrl: _externalUrl, ...direct } = stream;
    return [direct as ExternalStream];
  });
}

export class ExternalStreamAggregator implements StreamSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly local: StreamSearchService,
    private readonly request: FetchText = fetchText,
  ) {}

  async getStreams(type: string, id: string): Promise<AddonStream[]> {
    const primaryRemoteRequests: Promise<ExternalStream[]>[] = [];
    const noTorrentRequests: Promise<ExternalStream[]>[] = [];
    for (const source of this.config.externalStreamAddons) {
      const externalId = remoteMediaId(source, id);
      if (!externalId || !(type === "movie" || type === "series")) continue;
      const request = this.request(streamEndpoint(source.manifestUrl, type, externalId), {
        timeoutMs: this.config.requestTimeoutMs,
        maxBytes: this.config.maxResponseBytes,
        upstream: source.name,
        headers: { "User-Agent": this.config.userAgent, Accept: "application/json" },
      }).then((payload) => directStreams(payload, source.name));
      (source.name === "NoTorrent" ? noTorrentRequests : primaryRemoteRequests).push(request);
    }
    if (primaryRemoteRequests.length === 0 && noTorrentRequests.length === 0) {
      return this.local.getStreams(type, id);
    }

    const settled = await Promise.allSettled([
      ...primaryRemoteRequests,
      this.local.getStreams(type, id),
      ...noTorrentRequests,
    ]);
    const unique = new Map<string, AddonStream>();
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const stream of result.value) {
        if (typeof stream.url !== "string" || unique.has(stream.url)) continue;
        unique.set(stream.url, stream);
      }
    }
    return [...unique.values()];
  }
}
