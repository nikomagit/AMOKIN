import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { UpstreamTimeoutError } from "../src/errors.js";
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
      version: "2.2.3",
      name: "AMOKIN",
      description: "Contenido en Latino y sin torrents para Nuvio/Stremio, creado por y para NIKOMA.",
      logo: "https://amokin.onrender.com/logo.jpg",
      behaviorHints: { adult: true, p2p: false, configurable: false },
    });
    expect(body.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "catalog" }),
      expect.objectContaining({ name: "meta", idPrefixes: ["amokin:"] }),
      expect.objectContaining({
        name: "stream",
        idPrefixes: ["tt", "tmdb:", "tvdb:", "kitsu:", "anilist:", "mal:", "anidb:", "amokin:"],
      }),
    ]));
    expect(body.catalogs.map((catalog: { id: string }) => catalog.id)).toEqual([
      "hentaila-popular",
      "hentaila-airing",
      "hentaila-uncensored",
    ]);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      version: "2.2.3",
      p2p: false,
      sources: ["AnimeAV1", "Hentaila", "JKAnime"],
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
