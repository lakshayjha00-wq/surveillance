/**
 * OpenStreetMap & OSM-derived raster tile sources (proxied via /api/tiles).
 * All require proper attribution — surfaced in Cesium credits.
 */

const UA = 'GODSEYE/1.0 (surveillance globe; +https://openstreetmap.org)';

/** @type {Record<string, { url: string, credit: string, maxZoom?: number }>} */
const OSM_TILE_LAYERS = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  'carto-voyager': {
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap © CARTO',
    maxZoom: 20,
  },
  'carto-dark': {
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap © CARTO',
    maxZoom: 20,
  },
  'carto-light': {
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap © CARTO',
    maxZoom: 20,
  },
  opentopomap: {
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap © OpenTopoMap',
    maxZoom: 17,
  },
  'osm-hot': {
    url: 'https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap © HOT',
    maxZoom: 19,
  },
  'osm-transport': {
    url: 'https://tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap France',
    maxZoom: 19,
  },
  'esri-satellite': {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  'sentinel2': {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    credit: '© EOX IT Services / Sentinel-2 Cloudless',
    maxZoom: 14,
  },
};

function resolveOsmLayer(lyrs) {
  if (OSM_TILE_LAYERS[lyrs]) return OSM_TILE_LAYERS[lyrs];
  if (lyrs === 'streets' || lyrs === 'm') return OSM_TILE_LAYERS.osm;
  if (lyrs === 'dark') return OSM_TILE_LAYERS['carto-dark'];
  if (lyrs === 'terrain') return OSM_TILE_LAYERS.opentopomap;
  if (lyrs === 'opensatellite') return OSM_TILE_LAYERS['esri-satellite'];
  return null;
}

function buildTileUrl(layerKey, z, x, y) {
  const layer = resolveOsmLayer(layerKey) || OSM_TILE_LAYERS.osm;
  return layer.url
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y);
}

module.exports = { OSM_TILE_LAYERS, resolveOsmLayer, buildTileUrl, UA };
