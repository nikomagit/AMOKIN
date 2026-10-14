import { describe, expect, it, vi } from "vitest";
import type { MetadataProvider } from "../src/metadata/client.js";
import type { DirectStreamResolver } from "../src/providers/resolvers.js";
import type { DirectMediaProvider, ProviderId } from "../src/providers/types.js";
import { ProviderSearchService } from "../src/services/search.js";
import { testConfig } from "./helpers.js";

const media = {
  id: 197,
  title: "One Piece",
  slug: "one-piece",
  aka: { "ja-jp": "ONE PIECE" },
  startDate: "1999-10-20",
  genres: [],
  episodes: [{ number: 1 }, { number: 1176 }],
};

function provider(id: ProviderId, failure = false): DirectMediaProvider {
  return {
    id,
    name: id === "animeav1" ? "AnimeAV1" : "JKAnime",
    baseUrl: `https://${id}.example`,
    cdnBaseUrl: `https://cdn.${id}.example`,
    search: failure
      ? vi.fn().mockRejectedValue(new Error("provider unavailable"))
      : vi.fn().mockResolvedValue([{ id: "197", title: "One Piece", slug: "one-piece" }]),
    getCatalog: vi.fn(),
    getMedia: vi.fn().mockResolvedValue(media),
    getEpisode: vi.fn().mockResolvedValue({
      media,
      episodeNumber: 1176,
      embeds: [{ server: "HLS", language: "SUB", url: "https://player.zilla-networks.com/play/id" }],
    }),
  };
}

const metadata: MetadataProvider = {
  resolve: vi.fn().mockResolvedValue({
    provider: "imdb",
    baseId: "tt0388629",
    type: "series",
    title: "One Piece",
    aliases: ["ONE PIECE"],
    year: 1999,
    season: 1,
    episode: 1176,
  }),
};

function resolver(url = "https://video.example/master.m3u8"): DirectStreamResolver {
  return {
    resolveAll: vi.fn().mockResolvedValue([{
      server: "HLS",
      language: "SUB",
      url,
      type: "hls",
      label: "HLS",
      headers: { Referer: "https://player.example/play/id" },
    }]),
  };
}

