try {
  process.loadEnvFile();
} catch (err) {
  // If no .env file, ignore
}

const http = require('http');
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const WebSocket = require('ws'); // ═══ ADDED: Native WebSocket Library ═══

const { createFlightFeed } = require('./flights-feed');
const { createMaritimeFeed } = require('./maritime-feed');

// ═══ IMPORT THE NEW TRACKING ENGINE MODULE ═══
const { initIntelSchema, evaluateEntityCrossCorrelation } = require('./tacticalgraphengine');
const firmsService = require('./firms-service');

// ═══ IMPORT CRISIS ZONE ANALYZER & WEBSOCKET RELAY ═══
const { CrisisZoneAnalyzer } = require('./crisis-zone-analyzer');
const { getCrisisZones } = require('./lib/crisis-zones');
const { haversineKm } = require('./lib/haversine');
const { WsThreatRelay } = require('./ws-threat-relay');
const { getCesiumIonToken } = require('./lib/cesium-config');
const { resolveOsmLayer, buildTileUrl, UA } = require('./lib/osm-tiles');

const log = (msg, category = 'SYSTEM') => console.log(`[${category}] ${msg}`);

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, timeout: timeout });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError' || error.message.includes('timeout')) throw new Error('Request timed out after ' + timeout + 'ms');
    throw error;
  }
}

const app = express();
const satDb = require('./satellite-db');

// ═══ HTTP SERVER (shared with WebSocket) ═══
const httpServer = http.createServer(app);
const wsRelay = new WsThreatRelay(httpServer);

// Initialize Databases sequentially to avoid race conditions on the main process
satDb.initDB().then(async () => {
  await satDb.fetchAndIngestCelesTrak();

  // Initialize the Entity Tracking schema inside the shared DB instance
  log('Initializing Intelligence Tracking Matrix Schema...', 'INTEL');
  await initIntelSchema();

  // Initialize and start NASA FIRMS Active Fire Background Service
  log('Initializing NASA FIRMS Active Fire Surveillance Background Service...', 'FIRMS');
  firmsService.start();

  // Kickstart background automated tracking evaluation loops (every 60 seconds)
  setInterval(async () => {
    await evaluateEntityCrossCorrelation();
  }, 60000);

  // Run an immediate initial analysis block on boot
  await evaluateEntityCrossCorrelation();

  // ═══ CRISIS ZONE ANALYZER + WEBSOCKET RELAY ═══
  log('Initializing WebSocket Threat Relay...', 'WS');
  log('Initializing Crisis Zone Threat Analyzer...', 'CRISIS');
  const crisisAnalyzer = new CrisisZoneAnalyzer({
    broadcastFn: (payload) => wsRelay.broadcast(payload),
    getFlights: () => flightFeed.getState().flights,
    intervalMs: 45_000,
  });
  await crisisAnalyzer.start();
});

const PORT = 3001;

app.use(express.static(path.join(__dirname, 'public')));

// ═══ NEW API ENDPOINTS FOR YOUR INTELLIGENCE SIDEBAR ═══
app.get('/api/tactical-alerts', async (req, res) => {
  try {
    // Return all alerts compiled by the background calculation loop
    satDb.db.all("SELECT * FROM tactical_alerts ORDER BY timestamp DESC LIMIT 50", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ alerts: rows, timestamp: Date.now() });
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extract system alerts' });
  }
});

function assignThermalToCrisisZones(events) {
  const zones = getCrisisZones();
  return events.map((ev) => {
    const lat = Number(ev.latitude);
    const lon = Number(ev.longitude);
    let match = null;
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      for (const zone of zones) {
        const dist = haversineKm(lat, lon, zone.center.lat, zone.center.lon);
        if (dist <= zone.radius_km) {
          match = { zone, distance_km: Math.round(dist * 10) / 10 };
          break;
        }
      }
    }
    return {
      ...ev,
      brightness: Number(ev.brightness),
      in_crisis_zone: !!match,
      crisis_zone_id: match?.zone.id ?? null,
      crisis_zone_name: match?.zone.name ?? null,
      distance_to_zone_center_km: match?.distance_km ?? null,
    };
  });
}

