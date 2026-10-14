import { describe, expect, it, vi } from "vitest";
import type { DirectMediaProvider, ProviderId } from "../src/providers/types.js";
import { ProviderMetaService } from "../src/services/meta.js";

function fakeProvider(id: ProviderId): DirectMediaProvider {
  return {
    id,
    name: id === "animeav1" ? "AnimeAV1" : "JKAnime",
    baseUrl: `https://${id}.example`,
    cdnBaseUrl: `https://cdn.${id}.example`,
    search: vi.fn(),
    getCatalog: vi.fn(),
    getMedia: vi.fn().mockResolvedValue(null),
    getEpisode: vi.fn(),
  };
}

describe("provider metadata service", () => {
  it("builds rich metadata and episode IDs from a provider-native catalog ID", async () => {
    const anime = fakeProvider("animeav1");
    vi.mocked(anime.getMedia).mockResolvedValue({
      id: 197,
      title: "One Piece",
      slug: "one-piece",
      aka: { "ja-jp": "ONE PIECE" },
      synopsis: "Piratas y aventuras.",
      startDate: "1999-10-20",
      status: 2,
      score: 8.73,
      category: { id: 1, name: "TV Anime", slug: "tv-anime" },
      genres: [{ id: 1, name: "Acción", slug: "accion" }],
      episodes: [{ id: 1, number: 1 }, { id: 2, number: 2 }],
    });
    const service = new ProviderMetaService([anime]);
    await expect(service.getMeta("series", "amokin:animeav1:one-piece")).resolves.toMatchObject({
      id: "amokin:animeav1:one-piece",
      type: "series",
      name: "One Piece",
      releaseInfo: "1999",
      genres: ["Acción"],
      status: "En emisión",
      videos: [
        { id: "amokin:animeav1:one-piece:1", season: 1, episode: 1 },
        { id: "amokin:animeav1:one-piece:2", season: 1, episode: 2 },
      ],
    });
  });
});
