import { describe, expect, it } from "vitest";
import { parseMediaId, parseMediaType } from "../src/metadata/media-id.js";
import { parseProviderMediaId, providerMediaId } from "../src/metadata/provider-id.js";

describe("Nuvio media IDs", () => {
  it("parses IMDb, TMDB, TVDB, Kitsu, AniList, MAL and AniDB episode IDs", () => {
    expect(parseMediaId("series", "tt1234567:2:4")).toEqual({
      provider: "imdb", baseId: "tt1234567", season: 2, episode: 4,
    });
    expect(parseMediaId("series", "tmdb:123:1:2")).toEqual({
      provider: "tmdb", baseId: "123", season: 1, episode: 2,
    });
    expect(parseMediaId("series", "tvdb:81797:1:2")).toEqual({
      provider: "tvdb", baseId: "81797", season: 1, episode: 2,
    });
    expect(parseMediaId("series", "kitsu:456:3")).toEqual({
      provider: "kitsu", baseId: "456", season: 1, episode: 3,
    });
    expect(parseMediaId("series", "anilist:21:1176")).toEqual({
      provider: "anilist", baseId: "21", season: 1, episode: 1176,
    });
    expect(parseMediaId("series", "mal:21:1:1176")).toEqual({
      provider: "mal", baseId: "21", season: 1, episode: 1176,
    });
    expect(parseMediaId("movie", "anidb:69")).toEqual({ provider: "anidb", baseId: "69" });
  });

  it("creates and parses stable AMOKIN provider and episode IDs", () => {
    expect(providerMediaId("animeav1", "one-piece", 1176)).toBe("amokin:animeav1:one-piece:1176");
    expect(parseProviderMediaId("amokin:animeav1:one-piece:1176")).toEqual({
      provider: "animeav1", slug: "one-piece", episode: 1176,
    });
    expect(providerMediaId("jkanime", "haikyuu-third-season", 1)).toBe("amokin:jkanime:haikyuu-third-season:1");
    expect(parseProviderMediaId("amokin:jkanime:haikyuu-third-season:1")).toEqual({
      provider: "jkanime", slug: "haikyuu-third-season", episode: 1,
    });
    expect(() => parseProviderMediaId("amokin:animeav1:../admin")).toThrow();
    expect(() => parseProviderMediaId("amokin:unsupported:dune")).toThrow();
  });

  it("rejects malformed IDs and unsupported types", () => {
    expect(() => parseMediaType("anime")).toThrow();
    expect(() => parseMediaId("movie", "tt1234567:1:1")).toThrow();
    expect(() => parseMediaId("series", "tmdb:nope:1:1")).toThrow();
    expect(() => parseMediaId("movie", "anilist:21:1")).toThrow();
    expect(() => parseMediaId("movie", "tvdb:81797")).toThrow();
  });
});
