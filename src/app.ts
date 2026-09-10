import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { AppConfig } from "./config.js";
import {
  LATAM_TV_CATALOG_ID,
  LatamTvClient,
} from "./experimental/latam-tv/client.js";
import { readLatamTvPoster } from "./experimental/latam-tv/poster.js";
import { LatamTvProxy, type LatamTvProxyFetch } from "./experimental/latam-tv/proxy.js";
import {
  filterLatamTvChannels,
  latamTvFilters,
  latamTvMeta,
  requestOrigin,
} from "./experimental/latam-tv/presentation.js";
import type { FetchText } from "./lib/http.js";
import {
  AppError,
  InvalidMediaRequestError,
  MetadataUnavailableError,
} from "./errors.js";
import { manifest } from "./manifest.js";
import { RemoteMetadataProvider } from "./metadata/client.js";
import { AnimeAv1Client } from "./providers/animeav1/client.js";
import { HentailaClient } from "./providers/hentaila/client.js";
import { JkAnimeClient } from "./providers/jkanime/client.js";
import { DirectStreamResolverRegistry } from "./providers/resolvers.js";
import { ProviderCatalogService } from "./services/catalog.js";
import { ProviderMetaService } from "./services/meta.js";
import { ProviderSearchService } from "./services/search.js";
import { ExternalStreamAggregator } from "./services/external-streams.js";
import type { CatalogService, MetaService, StreamSearchService } from "./types.js";

export interface AppDependencies {
  searchService?: StreamSearchService;
  catalogService?: CatalogService;
  metaService?: MetaService;
  externalStreamRequest?: FetchText;
  latamTvRequest?: FetchText;
  latamTvProxyRequest?: LatamTvProxyFetch;
}

interface StreamParams {
  type: string;
  id: string;
}

interface CatalogParams extends StreamParams {
  extra?: string;
}

interface CatalogQuery {
  skip?: string;
  genre?: string;
}

function catalogSkip(query: string | undefined, extra: string | undefined): number {
  const raw = query ?? (extra ? new URLSearchParams(extra).get("skip") ?? undefined : undefined);
  if (raw === undefined || raw === "") return 0;
  if (!/^\d+$/.test(raw)) throw new InvalidMediaRequestError("Invalid catalog skip value");
  return Number(raw);
}

