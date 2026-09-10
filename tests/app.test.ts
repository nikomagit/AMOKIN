import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { UpstreamTimeoutError } from "../src/errors.js";
import type { FetchText } from "../src/lib/http.js";
import type { CatalogService, MetaService, StreamSearchService } from "../src/types.js";
import { testConfig } from "./helpers.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("HTTP addon interface", () => {
  it("serves a Nuvio-compatible, explicitly non-P2P manifest", async () => {
    const app = await buildApp(testConfig(), {
      searchService: { getStreams: vi.fn().mockResolvedValue([]) },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/manifest.json" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    const body = response.json();
    expect(body).toMatchObject({
      id: "org.nuvio.amokin",
      version: "2.3.1",
      name: "AMOKIN",
      description: "Contenido en Latino y sin torrents para Nuvio/Stremio, creado por y para NIKOMA.",
      logo: "https://amokin.onrender.com/logo.jpg",
      behaviorHints: { adult: true, p2p: false, configurable: false },
    });
    expect(body.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "catalog" }),
      expect.objectContaining({ name: "meta", idPrefixes: ["amokin:", "latam-tv:"] }),
      expect.objectContaining({
        name: "stream",
        idPrefixes: ["tt", "tmdb:", "tvdb:", "kitsu:", "anilist:", "mal:", "anidb:", "amokin:", "latam-tv:"],
      }),
    ]));
    expect(body.catalogs.map((catalog: { id: string }) => catalog.id)).toEqual([
      "hentaila-popular",
      "hentaila-airing",
      "hentaila-uncensored",
      "latam-tv",
    ]);
    expect(body.catalogs.at(-1)).toMatchObject({
      type: "tv",
      id: "latam-tv",
      extra: [{ name: "genre", options: ["Deportes", "Regionales"] }],
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      version: "2.3.1",
      p2p: false,
      sources: ["AnimeAV1", "Hentaila", "JKAnime", "LATAM TV"],
    });
  });

  it("serves the addon logo as a cacheable JPEG", async () => {
    const app = await buildApp(testConfig(), {
      searchService: { getStreams: vi.fn().mockResolvedValue([]) },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/logo.jpg" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.rawPayload.byteLength).toBeGreaterThan(10_000);
  });

  it("serves catalog pagination and provider-native metadata envelopes", async () => {
    const catalogService: CatalogService = {
      getCatalog: vi.fn().mockResolvedValue([{ id: "amokin:hentaila:example", type: "series", name: "Example" }]),
    };
    const metaService: MetaService = {
      getMeta: vi.fn().mockResolvedValue({ id: "amokin:animeav1:one-piece", type: "series", name: "One Piece" }),
    };
    const app = await buildApp(testConfig(), {
      searchService: { getStreams: vi.fn().mockResolvedValue([]) },
      catalogService,
      metaService,
    });
    apps.push(app);
    const catalog = await app.inject({ method: "GET", url: "/catalog/series/hentaila-popular/skip=20.json" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().metas).toHaveLength(1);
    expect(catalogService.getCatalog).toHaveBeenCalledWith("series", "hentaila-popular", 20);
    const meta = await app.inject({ method: "GET", url: "/meta/series/amokin:animeav1:one-piece.json" });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().meta.name).toBe("One Piece");
  });

  it("returns the standard streams envelope", async () => {
    const service: StreamSearchService = {
      getStreams: vi.fn().mockResolvedValue([{ url: "https://cdn.example/video.mp4" }]),
    } as unknown as StreamSearchService;
    const app = await buildApp(testConfig(), { searchService: service });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/stream/movie/tt1234567.json" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ streams: [{ url: "https://cdn.example/video.mp4" }] });
  });

  it("integrates the LATAM TV catalog, genre filter, metadata, poster and stream routes", async () => {
    const latamTvRequest: FetchText = vi.fn(async (url) => {
      const value = new URL(url);
      if (value.href === "https://embed.example/") {
        return `
          <div class="category active" id="deportes">
            <div class="channel-name">Canal Deportivo</div>
            <a href="https://embed.example/deportivo.php">LINK</a>
          </div>
          <div class="category" id="regionales">
            <div class="channel-name">Canal Regional</div>
            <a href="https://embed.example/regional.php">LINK</a>
          </div>`;
      }
      if (value.href === "https://embed.example/deportivo.php") {
        return `<h2>JW PLAYER</h2><input value="&lt;iframe src=&quot;https://embed.example/embed2/deportivo.php&quot;&gt;&lt;/iframe&gt;">`;
      }
      if (value.href === "https://embed.example/embed2/deportivo.php") {
        return `<iframe src="https://player.example/live.php?channel=deportivo"></iframe>`;
      }
      if (value.hostname === "player.example") {
        return `file: "https:\/\/player.example\/playlist.php?id=deportivo";`;
      }
      throw new Error(`Unexpected LATAM TV URL: ${value.href}`);
    });
    const latamTvProxyRequest = vi.fn(async (url: string) => {
      const value = new URL(url);
      if (value.pathname === "/playlist.php") {
        return new Response(
          "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://player.example/live/segment.ts?token=fresh\n",
          { headers: { "content-type": "application/vnd.apple.mpegurl" } },
        );
      }
      if (value.pathname === "/live/segment.ts") {
        return new Response(new Uint8Array([0x47, 0x40, 0x00, 0x10]), {
          headers: { "content-type": "video/mp2t" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const app = await buildApp(testConfig(), {
      searchService: { getStreams: vi.fn().mockResolvedValue([]) },
      latamTvRequest,
      latamTvProxyRequest,
    });
    apps.push(app);

    const catalog = await app.inject({
      method: "GET",
      url: "/catalog/tv/latam-tv/genre=Deportes.json",
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().metas).toEqual([
      expect.objectContaining({
        id: "latam-tv:deportivo",
        name: "Canal Deportivo",
        genres: ["Deportes"],
        poster: expect.stringMatching(/\/latam-tv\/posters\/deportivo\.png$/),
      }),
    ]);

    const meta = await app.inject({ method: "GET", url: "/meta/tv/latam-tv:deportivo.json" });
    expect(meta.json().meta).toMatchObject({
      id: "latam-tv:deportivo",
      genres: ["Deportes"],
    });

    const stream = await app.inject({ method: "GET", url: "/stream/tv/latam-tv:deportivo.json" });
    const streams = stream.json().streams;
    expect(streams).toEqual([
      expect.objectContaining({
        type: "hls",
        url: expect.stringMatching(/\/latam-tv\/proxy\/playlist\/[a-f0-9-]+\.m3u8$/),
      }),
    ]);
    const proxiedPlaylist = await app.inject({
      method: "GET",
      url: new URL(streams[0].url).pathname,
    });
    expect(proxiedPlaylist.statusCode).toBe(200);
    const resourceUrl = proxiedPlaylist.body.split("\n").find((line) => line.startsWith("http"));
    expect(resourceUrl).toMatch(/\/latam-tv\/proxy\/resource\/[a-f0-9-]+\.ts$/);
    const proxiedResource = await app.inject({
      method: "GET",
      url: new URL(resourceUrl!).pathname,
    });
    expect(proxiedResource.statusCode).toBe(200);
    expect(proxiedResource.headers["content-type"]).toContain("video/mp2t");
    expect(proxiedResource.rawPayload).toEqual(Buffer.from([0x47, 0x40, 0x00, 0x10]));

    const poster = await app.inject({ method: "GET", url: "/latam-tv/posters/espnpremium.png" });
    expect(poster.statusCode).toBe(200);
    expect(poster.headers["content-type"]).toContain("image/png");
    expect(poster.rawPayload.byteLength).toBeGreaterThan(10_000);
  });

  it("maps upstream timeouts to a diagnostic response", async () => {
    const app = await buildApp(testConfig(), {
      searchService: {
        getStreams: vi.fn().mockRejectedValue(new UpstreamTimeoutError("Hentaila")),
      },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/stream/movie/tt1234567.json" });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ streams: [], error: { code: "UPSTREAM_TIMEOUT" } });
  });
});