// NASA FIRMS Active Fire Thermal Events endpoint (enriched with crisis zone correlation)
app.get('/api/thermal-events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const raw = await firmsService.getThermalEvents(limit);
    const events = assignThermalToCrisisZones(raw);
    const zones = getCrisisZones();
    const byZone = zones.map((z) => ({
      zone_id: z.id,
      zone_name: z.name,
      thermal_count: events.filter((e) => e.crisis_zone_id === z.id).length,
    }));
    res.json({
      success: true,
      count: events.length,
      events,
      zones,
      by_zone: byZone,
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to extract thermal events', message: err.message });
  }
});

// Client-safe map credentials (never log keys)
app.get('/api/maps-config', (req, res) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  const cesiumIonToken = getCesiumIonToken();
  res.json({
    googleMapsApiKey,
    cesiumIonToken,
    hasPhotorealistic3D: true,
    hasIonTerrain: Boolean(cesiumIonToken),
    googleSatelliteIonAssetId: 3830184,
    timestamp: Date.now(),
  });
});

// Geocoding proxy
app.get('/api/geocode', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query required' });
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8&addressdetails=1`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Earth3DGlobe/1.0' } });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// Reverse geocoding proxy
app.get('/api/reverse-geocode', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Earth3DGlobe/1.0' } });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Reverse geocode error:', err);
    res.status(500).json({ error: 'Reverse geocoding failed' });
  }
});

// OpenStreetMap & OSM-derived tile proxy (default for GODSEYE)
app.get('/api/tiles/:z/:x/:y', async (req, res) => {
  const { z, x, y } = req.params;
  const lyrs = req.query.lyrs || 'osm';
  const yClean = y.replace('.png', '');

  const osmLayer = resolveOsmLayer(lyrs);
  let tileUrl;
  const headers = { 'User-Agent': UA };

  if (osmLayer) {
    tileUrl = buildTileUrl(lyrs, z, x, yClean);
  } else {
    tileUrl = `https://mt1.google.com/vt/lyrs=${lyrs}&x=${x}&y=${yClean}&z=${z}`;
    headers.Referer = 'https://www.google.com/';
  }

  try {
    const resp = await fetch(tileUrl, { headers });
    if (!resp.ok) throw new Error(`Tile fetch failed: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', resp.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Tile proxy error:', err.message);
    const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.set('Content-Type', 'image/png');
    res.send(emptyPng);
  }
});

// OpenStreetMap Overpass API proxy (road geometry for live traffic layer)
app.get('/api/overpass', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query parameter q required' });

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    let lastErr = null;
    for (const base of endpoints) {
      try {
        const url = `${base}?data=${encodeURIComponent(query)}`;
        const response = await fetchWithTimeout(
          url,
          { headers: { 'User-Agent': UA, Accept: 'application/json' } },
          8000
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return res.json(data);
      } catch (err) {
        lastErr = err;
      }
    }

    res.status(502).json({ error: 'Overpass unavailable', message: lastErr?.message });
  } catch (err) {
    res.status(500).json({ error: 'Overpass proxy failed', message: err.message });
  }
});

const flightFeed = createFlightFeed({ fetchWithTimeout, fetch, log });
const maritimeFeed = createMaritimeFeed({ log });

app.get('/api/vessels', (req, res) => {
  const state = maritimeFeed.getState();
  res.set('Cache-Control', 'no-store');
  res.json({
    timestamp: state.timestamp || Date.now(),
    count: state.vessels.length,
    civilian: state.civilian,
    military: state.military,
    mode: state.mode,
    connected: state.connected,
    error: state.lastError,
    vessels: state.vessels,
  });
});

app.get('/api/shipping-routes', (req, res) => {
  res.json({
    routes: maritimeFeed.getShippingRoutes(),
    count: maritimeFeed.getShippingRoutes().length,
    timestamp: Date.now(),
  });
});

// We keep the REST endpoint as a fallback, but WebSockets will take over primary duty
app.get('/api/flights', async (req, res) => {
  const source = req.query.source || 'auto';
  const state = flightFeed.getState();
  if (source !== state.source && !state.refreshing) {
    flightFeed.refresh(source);
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    timestamp: state.timestamp || Date.now(),
    count: state.flights.length,
    civilian: state.civilian,
    military: state.military,
    refreshMs: 1500,
    sources: { civilian: source, military: 'adsb.lol' },
    error: state.lastError,
    flights: state.flights
  });
});

app.get('/api/airspace', (req, res) => {
  // Array of airspace zones kept exactly as you had them...
  const zones = [
    { id: 'FIR-DEL', name: 'Delhi FIR (VIDF)', type: 'FIR', color: '#00FF41', polygon: [[32.04, 73.58], [32.70, 73.72], [33.50, 74.08], [34.00, 74.60], [34.50, 75.35], [35.20, 77.00], [35.50, 77.50], [35.68, 77.80], [35.00, 78.00], [34.00, 78.50], [33.00, 78.80], [32.75, 78.75], [32.20, 79.30], [31.40, 79.95], [30.70, 80.50], [30.10, 81.00], [29.40, 80.20], [28.80, 80.60], [28.40, 81.30], [27.60, 83.30], [27.40, 83.90], [27.00, 84.40], [26.50, 84.40], [24.50, 84.00], [22.50, 82.50], [22.00, 78.00], [23.00, 75.50], [24.50, 73.00], [24.00, 71.00], [25.20, 71.80], [26.90, 70.50], [27.60, 70.70], [28.40, 70.30], [28.90, 69.60], [29.40, 70.80], [30.00, 71.20], [30.50, 72.00], [31.00, 73.00], [31.50, 73.80], [32.04, 73.58]] },
    { id: 'FIR-MUM', name: 'Mumbai FIR (VABF)', type: 'FIR', color: '#00D4FF', polygon: [[24.50, 73.00], [23.00, 75.50], [22.00, 78.00], [20.50, 78.00], [18.50, 78.00], [16.50, 78.00], [15.00, 77.50], [13.50, 77.50], [12.80, 74.80], [14.50, 74.00], [15.40, 73.80], [16.00, 73.40], [17.80, 73.00], [19.00, 72.80], [20.50, 72.70], [21.10, 72.60], [22.30, 69.10], [23.50, 68.40], [23.70, 68.10], [24.00, 71.00], [24.50, 73.00]] },
    { id: 'FIR-CHN', name: 'Chennai FIR (VOMF)', type: 'FIR', color: '#FFB300', polygon: [[13.50, 77.50], [15.00, 77.50], [16.50, 78.00], [18.50, 78.00], [20.50, 78.00], [22.00, 78.00], [22.50, 82.50], [21.50, 83.50], [20.50, 84.50], [19.80, 85.00], [17.80, 83.50], [15.50, 80.20], [14.00, 80.20], [13.00, 80.30], [11.80, 79.80], [10.50, 79.80], [8.10, 77.50], [8.30, 76.90], [8.50, 76.95], [9.50, 76.30], [10.50, 76.10], [11.50, 75.70], [12.50, 74.90], [12.80, 74.80], [13.50, 77.50]] },
    { id: 'FIR-KOL', name: 'Kolkata FIR (VECF)', type: 'FIR', color: '#CC44FF', polygon: [[27.00, 84.40], [27.40, 84.60], [27.60, 85.30], [27.50, 86.60], [27.30, 87.20], [27.00, 88.00], [26.80, 88.20], [27.00, 89.00], [26.70, 89.80], [26.50, 90.30], [27.10, 91.40], [27.50, 91.70], [27.80, 92.10], [28.50, 96.40], [28.05, 97.00], [27.65, 97.35], [27.10, 96.50], [26.50, 96.10], [25.80, 95.50], [25.30, 94.90], [24.70, 94.30], [24.20, 93.90], [23.40, 93.40], [22.80, 93.20], [22.00, 92.80], [21.30, 92.60], [21.50, 92.30], [22.00, 92.05], [22.50, 91.80], [23.00, 91.60], [23.50, 91.40], [24.00, 91.20], [24.50, 92.00], [25.00, 92.40], [25.50, 92.20], [26.00, 91.80], [26.30, 91.60], [26.50, 90.50], [26.80, 89.80], [27.00, 89.00], [27.50, 88.40], [27.80, 88.10], [28.00, 88.20], [28.30, 88.60], [27.85, 88.75], [25.80, 90.50], [25.50, 89.80], [25.20, 89.30], [24.80, 88.80], [24.30, 88.50], [24.00, 88.70], [23.50, 88.70], [22.50, 88.50], [22.00, 88.80], [21.60, 88.50], [21.50, 87.50], [20.50, 86.50], [20.50, 84.50], [21.50, 83.50], [22.50, 82.50], [24.50, 84.00], [26.50, 84.40], [27.00, 84.40]] },
    { id: 'LOC', name: 'Line of Control (LOC)', type: 'LOC', color: '#FF2222', polyline: [[32.040, 73.580], [32.13, 73.60], [32.30, 73.64], [32.50, 73.68], [32.70, 73.72], [32.85, 73.78], [33.00, 73.82], [33.10, 73.88], [33.20, 73.92], [33.35, 73.98], [33.50, 74.08], [33.65, 74.20], [33.78, 74.35], [33.90, 74.50], [34.00, 74.60], [34.10, 74.72], [34.20, 74.85], [34.30, 74.98], [34.40, 75.15], [34.50, 75.35], [34.58, 75.50], [34.65, 75.68], [34.72, 75.85], [34.80, 76.03], [34.88, 76.20], [34.95, 76.40], [35.00, 76.55], [35.08, 76.72], [35.15, 76.88], [35.20, 77.00], [35.28, 77.10], [35.33, 77.18], [35.38, 77.25], [35.40, 77.30], [35.50, 77.50], [35.60, 77.70], [35.68, 77.80]] },
    { id: 'LAC-W', name: 'LAC — Western Sector (Ladakh)', type: 'LAC', color: '#FF8800', polyline: [[32.75, 78.75], [33.00, 78.80], [33.30, 78.70], [33.60, 78.60], [33.80, 78.55], [34.00, 78.50], [34.20, 78.40], [34.40, 78.30], [34.55, 78.20], [34.70, 78.10], [34.85, 78.05], [35.00, 78.00], [35.10, 77.95], [35.20, 77.90], [35.30, 77.85], [35.40, 77.80], [35.50, 77.75], [35.53, 77.60], [35.55, 77.50], [35.58, 77.40], [35.60, 77.30], [35.65, 77.20], [35.68, 77.10], [35.70, 77.00], [35.72, 76.90], [35.78, 76.80], [35.80, 76.70], [35.83, 76.60], [35.85, 76.50]] },
    { id: 'LAC-M', name: 'LAC — Middle Sector (Uttarakhand)', type: 'LAC', color: '#987539ff', polyline: [[32.75, 78.75], [32.50, 79.00], [32.20, 79.30], [31.90, 79.60], [31.60, 79.80], [31.40, 79.95], [31.20, 80.10], [31.05, 80.20], [30.90, 80.30], [30.70, 80.50], [30.50, 80.65], [30.40, 80.75], [30.30, 80.80], [30.20, 80.90], [30.10, 81.00]] },
    { id: 'LAC-E', name: 'LAC — Eastern Sector (Arunachal)', type: 'LAC', color: '#FF8800', polyline: [[27.85, 88.75], [27.90, 89.00], [27.95, 89.30], [28.00, 89.60], [28.10, 89.85], [28.20, 90.10], [28.30, 90.40], [28.35, 90.70], [28.40, 91.00], [28.50, 91.30], [28.55, 91.60], [28.60, 91.90], [28.70, 92.20], [28.75, 92.50], [28.80, 92.80], [28.85, 93.10], [28.90, 93.40], [28.95, 93.70], [29.00, 94.00], [29.05, 94.30], [29.10, 94.60], [29.05, 94.90], [28.95, 95.20], [28.85, 95.50], [28.75, 95.80], [28.60, 96.10], [28.50, 96.40], [28.35, 96.60], [28.20, 96.80], [28.05, 97.00], [27.85, 97.20], [27.65, 97.35]] },
    { id: 'IB', name: 'International Border', type: 'INTL_BORDER', color: 'rgba(0,255,65,0.4)', polyline: [[23.70, 68.10], [24.00, 68.80], [24.30, 70.10], [24.60, 71.00], [25.20, 71.80], [26.00, 70.20], [26.90, 70.50], [27.60, 70.70], [28.40, 70.30], [28.90, 69.60], [29.40, 70.80], [30.00, 71.20], [30.50, 72.00], [31.00, 73.00], [31.50, 73.80], [32.00, 73.58]] },
    { id: 'IB-E', name: 'International Border (East)', type: 'INTL_BORDER', color: 'rgba(0,255,65,0.4)', polyline: [[21.15, 92.60], [21.50, 92.30], [22.00, 92.05], [22.50, 91.80], [23.00, 91.60], [23.40, 91.40], [24.00, 91.20], [24.50, 92.00], [25.00, 92.40], [25.50, 92.20], [26.00, 91.80], [26.30, 91.60], [26.50, 90.50], [26.80, 89.80], [27.00, 89.00], [27.50, 88.40], [27.80, 88.10], [28.00, 88.20], [28.30, 88.60], [27.85, 88.75]] },
    { id: 'P-1', name: 'P1 — Rashtrapati Bhavan Complex', type: 'PROHIBITED', color: '#FF0000', polygon: [[28.6195, 77.1920], [28.6195, 77.2040], [28.6170, 77.2045], [28.6120, 77.2040], [28.6080, 77.2000], [28.6080, 77.1930], [28.6120, 77.1915], [28.6160, 77.1910]] },
    { id: 'P-2', name: 'P2 — Parliament House Complex', type: 'PROHIBITED', color: '#FF0000', polygon: [[28.6205, 77.2050], [28.6205, 77.2110], [28.6170, 77.2130], [28.6145, 77.2120], [28.6145, 77.2050], [28.6170, 77.2040]] },
    { id: 'P-3', name: 'P3 — Kartavya Path (Rajpath) NFZ', type: 'PROHIBITED', color: '#FF0000', polygon: [[28.6175, 77.2095], [28.6155, 77.2095], [28.6130, 77.2200], [28.6145, 77.2200], [28.6130, 77.2320], [28.6155, 77.2320], [28.6170, 77.2360], [28.6120, 77.2360], [28.6100, 77.2310], [28.6100, 77.2260], [28.6115, 77.2190], [28.6198, 77.2100]] },
    { id: 'P-4', name: 'P4 — PMO / 7 Lok Kalyan Marg Zone', type: 'PROHIBITED', color: '#FF0000', polygon: [[28.6060, 77.1960], [28.6060, 77.2050], [28.6010, 77.2050], [28.5990, 77.2020], [28.5990, 77.1970], [28.6010, 77.1940], [28.6040, 77.1940]] },
    { id: 'R-1', name: 'R1 — Delhi Cantonment', type: 'RESTRICTED', color: '#FF4400', polygon: [[28.6050, 77.1300], [28.6050, 77.1600], [28.5950, 77.1650], [28.5850, 77.1600], [28.5750, 77.1480], [28.5650, 77.1350], [28.5700, 77.1250], [28.5850, 77.1200], [28.5950, 77.1250]] },
    { id: 'R-HINDON', name: 'Hindon AFB Restricted Zone', type: 'RESTRICTED', color: '#FF4400', polygon: [[28.7230, 77.3400], [28.7230, 77.3750], [28.6960, 77.3750], [28.6960, 77.3400]] },
    { id: 'R-IGI', name: 'IGI Airport (VIDP) Restricted', type: 'RESTRICTED', color: '#FF4400', polygon: [[28.5750, 77.0800], [28.5750, 77.1150], [28.5450, 77.1150], [28.5350, 77.0950], [28.5400, 77.0800]] },
    { id: 'R-2', name: 'R2 — Pokhran Test Range', type: 'RESTRICTED', color: '#FF4400', center: [26.73, 71.35], radius_km: 40 },
    { id: 'R-3', name: 'R3 — Chandipur ITR', type: 'RESTRICTED', color: '#FF4400', center: [21.45, 87.02], radius_km: 30 },
    { id: 'R-4', name: 'R4 — SHAR Sriharikota', type: 'RESTRICTED', color: '#FF4400', center: [13.72, 80.23], radius_km: 20 },
    { id: 'R-5', name: 'R5 — Thumba TERLS', type: 'RESTRICTED', color: '#FF4400', center: [8.53, 76.87], radius_km: 10 },
    { id: 'R-6', name: 'R6 — Abdul Kalam Island', type: 'RESTRICTED', color: '#FF4400', center: [20.75, 87.10], radius_km: 25 },
    { id: 'R-7', name: 'R7 — Balasore Test Range', type: 'RESTRICTED', color: '#FF4400', center: [21.49, 86.93], radius_km: 15 },
    { id: 'R-8', name: 'R8 — Babina Military Range', type: 'RESTRICTED', color: '#FF4400', center: [25.24, 78.43], radius_km: 12 },
    { id: 'D-1', name: 'D1 — Jaisalmer Field Firing Range', type: 'DANGER', color: '#FFAA00', center: [27.0, 70.5], radius_km: 50 },
    { id: 'D-2', name: 'D2 — Suratgarh Range', type: 'DANGER', color: '#FFAA00', center: [29.33, 73.9], radius_km: 20 },
    { id: 'D-3', name: 'D3 — Mahajan Field Firing Range', type: 'DANGER', color: '#FFAA00', center: [27.88, 71.25], radius_km: 30 },
    { id: 'SIACHEN', name: 'Siachen Glacier Zone', type: 'DISPUTED', color: '#FF44FF', polygon: [[35.68, 77.80], [35.80, 76.85], [36.20, 76.50], [36.80, 76.80], [37.00, 77.10], [36.80, 77.50], [36.20, 77.80], [35.68, 77.80]] },
  ];
  res.json({ zones, timestamp: Date.now() });
});

// ═══ CRISIS ZONES STATIC DATA ENDPOINT ═══
app.get('/api/crisis-zones', (req, res) => {
  res.json({
    zones: CrisisZoneAnalyzer.getZones(),
    count: CrisisZoneAnalyzer.getZones().length,
    timestamp: Date.now(),
  });
});

// --- SATELLITE TRACKING ---
app.get('/api/satellites', async (req, res) => {
  try {
    const sats = await satDb.getAllSatellites();
    log(`Satellite API: Serving ${sats.length} massive objects from SQLite DB`, 'SAT');
    res.json({ satellites: sats, timestamp: Date.now() });
  } catch (err) {
    log(`Satellite DB Error: ${err.message}`, 'SAT');
    res.status(500).json({ error: 'Database fetch failed', satellites: [] });
  }
});

app.get('/api/massive-tle', async (req, res) => {
  try {
    const rows = await satDb.getAllSatellites();
    const satellites = rows.map(s => ({
      norad_id: s.norad_id,
      name: s.name,
      tle1: s.tle1,
      tle2: s.tle2,
      type: s.type
    }));
    res.json({ count: satellites.length, satellites, timestamp: Date.now() });
  } catch (err) {
    console.error('Massive TLE API error:', err);
    res.status(500).json({ error: 'Failed to retrieve TLE data' });
  }
});

// ═══ NEW: HIGH-FREQUENCY FLIGHT TELEMETRY STREAM ═══
const flightWsServer = new WebSocket.Server({ noServer: true });

flightWsServer.on('connection', (ws) => {
    log('Radar client connected to High-Frequency Flight Stream', 'WS-FLIGHTS');
    ws.on('close', () => {
        log('Radar client disconnected from Flight Stream', 'WS-FLIGHTS');
    });
});

httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;

    if (pathname === '/ws/threats') {
      wsRelay.handleUpgrade(req, socket, head);
      return;
    }

    if (pathname === '/ws/flights') {
      flightWsServer.handleUpgrade(req, socket, head, (ws) => {
        flightWsServer.emit('connection', ws, req);
      });
      return;
    }

    socket.destroy();
});

// The broadcast loop runs 2 times a second (500ms). 
// It constantly pulls from your existing 'flightFeed' and pushes to the globe.
setInterval(() => {
    const state = flightFeed.getState();
    const payload = JSON.stringify({
        timestamp: state.timestamp || Date.now(),
        count: state.flights.length,
        flights: state.flights
    });

    flightWsServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}, 500); 
// ════════════════════════════════════════════════════


httpServer.listen(PORT, () => {
  console.log(`\n🌍 Earth 3D Globe running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket Threat Relay at ws://localhost:${PORT}/ws/threats`);
  console.log(`✈️  WebSocket Flight Telemetry at ws://localhost:${PORT}/ws/flights\n`);
});
// ═══ NATIVE SPATIAL THREAT ENGINE (Replaces Shapely) ═══

