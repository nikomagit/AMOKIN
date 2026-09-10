import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { FetchText } from "../../lib/http.js";
import {
  LATAM_TV_CATALOG_ID,
  LATAM_TV_GENRES,
  LatamTvClient,
  type LatamTvClientOptions,
} from "./client.js";
import { readLatamTvPoster } from "./poster.js";
import {
  filterLatamTvChannels,
  latamTvFilters,
  latamTvMeta,
  requestOrigin,
} from "./presentation.js";

export interface LocalLatamTvAppOptions extends LatamTvClientOptions {
  host?: string;
  port?: number;
}

export function buildLocalLatamTvApp(
  options: LocalLatamTvAppOptions,
  request?: FetchText,
): FastifyInstance {
  const app = Fastify({ logger: false });
  const client = new LatamTvClient(options, request);

  const manifestCatalog = {
    type: "tv",
    id: LATAM_TV_CATALOG_ID,
    name: "LATAM TV • En vivo",
    extra: [{ name: "genre", isRequired: false, options: [...LATAM_TV_GENRES] }],
  };

  app.get("/manifest.json", async () => ({
    id: "org.nuvio.amokin.latam-tv.local",
    version: "0.2.0-local",
    name: "AMOKIN LATAM TV (local)",
    description: "Prueba local aislada de canales TV en vivo.",
    types: ["tv"],
    catalogs: [manifestCatalog],
    resources: [
      { name: "catalog", types: ["tv"] },
      { name: "meta", types: ["tv"], idPrefixes: ["latam-tv:"] },
      { name: "stream", types: ["tv"], idPrefixes: ["latam-tv:"] },
    ],
    idPrefixes: ["latam-tv:"],
    behaviorHints: { configurable: false, configurationRequired: false, p2p: false },
  }));

  const catalog = async (
    request: FastifyRequest,
    extra?: string,
  ) => {
    const query = request.query as { genre?: string };
    const filters = latamTvFilters(query.genre, extra);
    const channels = filterLatamTvChannels(await client.getChannels(), filters);
    const origin = requestOrigin(request);
    return { metas: channels.map((channel) => latamTvMeta(channel, origin)) };
  };

  app.get<{ Querystring: { genre?: string } }>(
    "/catalog/tv/latam-tv.json",
    async (request) => catalog(request),
  );
  app.get<{ Params: { extra: string }; Querystring: { genre?: string } }>(
    "/catalog/tv/latam-tv/:extra.json",
    async (request) => catalog(request, request.params.extra),
  );

  app.get<{ Params: { id: string } }>("/meta/tv/:id.json", async (request) => {
    const channel = await client.getChannel(request.params.id);
    return { meta: channel ? latamTvMeta(channel, requestOrigin(request)) : null };
  });

  app.get<{ Params: { id: string } }>("/stream/tv/:id.json", async (request) => ({
    streams: (await client.resolveChannel(request.params.id)).map((stream) => ({
      name: stream.name,
      title: stream.title,
      type: stream.type,
      url: stream.url,
      behaviorHints: { proxyHeaders: { request: stream.headers } },
    })),
  }));

  app.get<{ Params: { slug: string } }>("/latam-tv/posters/:slug.png", async (request, reply) => {
    const poster = await readLatamTvPoster(request.params.slug);
    if (!poster) return reply.status(404).send({ error: "Poster not found" });
    void reply.header("cache-control", "public, max-age=604800, immutable");
    return reply.type("image/png").send(poster);
  });

  app.get("/health", async () => ({ status: "ok", source: "LATAM TV", isolated: true }));
  return app;
}
