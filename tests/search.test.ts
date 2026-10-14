import { describe, expect, it, vi } from "vitest";
import type { MetadataProvider } from "../src/metadata/client.js";
import type { DirectStreamResolver } from "../src/providers/resolvers.js";
import type { DirectMediaProvider } from "../src/providers/types.js";
import { ProviderSearchService } from "../src/services/search.js";
import { testConfig } from "./helpers.js";

function createService(
  metadata: MetadataProvider,
  provider: DirectMediaProvider,
  resolvers: DirectStreamResolver,
): ProviderSearchService {
  return new ProviderSearchService(testConfig(), metadata, [{ provider, resolvers }]);
}

describe("end-to-end search orchestration", () => {
  it("matches conservatively, selects the requested episode and formats direct streams", async () => {
    const metadata: MetadataProvider = {
      resolve: vi.fn().mockResolvedValue({
        provider: "kitsu",
        baseId: "123",
        type: "series",
        title: "One Piece",
        aliases: ["Wan Pisu"],
        year: 1999,
        season: 1,
        episode: 2,
      }),
    };
    const media = {
      title: "One Piece",
      slug: "one-piece",
      aka: { ja: "Wan Pisu" },
      startDate: "1999-10-20",
      genres: [],
      episodes: [{ number: 1 }, { number: 2 }, { number: 3 }],
    };
    const provider: DirectMediaProvider = {
      id: "animeav1",
      name: "AnimeAV1",
      baseUrl: "https://animeav1.com",
      cdnBaseUrl: "https://animeav1.com",
      search: vi.fn().mockResolvedValue([{ id: "894", title: media.title, slug: media.slug }]),
      getCatalog: vi.fn(),
      getMedia: vi.fn().mockResolvedValue(media),
      getEpisode: vi.fn().mockResolvedValue({
        media,
        episodeNumber: 2,
        embeds: [{ server: "HLS", language: "SUB", url: "https://player.zilla-networks.com/play/id" }],
      }),
    };
    const resolvers: DirectStreamResolver = {
      resolveAll: vi.fn().mockResolvedValue([{
        server: "HLS",
        language: "SUB",
        url: "https://player.zilla-networks.com/m3u8/id",
        type: "hls",
        label: "HLS",
        headers: { Referer: "https://player.zilla-networks.com/play/id" },
      }]),
    };
    const service = createService(metadata, provider, resolvers);
    const streams = await service.getStreams("series", "kitsu:123:2");

    expect(provider.getEpisode).toHaveBeenCalledWith(media.slug, 2, expect.objectContaining({
      type: "series", season: 1, episode: 2,
    }));
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({
      name: "AMOKIN\nAnimeAV1 • HLS",
      type: "hls",
      url: "https://player.zilla-networks.com/m3u8/id",
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: { request: { Referer: "https://player.zilla-networks.com/play/id" } },
      },
    });
    expect(streams[0]).not.toHaveProperty("infoHash");
    expect(streams[0]).not.toHaveProperty("sources");
  });

  it("returns no streams when the best match is below the threshold", async () => {
    const metadata: MetadataProvider = {
      resolve: vi.fn().mockResolvedValue({
        provider: "imdb", baseId: "tt1234567", type: "movie", title: "Completely Different",
        aliases: ["Completely Different"], year: 2020,
      }),
    };
    const provider: DirectMediaProvider = {
      id: "animeav1",
      name: "AnimeAV1",
      baseUrl: "https://animeav1.com",
      cdnBaseUrl: "https://animeav1.com",
      search: vi.fn().mockResolvedValue([{ id: "1", title: "Example Movie", slug: "example-movie" }]),
      getCatalog: vi.fn(),
      getMedia: vi.fn().mockResolvedValue({ title: "Example Movie", slug: "example-movie", aka: {}, genres: [], episodes: [{ number: 1 }] }),
      getEpisode: vi.fn(),
    };
    const service = createService(metadata, provider, { resolveAll: vi.fn() });

    await expect(service.getStreams("movie", "tt1234567")).resolves.toEqual([]);
    expect(provider.getEpisode).not.toHaveBeenCalled();
  });

  it("rejects an exact-looking title when the provider publishes a different TMDB ID", async () => {
    const metadata: MetadataProvider = {
      resolve: vi.fn().mockResolvedValue({
        provider: "imdb", baseId: "tt0133093", type: "movie", title: "The Matrix",
        aliases: ["Matrix"], externalIds: { imdb: "tt0133093", tmdb: 603 }, year: 1999,
      }),
    };
    const provider: DirectMediaProvider = {
      id: "animeav1", name: "AnimeAV1", baseUrl: "https://animeav1.com", cdnBaseUrl: "https://animeav1.com",
      search: vi.fn().mockResolvedValue([{
        id: "wrong", title: "The Matrix", slug: "the-matrix", externalIds: { tmdb: 624860 },
      }]),
      getCatalog: vi.fn(),
      getMedia: vi.fn(),
      getEpisode: vi.fn(),
    };
    const service = createService(metadata, provider, { resolveAll: vi.fn() });

    await expect(service.getStreams("movie", "tt0133093")).resolves.toEqual([]);
    expect(provider.getMedia).not.toHaveBeenCalled();
    expect(provider.getEpisode).not.toHaveBeenCalled();
  });
});
