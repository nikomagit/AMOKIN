import { describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { AnimeAv1Client } from "../src/providers/animeav1/client.js";
import { sveltePayload, testConfig } from "./helpers.js";

const result = {
  id: "197",
  title: "One Piece",
  synopsis: "Piratas y aventuras.",
  slug: "one-piece",
  category: { id: 1, name: "TV Anime", slug: "tv-anime" },
};

function catalogResponse(url: URL): string {
  const popular = url.searchParams.get("order") === "popular";
  const airing = url.searchParams.get("status") === "emision";
  return sveltePayload({
    results: [result],
    total: 41,
    orderKey: popular ? "popular" : "default",
    filters: { status: airing ? 2 : null },
    pagination: {
      currentPage: Number(url.searchParams.get("page") || 1),
      recordsPerPage: 20,
      totalPages: 3,
      totalRecords: 41,
    },
  });
}

describe("public Svelte provider clients", () => {
  it("supports AnimeAV1 search, popular, airing, media, episodes and embeds", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.pathname === "/catalogo/__data.json") return catalogResponse(url);
      const media = {
        id: 197,
        title: "One Piece",
        slug: "one-piece",
        aka: { "ja-jp": "ONE PIECE" },
        synopsis: "Piratas y aventuras.",
        status: 2,
        startDate: "1999-10-20",
        score: 8.73,
        votes: 1553220,
        category: result.category,
        genres: [{ id: 1, name: "Acción", slug: "accion" }],
        episodes: [{ id: 1, number: 1 }, { id: 1176, number: 1176 }],
      };
      if (url.pathname.endsWith("/1176/__data.json")) {
        return sveltePayload({
          media,
          episode: { id: 1176, number: 1176 },
          embeds: {
            SUB: [
              { server: "HLS", url: "https://player.zilla-networks.com/play/3304e956727a3cd4c4116a11526a6094" },
              { server: "MP4Upload", url: "https://www.mp4upload.com/embed-example.html" },
            ],
          },
        });
      }
      return sveltePayload({ media });
    });
    const client = new AnimeAv1Client(testConfig(), request);

    await expect(client.search("One Piece")).resolves.toMatchObject([{ slug: "one-piece" }]);
    await expect(client.getCatalog("popular", 2)).resolves.toMatchObject({ orderKey: "popular", currentPage: 2 });
    await expect(client.getCatalog("airing", 1)).resolves.toMatchObject({ status: 2 });
    await expect(client.getMedia("one-piece")).resolves.toMatchObject({
      title: "One Piece",
      votes: 1553220,
      genres: [{ name: "Acción" }],
      episodes: [{ number: 1 }, { number: 1176 }],
    });
    await expect(client.getEpisode("one-piece", 1176)).resolves.toMatchObject({
      episodeNumber: 1176,
      embeds: [{ server: "HLS", language: "SUB" }, { server: "MP4Upload", language: "SUB" }],
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/catalogo/__data.json" }),
      expect.any(Object),
    );
  });

  it("rejects unsafe provider slugs without making a request", async () => {
    const request: FetchText = vi.fn();
    const client = new AnimeAv1Client(testConfig(), request);
    await expect(client.getMedia("../admin")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