function publicError(error: AppError) {
  return {
    streams: [],
    error: {
      code: error.code,
      message: error.expose ? error.message : "Request failed",
    },
  };
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 16 * 1024,
    requestTimeout: config.requestTimeoutMs * 3 + config.metadataTimeoutMs + 2_000,
  });

  await app.register(cors, {
    origin: "*",
    methods: ["GET", "HEAD", "OPTIONS"],
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("referrer-policy", "no-referrer");
    return payload;
  });

  const animeAv1 = new AnimeAv1Client(config);
  const hentaila = new HentailaClient(config);
  const jkAnime = new JkAnimeClient(config);
  const animeProviders = [animeAv1, hentaila, jkAnime];
  const resolvers = new DirectStreamResolverRegistry(config);
  const localSearchService = dependencies.searchService ?? new ProviderSearchService(
    config,
    new RemoteMetadataProvider(config),
    animeProviders.map((provider) => ({ provider, resolvers })),
  );
  const searchService = new ExternalStreamAggregator(
    config,
    localSearchService,
    dependencies.externalStreamRequest,
  );
  const catalogService = dependencies.catalogService ?? new ProviderCatalogService(animeProviders);
  const metaService = dependencies.metaService ?? new ProviderMetaService(animeProviders);
  const latamTv = new LatamTvClient({
    catalogUrl: config.latamTvCatalogUrl,
    trustedPlayerHostSuffixes: config.latamTvPlayerHostSuffixes,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    userAgent: config.playbackUserAgent,
    maxStreams: config.maxStreams,
    catalogCacheTtlMs: config.catalogCacheTtlMs,
  }, dependencies.latamTvRequest);
  const latamTvProxy = new LatamTvProxy({
    trustedHostSuffixes: config.latamTvPlayerHostSuffixes,
    timeoutMs: config.requestTimeoutMs,
  }, dependencies.latamTvProxyRequest);

  app.get("/", async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=300");
    return {
      name: manifest.name,
      version: manifest.version,
      protocol: "Stremio addon protocol (Nuvio compatible)",
      manifest: "/manifest.json",
      logo: "/logo.jpg",
      health: "/health",
      sources: ["AnimeAV1", "Hentaila", "JKAnime", "LATAM TV", ...config.externalStreamAddons.map((source) => source.name)],
      streaming: "AMOKIN direct sources + configured stream addons",
      p2p: false,
    };
  });

  app.get("/manifest.json", async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=86400");
    return manifest;
  });

  app.get("/logo.jpg", async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=604800, immutable");
    return reply.type("image/jpeg").send(
      await readFile(resolve(process.cwd(), "assets", "logo-amokin.jpg")),
    );
  });

  app.get("/health", async (_request, reply) => {
    void reply.header("cache-control", "no-store");
    return {
      status: "ok",
      version: manifest.version,
      sources: ["AnimeAV1", "Hentaila", "JKAnime", "LATAM TV", ...config.externalStreamAddons.map((source) => source.name)],
      p2p: false,
    };
  });

  const serveCatalog = async (
    request: FastifyRequest<{ Params: CatalogParams; Querystring: CatalogQuery }>,
    reply: FastifyReply,
  ) => {
    void reply.header("cache-control", "public, max-age=600, stale-if-error=3600");
    try {
      if (request.params.type === "tv" && request.params.id === LATAM_TV_CATALOG_ID) {
        const filters = latamTvFilters(request.query.genre, request.params.extra);
        const channels = filterLatamTvChannels(await latamTv.getChannels(), filters);
        const origin = requestOrigin(request);
        return { metas: channels.map((channel) => latamTvMeta(channel, origin)) };
      }
      const skip = catalogSkip(request.query.skip, request.params.extra);
      return { metas: await catalogService.getCatalog(request.params.type, request.params.id, skip) };
    } catch (error) {
      request.log.warn({ error, catalogId: request.params.id }, "Catalog request failed");
      return { metas: [] };
    }
  };

  app.get<{ Params: CatalogParams; Querystring: CatalogQuery }>(
    "/catalog/:type/:id.json",
    serveCatalog,
  );
  app.get<{ Params: CatalogParams; Querystring: CatalogQuery }>(
    "/catalog/:type/:id/:extra.json",
    serveCatalog,
  );

  app.get<{ Params: StreamParams }>("/meta/:type/:id.json", async (request, reply) => {
    void reply.header("cache-control", "public, max-age=3600, stale-if-error=86400");
    try {
      if (request.params.type === "tv" && request.params.id.startsWith("latam-tv:")) {
        const channel = await latamTv.getChannel(request.params.id);
        return { meta: channel ? latamTvMeta(channel, requestOrigin(request)) : null };
      }
      return { meta: await metaService.getMeta(request.params.type, request.params.id) };
    } catch (error) {
      request.log.warn({ error, mediaId: request.params.id }, "Metadata request failed");
      return { meta: null };
    }
  });

  app.get<{ Params: StreamParams }>("/stream/:type/:id.json", async (request, reply) => {
    void reply.header("cache-control", "public, max-age=60, stale-if-error=300");
    try {
      if (request.params.type === "tv" && request.params.id.startsWith("latam-tv:")) {
        const origin = requestOrigin(request);
        return {
          streams: (await latamTv.resolveChannel(request.params.id)).map((stream) => ({
            name: stream.name,
            title: stream.title,
            type: stream.type,
            url: latamTvProxy.registerPlaylist(stream.url, stream.headers, origin),
          })),
        };
      }
      return { streams: await searchService.getStreams(request.params.type, request.params.id) };
    } catch (error) {
      if (
        error instanceof InvalidMediaRequestError ||
        error instanceof MetadataUnavailableError
      ) {
        request.log.info(
          { code: error.code, mediaType: request.params.type, mediaId: request.params.id },
          error.message,
        );
        return { streams: [] };
      }
      throw error;
    }
  });

  app.get<{ Params: { slug: string } }>("/latam-tv/posters/:slug.png", async (request, reply) => {
    const poster = await readLatamTvPoster(request.params.slug);
    if (!poster) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Poster not found" } });
    void reply.header("cache-control", "public, max-age=604800, immutable");
    return reply.type("image/png").send(poster);
  });

  app.get<{ Params: { token: string } }>(
    "/latam-tv/proxy/playlist/:token",
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      try {
        const playlist = await latamTvProxy.getPlaylist(request.params.token, requestOrigin(request));
        if (!playlist) return reply.status(404).send({ error: "Playlist expired" });
        return reply.type(playlist.contentType).send(playlist.body);
      } catch (error) {
        request.log.warn({ error }, "LATAM TV playlist proxy failed");
        return reply.status(502).send({ error: "Playlist upstream failed" });
      }
    },
  );

  app.get<{ Params: { token: string } }>(
    "/latam-tv/proxy/resource/:token",
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      try {
        const upstream = await latamTvProxy.getResource(request.params.token, request.headers.range);
        if (!upstream) return reply.status(404).send({ error: "Resource expired" });
        void reply.status(upstream.status);
        for (const header of ["accept-ranges", "content-length", "content-range", "content-type"] as const) {
          const value = upstream.headers.get(header);
          if (value) void reply.header(header, value);
        }
        if (!upstream.body) return reply.send();
        const reader = upstream.body.getReader();
        const body = Readable.from((async function* () {
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              yield Buffer.from(chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
        })());
        return reply.send(body);
      } catch (error) {
        request.log.warn({ error }, "LATAM TV resource proxy failed");
        return reply.status(502).send({ error: "Resource upstream failed" });
      }
    },
  );

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Endpoint not found" } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, error }, error.message);
      return reply.status(error.statusCode).send(publicError(error));
    }
    request.log.error({ error }, "Unhandled request error");
    return reply.status(500).send({
      streams: [],
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  return app;
}
