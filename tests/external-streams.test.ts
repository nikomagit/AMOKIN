import { describe, expect, it, vi } from "vitest";
import { ExternalStreamAggregator } from "../src/services/external-streams.js";
import type { StreamSearchService } from "../src/types.js";
import { testConfig } from "./helpers.js";

const addons = [
  {
    name: "Latinobrid PM",
    manifestUrl: "https://latin.example/private/manifest.json",
    idFormat: "imdb" as const,
    position: "before-local" as const,
  },
  {
    name: "Latinobrid TB",
    manifestUrl: "https://latin-tb.example/private/manifest.json",
    idFormat: "imdb" as const,
    position: "before-local" as const,
  },
  {
    name: "Nube+",
    manifestUrl: "https://nube-plus.example/private/manifest.json",
    idFormat: "imdb" as const,
    position: "before-local" as const,
  },
  {
    name: "Nube Debrid",
    manifestUrl: "https://nube-debrid.example/private/manifest.json",
    idFormat: "imdb-or-kitsu" as const,
    position: "after-local" as const,
  },
  {
    name: "NoTorrent",
    manifestUrl: "https://direct.example/manifest.json?token=private",
    idFormat: "imdb-or-tmdb-underscore" as const,
    position: "last" as const,
  },
];

describe("external stream aggregation", () => {
  it("places Latinobrid and Nube+ before AMOKIN, then Nube Debrid and NoTorrent", async () => {
    const local: StreamSearchService = {
      getStreams: vi.fn().mockResolvedValue([{ name: "AMOKIN", url: "https://video.example/local.m3u8" }]),
    } as StreamSearchService;
    const request = vi.fn()
      .mockResolvedValueOnce('{"streams":[{"name":"Latinobrid PM","url":"https://video.example/pm.m3u8"}]}')
      .mockResolvedValueOnce('{"streams":[{"name":"Latinobrid TB","url":"https://video.example/tb.m3u8"}]}')
      .mockResolvedValueOnce('{"streams":[{"name":"Nube+","url":"https://video.example/nube-plus.m3u8"}]}')
      .mockResolvedValueOnce('{"streams":[{"name":"Nube Debrid","url":"https://video.example/nube-debrid.m3u8"}]}')
      .mockResolvedValueOnce(JSON.stringify({
        streams: [
          { name: "NoTorrent", url: "https://video.example/notorrent.m3u8", behaviorHints: { notWebReady: true } },
          { name: "Duplicate", url: "https://video.example/local.m3u8" },
          { name: "Torrent", infoHash: "hash", sources: ["tracker:test"] },
          { name: "Promotion", externalUrl: "https://chat.example" },
        ],
      }));
    const service = new ExternalStreamAggregator(
      testConfig({ externalStreamAddons: addons }),
      local,
      request,
    );

    await expect(service.getStreams("movie", "tt0133093")).resolves.toEqual([
      expect.objectContaining({ name: "Latinobrid PM", url: "https://video.example/pm.m3u8" }),
      expect.objectContaining({ name: "Latinobrid TB", url: "https://video.example/tb.m3u8" }),
      expect.objectContaining({ name: "Nube+", url: "https://video.example/nube-plus.m3u8" }),
      expect.objectContaining({ name: "AMOKIN", url: "https://video.example/local.m3u8" }),
      expect.objectContaining({ name: "Nube Debrid", url: "https://video.example/nube-debrid.m3u8" }),
      expect.objectContaining({ name: "NoTorrent", url: "https://video.example/notorrent.m3u8" }),
    ]);
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("preserves manifest query credentials and translates AMOKIN TMDB IDs for NoTorrent", async () => {
    const local = { getStreams: vi.fn().mockResolvedValue([]) };
    const request = vi.fn().mockResolvedValue('{"streams":[]}');
    const service = new ExternalStreamAggregator(
      testConfig({ externalStreamAddons: addons }),
      local,
      request,
    );

    await service.getStreams("series", "tmdb:37854:1:2");

    expect(request).toHaveBeenCalledTimes(1);
    const url = request.mock.calls[0]?.[0] as URL;
    expect(url.origin).toBe("https://direct.example");
    expect(decodeURIComponent(url.pathname)).toBe("/stream/series/tmdb_37854:1:2.json");
    expect(url.searchParams.get("token")).toBe("private");
  });

  it("isolates failed addons so the remaining sources still load", async () => {
    const local = { getStreams: vi.fn().mockRejectedValue(new Error("local unavailable")) };
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("first addon unavailable"))
      .mockResolvedValueOnce('{"streams":[{"name":"Available","url":"https://video.example/ok.mp4"}]}')
      .mockResolvedValueOnce('{"streams":[]}')
      .mockResolvedValueOnce('{"streams":[]}')
      .mockResolvedValueOnce('{"streams":[]}');
    const service = new ExternalStreamAggregator(
      testConfig({ externalStreamAddons: addons }),
      local,
      request,
    );

    await expect(service.getStreams("movie", "tt0133093")).resolves.toEqual([
      expect.objectContaining({ name: "Available", url: "https://video.example/ok.mp4" }),
    ]);
  });

  it("forwards Kitsu IDs to Nube Debrid", async () => {
    const local = { getStreams: vi.fn().mockResolvedValue([]) };
    const request = vi.fn().mockResolvedValue('{"streams":[]}');
    const service = new ExternalStreamAggregator(
      testConfig({ externalStreamAddons: addons }),
      local,
      request,
    );

    await service.getStreams("series", "kitsu:12:1");

    expect(request).toHaveBeenCalledTimes(1);
    const url = request.mock.calls[0]?.[0] as URL;
    expect(url.origin).toBe("https://nube-debrid.example");
    expect(decodeURIComponent(url.pathname)).toBe("/private/stream/series/kitsu:12:1.json");
  });
});
