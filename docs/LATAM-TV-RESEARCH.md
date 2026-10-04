# TV deportiva: fuentes e integración

Fecha de comprobación: 2026-10-04. AMOKIN 2.4.0 sustituye el catálogo anterior
por exactamente cinco canales. El nombre histórico del módulo y los IDs
`latam-tv` se conservan para compatibilidad, pero no se consulta la fuente anterior.

## Canales seleccionados

| Canal | Página | ID estable |
|---|---|---|
| DSport | https://futbollibrefullhd.org/en-vivo/directv-sports-online | `latam-tv:directvsports` |
| DSport+ | https://futbollibrefullhd.org/en-vivo/directv-sports-plus-online | `latam-tv:directvsportsplus` |
| ESPN | https://futbollibrefullhd.org/en-vivo/espn-1 | `latam-tv:espn` |
| ESPN2 | https://futbollibrefullhd.org/en-vivo/espn-2 | `latam-tv:espn2` |
| ESPN3 | https://futbollibrefullhd.org/en-vivo/espn-3 | `latam-tv:espn3` |

El catálogo es fijo: no incorpora otros enlaces del sitio. Todos los canales
pertenecen al género estándar `Deportes` y disponen de posters alojados por AMOKIN.
Los antiguos canales y sus posters fueron retirados.

## Flujo observado

1. Cada página seleccionada anuncia un iframe de
   `https://tvf90.com/online/canal.php?stream=...`.
2. Ese iframe incluye una ruta relativa `/5.php?stream=...`.
3. El reproductor declara `playbackURL`, una playlist HLS `mono.m3u8`
   bajo un subdominio de `ftlly.com`, con token temporal.
4. La playlist contiene segmentos MPEG-TS con rutas relativas y tokens.

La resolución ocurre al solicitar un stream. No se guardan enlaces firmados
en el catálogo ni en el repositorio. Los headers incluyen el Referer del
reproductor, su Origin y el User-Agent configurado. En la comprobación no se
observó una playlist maestra que declare varias resoluciones.

## Integración

- `client.ts` define los cinco canales, valida su identidad y sigue únicamente
  iframes de hosts permitidos, con límites de profundidad y cantidad.
- `SPORTS_TV_BASE_URL` configura el origen de las páginas.
- `SPORTS_TV_PLAYER_HOST_SUFFIXES` permite `tvf90.com,ftlly.com` por defecto.
- `src/app.ts` ofrece catálogo, metadata, stream, posters y el proxy HLS.
- El proxy reescribe playlists y segmentos con URLs opacas temporales, mantiene
  los headers y transmite el contenido sin persistir video en disco.
- El manifest utiliza revalidación de caché y la respuesta de streams usa
  `no-store` para evitar reutilizar enlaces temporales.
- El addon aislado sigue disponible con `npm run dev:latam-tv`, puerto 7101.
  Este banco de pruebas devuelve headers de reproducción; la validación
  integrada comprueba el proxy del addon principal.

## Verificación

`npm run validate:latam-tv` comprueba exactamente cinco entradas, posters,
metadatos, playlists y un segmento real por canal a través del addon principal.
Usa solicitudes internas, sin abrir puertos ni dejar servidores encendidos.
Los reportes no imprimen tokens.

Las pruebas unitarias cubren el catálogo fijo, retirada de IDs antiguos,
iframes relativos, bloqueo de hosts externos y endpoints del addon principal.

## Limitaciones

La fuente externa puede cambiar HTML, dominios, disponibilidad o calidad.
Durante las pruebas un segmento de ESPN devolvió 404; una comprobación posterior
de los cuatro segmentos de su playlist devolvió 200. Una prueba satisfactoria
no garantiza disponibilidad continua ni reproducción en todos los dispositivos.
Si la fuente deja de anunciar un stream válido, no se sustituye por otro canal.