// 1. Spatial Math Engine (Ray-Casting)
function isPointInPolygon(lat, lon, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i][1], yi = polygon[i][0]; 
        let xj = polygon[j][1], yj = polygon[j][0];
        
        let intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// 2. Renamed to avoid conflicts!
const ACTIVE_THREAT_POLYGONS = [
    { id: 'P-1', name: 'Rashtrapati Bhavan Complex', polygon: [[28.6195, 77.1920], [28.6195, 77.2040], [28.6170, 77.2045], [28.6120, 77.2040], [28.6080, 77.2000], [28.6080, 77.1930], [28.6120, 77.1915], [28.6160, 77.1910]] },
    { id: 'P-2', name: 'Parliament House Complex', polygon: [[28.6205, 77.2050], [28.6205, 77.2110], [28.6170, 77.2130], [28.6145, 77.2120], [28.6145, 77.2050], [28.6170, 77.2040]] },
    { id: 'P-4', name: 'PMO / 7 Lok Kalyan Marg', polygon: [[28.6060, 77.1960], [28.6060, 77.2050], [28.6010, 77.2050], [28.5990, 77.2020], [28.5990, 77.1970], [28.6010, 77.1940], [28.6040, 77.1940]] },
    { id: 'R-IGI', name: 'IGI Airport Restricted', polygon: [[28.5750, 77.0800], [28.5750, 77.1150], [28.5450, 77.1150], [28.5350, 77.0950], [28.5400, 77.0800]] },
    { id: 'R-2', name: 'Pokhran Test Range', center: [26.73, 71.35], radius_km: 40 },
    // THE TEMPORARY GHOST THREAT TEST ZONE
    { id: 'TEST-1', name: 'DELHI MASSIVE TEST ZONE', center: [28.5561, 77.0999], radius_km: 100 }
];

