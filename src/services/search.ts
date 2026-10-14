import type { AppConfig } from "../config.js";
import { parseMediaId, parseMediaType } from "../metadata/media-id.js";
import type { MetadataProvider } from "../metadata/client.js";
import { parseProviderMediaId } from "../metadata/provider-id.js";
import type { DirectStreamResolver } from "../providers/resolvers.js";
import type { DirectMediaProvider, ProviderMedia, ProviderSearchResult } from "../providers/types.js";
import type { AddonStream, MediaMetadata, StreamSearchService } from "../types.js";
import {
  buildSearchQueries,
  detailedScore,
  externalIdMatch,
  isSeasonCompatible,
  normalizeTitle,
  preliminaryScore,
} from "./matching.js";

interface Candidate {
  result: ProviderSearchResult;
  preliminary: number;
}

export interface ProviderRuntime {
  provider: DirectMediaProvider;
  resolvers: DirectStreamResolver;
}

function safeFilename(value: string): string {
  return value.normalize("NFKD").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "AMOKIN";
}

function chooseEpisode(metadata: Pick<MediaMetadata, "episode" | "season">, media: ProviderMedia): number | null {
  const requested = metadata.episode;
  if (requested !== undefined) {
    const exactSeason = metadata.season === undefined
      ? undefined
      : media.episodes.find((item) => item.season === metadata.season && item.relativeNumber === requested);
    if (exactSeason) return exactSeason.number;
    return media.episodes.some((item) => item.number === requested) ? requested : null;
  }
  if (media.episodes.length === 0) return null;
  return [...media.episodes].sort((left, right) => left.number - right.number)[0]?.number ?? null;
}

