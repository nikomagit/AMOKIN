import {
  LATAM_TV_GENRES,
  latamTvChannelSlug,
  type LatamTvChannel,
  type LatamTvGenre,
} from "./client.js";

export interface LatamTvCatalogFilters {
  genre?: string;
}

export function normalizeLatamTvGenre(value: string | undefined): LatamTvGenre | undefined {
  if (!value) return undefined;
  return LATAM_TV_GENRES.find((genre) => genre.toLocaleLowerCase("es") === value.toLocaleLowerCase("es"));
}

export function latamTvFilters(queryGenre: string | undefined, extra: string | undefined): LatamTvCatalogFilters {
  const genre = queryGenre ?? (extra ? new URLSearchParams(extra).get("genre") ?? undefined : undefined);
  return genre ? { genre } : {};
}

export function requestOrigin(request: { headers: { host?: string | undefined }; protocol: string }): string {
  const host = request.headers.host;
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return "http://127.0.0.1";
  return `${request.protocol}://${host}`;
}

export function latamTvPosterUrl(channel: LatamTvChannel, origin: string): string {
  const slug = latamTvChannelSlug(channel.id);
  if (!slug) throw new Error(`Invalid LATAM TV channel id: ${channel.id}`);
  return `${origin}/latam-tv/posters/${slug}.png`;
}

export function latamTvMeta(channel: LatamTvChannel, origin: string) {
  const poster = latamTvPosterUrl(channel, origin);
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    poster,
    background: poster,
    description: `Canal de televisión en vivo · ${channel.genre}: ${channel.name}`,
    genres: [channel.genre],
  };
}

export function filterLatamTvChannels(
  channels: LatamTvChannel[],
  filters: LatamTvCatalogFilters,
): LatamTvChannel[] {
  const genre = normalizeLatamTvGenre(filters.genre);
  if (filters.genre && !genre) return [];
  return genre ? channels.filter((channel) => channel.genre === genre) : channels;
}