// 3. Upgraded Broadcast Loop 
setInterval(() => {
    const state = flightFeed.getState();
    const rawFlights = state.flights;
    const activeThreats = [];

    const processedFlights = rawFlights.map(f => {
        if (f.lat == null || f.lon == null) return f;

        let isThreat = false;
        let threatZoneName = null;

        for (const zone of ACTIVE_THREAT_POLYGONS) {
            if (zone.polygon && isPointInPolygon(f.lat, f.lon, zone.polygon)) {
                isThreat = true;
                threatZoneName = zone.name;
                break;
            } else if (zone.center && zone.radius_km) {
                const dist = haversineKm(f.lat, f.lon, zone.center[0], zone.center[1]);
                if (dist <= zone.radius_km) {
                    isThreat = true;
                    threatZoneName = zone.name;
                    break;
                }
            }
        }

        if (isThreat) {
            activeThreats.push({ flight_id: f.id, zone: threatZoneName });
            return { ...f, is_threat: true, threat_zone: threatZoneName };
        }
        return f;
    });

    const telemetryPayload = JSON.stringify({
        type: 'telemetry_update', 
        timestamp: state.timestamp || Date.now(),
        count: processedFlights.length,
        data: processedFlights
    });

    flightWsServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(telemetryPayload);
            activeThreats.forEach(threat => {
                client.send(JSON.stringify({
                    type: 'threat_alert',
                    flight_id: threat.flight_id,
                    zone: threat.zone
                }));
            });
        }
    });
}, 500);