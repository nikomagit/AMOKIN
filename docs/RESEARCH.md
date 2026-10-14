# Investigación y decisiones técnicas

Revisión realizada el 3 de septiembre de 2026. Los proveedores, hosts y servicios de metadata son externos y pueden cambiar.

## Parte A — Anime

### Estado anterior

AMOKIN aceptaba IMDb, TMDB, Kitsu e IDs internos `amokin:`. IMDb se resolvía con Cinemeta, TMDB con un addon público compatible con Stremio y Kitsu con su API. Solo IMDb/TMDB compartían una identidad externa común; Kitsu aportaba títulos, pero no se relacionaba con esas bases. TVDB, AniList y MAL no eran IDs aceptados.

Los tres proveedores de anime se localizaban por títulos/aliases. La selección usaba año, categoría, cantidad de episodios y marcadores como `2nd Season`; era conservadora, pero podía fallar cuando una temporada tenía un nombre completamente distinto.

### Qué hace AIO Metadata

La rama `dev` de [AIO Metadata](https://github.com/cedya77/aiometadata/tree/dev) anuncia estos prefijos relevantes: IMDb (`tt`), `tmdb:`, `tvdb:`, `mal:`, `tvmaze:`, `kitsu:`, `anidb:` y `anilist:`. Su resolvedor:

- interpreta primero el prefijo;
- consulta Cinemeta y APIs de metadata para IMDb/TMDB/TVDB;
- mantiene índices cruzados para MAL, Kitsu, AniDB, AniList, IMDb, TMDB, TVDB y otros;
- trata las temporadas de anime como relaciones separadas cuando el mapa las conoce;
- resuelve episodios entre esquemas de numeración mediante sus mapas.

AIO no usa un solo ID universal. El identificador de entrada y el proveedor elegido determinan el flujo; internamente agrega múltiples IDs. En la metadata, `meta.id` conserva un identificador prefijado utilizable por Stremio, `imdb_id` se publica cuando existe y el proyecto transporta equivalencias adicionales en propiedades internas como `_tmdbId`, `_tvdbId`, `_malId`, `_kitsuId`, `_anilistId` y `_anidbId`. Sus mapas principales provienen de [Fribb anime-lists](https://github.com/Fribb/anime-lists), complementados por datasets como AnimeAPI y mapas específicos. Esto permite IMDb↔TMDB y, si existe una fila relacionada, IMDb/TMDB↔Kitsu/AniList/MAL/AniDB; la conversión inversa usa los mismos índices.

Antes de esta actualización AMOKIN no consultaba AIO Metadata. Depender de una instancia pública configurada de AIO introduciría configuración ajena, latencia y un nuevo punto único de fallo. Se reutilizó el enfoque, no el servidor: un cliente pequeño consulta equivalencias y los metadatos existentes siguen siendo independientes.

### Implementación 2.1.0

IDs de entrada:

| Entrada | Metadata primaria | Enriquecimiento/mapeo |
|---|---|---|
| IMDb | Cinemeta; sugerencias IMDb y TMDB opcional como fallback | AnimeAPI; AniList de la entrada mapeada |
| TMDB | addon público TMDB; API oficial opcional | endpoint AnimeAPI TMDB y endpoint específico de temporada |
| TVDB (series) | AnimeAPI | endpoint TVDB y endpoint específico de temporada |
| Kitsu | API pública Kitsu | AnimeAPI; AniList |
| AniList | GraphQL AniList | AnimeAPI |
| MAL | GraphQL AniList mediante `idMal` | AnimeAPI |
| AniDB | AnimeAPI (necesario para obtener título) | AniList si existe equivalencia |
| `amokin:` | ficha directa del proveedor | no requiere mapa externo |

La identidad normalizada puede contener `imdb`, `tmdb`, `kitsu`, `anilist`, `mal`, `anidb` y `tvdb`. AniList agrega título romaji, inglés, japonés, título preferido y sinónimos. Si AnimeAPI falla, IMDb, TMDB, Kitsu, AniList y MAL continúan con su fuente primaria; TVDB y AniDB no pueden resolverse sin el mapa.

Para `tmdb:{serie}:{temporada}:{episodio}` se consulta primero `/themoviedb/tv/{id}/seasons/{temporada}`. Para IMDb con un TMDB conocido se usa el mismo endpoint. Esto recupera la identidad real de la temporada, por ejemplo Haikyuu T3:

```text
IMDb tt3398540 + TMDB 60863 + temporada 3
→ AniList 21698, Kitsu 11935, MAL 32935, AniDB 11991
→ Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou
```

### Matching

Orden efectivo:

1. coincidencia de cualquier ID externo compartido;
2. descarte inmediato ante un ID externo conflictivo;
3. aliases específicos de la temporada;
4. títulos romaji, inglés, japonés, principal y sinónimos;
5. tipo, año, marcador de temporada y cantidad de episodios;
6. similitud textual como último fallback.

Una identidad externa exacta no se rechaza por idioma. Actualmente AnimeAV1 y JKAnime no publican esos IDs, así que en esos proveedores las equivalencias mejoran la lista de aliases y la identidad de temporada; no se finge un match directo por ID.

### Auditoría de proveedores

| Proveedor | Búsqueda | IDs externos publicados | Temporadas | Episodios | Streams aceptados |
|---|---|---|---|---|---|
| AnimeAV1 | texto en `catalogo/__data.json` | ninguno observado | ficha independiente o listado propio | número en datos SvelteKit | HLS y MP4Upload |
| JKAnime | `GET /buscar?q=` | ninguno observado | ficha independiente | `/{slug}/{episodio}/` | UM/UMV con HLS público |

AnimeAV1 publica título, aliases (`aka`), fecha, categoría y episodios en sus datos SvelteKit. JKAnime publica título, alias, año, categoría, total de episodios y embeds en HTML. Ninguno permite buscar directamente por IMDb/TMDB/Kitsu/AniList/MAL; por eso cada consulta genera múltiples aliases y valida la ficha antes de resolver vídeo.

### Limitaciones del mapa

- TMDB reutiliza números entre los espacios `movie` y `tv`; el tipo siempre forma parte de la ruta.
- Una serie IMDb puede representar varias entradas MAL/AniList. La temporada TMDB reduce esa ambigüedad cuando está disponible.
- Cours, especiales, OVAs y relaciones muchos-a-muchos no siempre tienen equivalencia perfecta.
- AnimeAPI es un servicio externo y su propio proyecto documenta cambios en sus fuentes de datos; AMOKIN lo usa como enriquecimiento tolerante a fallos, no como única metadata.

## Parte B — Películas y series generales

Los dos proveedores generales anteriores fueron eliminados completamente del código, configuración, resolvers y tests; no permanecen como fallback ni como integraciones deshabilitadas.

Se revisaron alternativas públicas conocidas con streams directos:

| Alternativa | Resultado | Motivo para no integrar |
|---|---|---|
| PeliApi | No recomendable | múltiples scrapers/hosters, Puppeteer y `yt-dlp` como fallbacks; alta fragilidad y coste para un host gratuito |
| WebStreamr | No recomendable | proyecto/instancia pública declarados obsoletos; los hosters cambian con frecuencia |
| Addon Latam / Primer Latino | No integrable como fuente | addons independientes o privados, contenido curado/credenciales; no ofrecen una API pública estable de proveedor |
| IPTV/Xtream | Fuera de alcance | requiere credenciales/lista de un proveedor del usuario y no es una fuente cero-configuración |
| Public Domain Movies | Cobertura insuficiente | catálogo limitado de dominio público y distribución torrent, no una fuente general HTTP comparable |

No se encontró una fuente general que cumpla simultáneamente cobertura, búsqueda fiable, películas y episodios, HLS/MP4 directo, ausencia de navegador/captcha y mantenimiento razonable. Por decisión conservadora no se integró ninguna.

## Seguridad y operación

- No se ejecuta JavaScript remoto ni se intenta sortear controles de acceso.
- Los hosts y extensiones finales se validan.
- Cada proveedor y resolver falla de forma aislada.
- Las respuestas tienen timeout y tamaño máximo.
- Las URLs se resuelven al pedir `/stream`; AMOKIN no almacena ni retransmite vídeo.
- No existen torrents, magnets, `infoHash`, debrid ni P2P.

## Pruebas

La suite cubre:

- parsing IMDb, TMDB, TVDB, Kitsu, AniList, MAL, AniDB y `amokin:`;
- conversiones a la identidad externa completa;
- endpoint TMDB de temporada;
- aliases japonés, inglés, romaji y sinónimos;
- match exacto y conflicto para IDs externos;
- fallback por alias sin ID del proveedor;
- temporadas separadas, episodios y rechazo de títulos parecidos incorrectos;
- proveedores, resolvers, deduplicación, aislamiento y contrato HTTP.

La validación en vivo reproducible está en `scripts/validate-live.ts`. Comprueba cada formato de ID con One Piece y la temporada 3 de Haikyuu mediante IMDb/TMDB; después solicita el HLS/MP4 final con los headers declarados y valida `#EXTM3U` en playlists.

Resultado del 3 de septiembre de 2026:

- One Piece E1 resolvió y reprodujo HLS mediante IMDb, TMDB, TVDB, Kitsu, AniList, MAL y AniDB.
- Cada formato produjo la misma identidad: IMDb `tt0388629`, TMDB `37854`, TVDB `81797`, Kitsu `12`, AniList/MAL `21` y AniDB `69`.
- AnimeAV1 respondió con HLS `200` y `#EXTM3U` desde `player.zilla-networks.com`.
- JKAnime respondió con HLS `200` y `#EXTM3U` desde `nika.playmudos.com`.
- Haikyuu T3E1 por IMDb seleccionó la ficha independiente `Karasuno Koukou vs. Shiratorizawa Gakuen Koukou` en AnimeAV1; por TMDB seleccionó `Haikyuu!! Third Season` en JKAnime. Ambos HLS fueron reproducibles.

## Referencias primarias

- [AIO Metadata](https://github.com/cedya77/aiometadata/tree/dev)
- [AIO Metadata: resolvedor de IDs](https://github.com/cedya77/aiometadata/blob/dev/addon/lib/id-resolver.ts)
- [AIO Metadata: mapa de anime](https://github.com/cedya77/aiometadata/blob/dev/addon/lib/id-mapper.js)
- [Fribb anime-lists](https://github.com/Fribb/anime-lists)
- [AnimeAPI](https://github.com/nattadasu/animeApi/tree/v3)
- [AniList API](https://docs.anilist.co/)
- [PeliApi](https://github.com/FxxMorgan/PeliApi)
- [WebStreamr](https://github.com/webstreamr/webstreamr)
- [Stremio Public Domain Movies](https://github.com/Stremio/stremio-public-domain)