describe("multi-provider stream orchestration", () => {
  it("keeps AnimeAV1 working when JKAnime fails", async () => {
    const anime = provider("animeav1");
    const service = new ProviderSearchService(testConfig(), metadata, [
      { provider: anime, resolvers: resolver() },
      { provider: provider("jkanime", true), resolvers: resolver("https://jk.example/master.m3u8") },
    ]);
    const streams = await service.getStreams("series", "tt0388629:1:1176");
    expect(streams).toHaveLength(1);
    expect(streams[0]?.name).toContain("AnimeAV1");
  });

  it("keeps JKAnime working when AnimeAV1 fails", async () => {
    const service = new ProviderSearchService(testConfig(), metadata, [
      { provider: provider("animeav1", true), resolvers: resolver() },
      { provider: provider("jkanime"), resolvers: resolver("https://jk.example/master.m3u8") },
    ]);
    const streams = await service.getStreams("series", "tt0388629:1:1176");
    expect(streams).toHaveLength(1);
    expect(streams[0]?.name).toContain("JKAnime");
  });

  it("deduplicates identical final URLs across providers", async () => {
    const shared = "https://video.example/same.m3u8";
    const service = new ProviderSearchService(testConfig(), metadata, [
      { provider: provider("animeav1"), resolvers: resolver(shared) },
      { provider: provider("jkanime"), resolvers: resolver(shared) },
    ]);
    await expect(service.getStreams("series", "tt0388629:1:1176")).resolves.toHaveLength(1);
  });

  it("resolves AnimeAV1 catalog episode IDs directly without external metadata", async () => {
    const directMetadata: MetadataProvider = { resolve: vi.fn() };
    const anime = provider("animeav1");
    const service = new ProviderSearchService(testConfig(), directMetadata, [
      { provider: anime, resolvers: resolver() },
    ]);
    const streams = await service.getStreams("series", "amokin:animeav1:one-piece:1176");
    expect(streams).toHaveLength(1);
    expect(anime.getEpisode).toHaveBeenCalledWith("one-piece", 1176);
    expect(directMetadata.resolve).not.toHaveBeenCalled();
  });

  it("maps a Nuvio season to AnimeAV1's separate season entry", async () => {
    const seasonMetadata: MetadataProvider = {
      resolve: vi.fn().mockResolvedValue({
        provider: "imdb", baseId: "tt3398540", type: "series", title: "Haikyu!!",
        aliases: ["Haikyuu!!"], year: 2014, season: 3, episode: 1,
        seasonAliases: ["Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou"],
        seasonYear: 2016, seasonEpisodeCount: 10,
      }),
    };
    const base = {
      title: "Haikyuu!!", slug: "haikyuu", aka: {}, startDate: "2014-04-06",
      category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
    };
    const third = {
      title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      slug: "haikyuu-third-season", aka: { "en-us": "Haikyu!! 3rd Season" },
      startDate: "2016-10-08", category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 10 }, (_, index) => ({ number: index + 1 })),
    };
    const anime: DirectMediaProvider = {
      id: "animeav1", name: "AnimeAV1", baseUrl: "https://animeav1.com",
      cdnBaseUrl: "https://cdn.animeav1.com", getCatalog: vi.fn(),
      search: vi.fn().mockResolvedValue([
        { id: "1427", title: base.title, slug: base.slug },
        { id: "1432", title: third.title, slug: third.slug },
      ]),
      getMedia: vi.fn().mockImplementation((slug: string) =>
        Promise.resolve(slug === third.slug ? third : base)),
      getEpisode: vi.fn().mockResolvedValue({
        media: third, episodeNumber: 1,
        embeds: [{ server: "HLS", language: "SUB", url: "https://player.example/play/id" }],
      }),
    };
    const service = new ProviderSearchService(testConfig(), seasonMetadata, [
      { provider: anime, resolvers: resolver() },
    ]);
    const streams = await service.getStreams("series", "tt3398540:3:1");
    expect(anime.getEpisode).toHaveBeenCalledWith("haikyuu-third-season", 1, expect.objectContaining({
      type: "series", season: 3, episode: 1,
    }));
    expect(streams[0]?.title).toContain("Karasuno Koukou");
  });

  it("maps a Nuvio season to JKAnime's separate season entry", async () => {
    const seasonMetadata: MetadataProvider = {
      resolve: vi.fn().mockResolvedValue({
        provider: "imdb", baseId: "tt3398540", type: "series", title: "Haikyu!!",
        aliases: ["Haikyuu!!"], year: 2014, season: 3, episode: 1,
        seasonYear: 2016, seasonEpisodeCount: 10,
      }),
    };
    const base = {
      title: "Haikyuu!!", slug: "haikyuu", aka: {}, startDate: "2014-04-06",
      category: { name: "Serie", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
    };
    const third = {
      title: "Haikyuu!! Third Season", slug: "haikyuu-third-season",
      aka: { "en-us": "Haikyu!! 3rd Season" }, startDate: "2016-01-01",
      category: { name: "Serie", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 10 }, (_, index) => ({ number: index + 1 })),
    };
    const jkanime: DirectMediaProvider = {
      id: "jkanime", name: "JKAnime", baseUrl: "https://jkanime.net",
      cdnBaseUrl: "https://jkanime.net", getCatalog: vi.fn(),
      search: vi.fn().mockResolvedValue([
        { id: base.slug, title: base.title, slug: base.slug },
        { id: third.slug, title: third.title, slug: third.slug },
      ]),
      getMedia: vi.fn().mockImplementation((slug: string) => Promise.resolve(slug === third.slug ? third : base)),
      getEpisode: vi.fn().mockResolvedValue({
        media: third, episodeNumber: 1,
        embeds: [{ server: "JKAnime UM", language: "SUB-ES", url: "https://jkanime.net/jkplayer/um/?u=test" }],
      }),
    };
    const service = new ProviderSearchService(testConfig(), seasonMetadata, [
      { provider: jkanime, resolvers: resolver("https://nika.playmudos.com/title/master.m3u8") },
    ]);
    const streams = await service.getStreams("series", "tt3398540:3:1");
    expect(jkanime.getEpisode).toHaveBeenCalledWith("haikyuu-third-season", 1, expect.objectContaining({
      type: "series", season: 3, episode: 1,
    }));
    expect(streams[0]?.title).toContain("Third Season");
  });
});