export class ProviderSearchService implements StreamSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly metadataProvider: MetadataProvider,
    private readonly providers: ProviderRuntime[],
  ) {}

  async getStreams(rawType: string, rawId: string): Promise<AddonStream[]> {
    const type = parseMediaType(rawType);
    const native = parseProviderMediaId(rawId);
    if (native) {
      const runtime = this.providers.find((item) => item.provider.id === native.provider);
      if (!runtime) return [];
      try {
        const media = await runtime.provider.getMedia(native.slug);
        if (!media) return [];
        const episodeNumber = chooseEpisode(
          native.episode === undefined ? {} : { episode: native.episode },
          media,
        );
        return episodeNumber === null ? [] : await this.resolveMedia(runtime, media, episodeNumber);
      } catch {
        return [];
      }
    }

    const parsed = parseMediaId(type, rawId);
    const metadata = await this.metadataProvider.resolve(type, parsed);
    const settled = await Promise.allSettled(
      this.providers.map(async (runtime) => {
        const match = await this.findBestMatch(runtime.provider, metadata);
        if (!match) return [];
        const episodeNumber = chooseEpisode(metadata, match);
        return episodeNumber === null ? [] : this.resolveMedia(runtime, match, episodeNumber, metadata);
      }),
    );
    const deduplicated = new Map<string, AddonStream>();
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const stream of result.value) {
        const key = stream.url.toLocaleLowerCase("en");
        if (!deduplicated.has(key)) deduplicated.set(key, stream);
      }
    }
    return [...deduplicated.values()].slice(0, this.config.maxStreams);
  }

  private async resolveMedia(runtime: ProviderRuntime, media: ProviderMedia, episodeNumber: number, metadata?: MediaMetadata): Promise<AddonStream[]> {
    const episode = metadata
      ? await runtime.provider.getEpisode(media.slug, episodeNumber, metadata)
      : await runtime.provider.getEpisode(media.slug, episodeNumber);
    if (!episode || episode.media.slug !== media.slug) return [];
    const episodePath = runtime.provider.id === "jkanime"
      ? `${encodeURIComponent(media.slug)}/${episodeNumber}/`
      : `media/${encodeURIComponent(media.slug)}/${episodeNumber}`;
    const episodePageUrl = episode.pageUrl ?? new URL(episodePath, `${runtime.provider.baseUrl}/`).toString();
    const resolved = await runtime.resolvers.resolveAll(episode.embeds, episodePageUrl);
    const title = safeFilename(media.title);
    const summary = media.episodes.find((item) => item.number === episodeNumber);
    const season = summary?.season ?? metadata?.season;
    const relativeEpisode = summary?.relativeNumber ?? metadata?.episode ?? episodeNumber;
    const isMovie = (media.mediaType ?? metadata?.type) === "movie";
    const episodeLabel = isMovie ? "" : season
      ? `T${season} E${relativeEpisode}`
      : `Episodio ${relativeEpisode}`;
    return resolved.map((stream) => {
      const details = [runtime.provider.name, stream.server, stream.language, stream.quality, stream.label]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
        .join(" • ");
      const extension = stream.type === "hls" ? "m3u8" : "mp4";
      const result: AddonStream = {
        name: `AMOKIN\n${runtime.provider.name} • ${stream.server}`,
        title: `${title}${episodeLabel ? ` • ${episodeLabel}` : ""}\n${details}`,
        description: `${title}${episodeLabel ? ` • ${episodeLabel}` : ""} • ${details}`,
        type: stream.type,
        url: stream.url,
        behaviorHints: {
          bingeGroup: `amokin|${runtime.provider.id}|${normalizeTitle(stream.server)}|${stream.language.toLocaleLowerCase("en")}`,
          filename: `${title}${isMovie ? "" : season ? ` - S${String(season).padStart(2, "0")}E${String(relativeEpisode).padStart(2, "0")}` : ` - E${String(relativeEpisode).padStart(2, "0")}`} - ${runtime.provider.name} - ${stream.server}.${extension}`,
          notWebReady: true,
          proxyHeaders: { request: stream.headers },
        },
      };
      if (stream.subtitles?.length) {
        result.subtitles = stream.subtitles.map((subtitle) => ({ id: subtitle.id, url: subtitle.url, lang: subtitle.language }));
      }
      return result;
    });
  }

  private async findBestMatch(provider: DirectMediaProvider, metadata: MediaMetadata): Promise<ProviderMedia | null> {
    const queries = buildSearchQueries(metadata, this.config.maxSearchQueries);
    const searchRequests = queries.map((query) => provider.search(query, metadata));
    if (provider.searchByExternalIds && metadata.externalIds) {
      searchRequests.unshift(provider.searchByExternalIds(metadata));
    }
    const searches = await Promise.allSettled(searchRequests);
    const candidates = new Map<string, Candidate>();
    for (const search of searches) {
      if (search.status !== "fulfilled") continue;
      for (const result of search.value) {
        if (result.mediaType && result.mediaType !== metadata.type) continue;
        const identity = externalIdMatch(metadata.externalIds, result.externalIds);
        if (identity === "conflict") continue;
        if (identity !== "exact" && metadata.year !== undefined && result.year !== undefined && Math.abs(metadata.year - result.year) > 1) continue;
        const score = preliminaryScore(metadata, result);
        const existing = candidates.get(result.slug);
        if (!existing) {
          candidates.set(result.slug, { result, preliminary: score });
          continue;
        }
        const aliases = [...new Set([...(existing.result.aliases ?? []), ...(result.aliases ?? [])])];
        const externalIds = { ...existing.result.externalIds, ...result.externalIds };
        const merged: ProviderSearchResult = {
          ...(score > existing.preliminary ? existing.result : result),
          ...(score > existing.preliminary ? result : existing.result),
          ...(aliases.length ? { aliases } : {}),
          ...(Object.keys(externalIds).length ? { externalIds } : {}),
        };
        candidates.set(result.slug, { result: merged, preliminary: Math.max(existing.preliminary, score) });
      }
    }
    const entryScopedProviders = new Set(["kitsu", "anilist", "mal", "anidb"]);
    const seasonalRequest = !entryScopedProviders.has(metadata.provider) && (metadata.season ?? 1) > 1;
    const candidateLimit = seasonalRequest
      ? Math.min(12, Math.max(this.config.maxCandidates, this.config.maxCandidates * 2))
      : this.config.maxCandidates;
    const shortlist = [...candidates.values()]
      .sort((left, right) => right.preliminary - left.preliminary)
      .slice(0, candidateLimit);
    const details = await Promise.allSettled(shortlist.map(async (candidate) => ({
      candidate: candidate.result,
      media: await provider.getMedia(candidate.result.slug, metadata),
    })));
    let best: { media: ProviderMedia; score: number; exact: boolean } | undefined;
    for (const detail of details) {
      if (detail.status !== "fulfilled" || !detail.value.media) continue;
      const { candidate, media } = detail.value;
      if (media.mediaType && media.mediaType !== metadata.type) continue;
      const resultIdentity = externalIdMatch(metadata.externalIds, candidate.externalIds);
      const mediaIdentity = externalIdMatch(metadata.externalIds, media.externalIds);
      if (resultIdentity === "conflict" || mediaIdentity === "conflict") continue;
      const aliases = candidate.aliases ?? [];
      const enriched: ProviderMedia = {
        ...media,
        aka: {
          ...media.aka,
          ...Object.fromEntries(aliases.map((alias, index) => [`search-${index + 1}`, alias])),
        },
        externalIds: { ...candidate.externalIds, ...media.externalIds },
      };
      if (!isSeasonCompatible(metadata, enriched)) continue;
      const exact = resultIdentity === "exact" || mediaIdentity === "exact";
      const score = exact ? 1 : detailedScore(metadata, enriched);
      if (!best || exact && !best.exact || exact === best.exact && score > best.score) {
        best = { media: enriched, score, exact };
      }
    }
    return best && (best.exact || best.score >= this.config.minMatchScore) ? best.media : null;
  }
}
