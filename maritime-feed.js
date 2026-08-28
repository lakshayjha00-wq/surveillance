/**
 * Live maritime AIS feed — AISStream WebSocket (server-side) + simulated fallback.
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const STALE_MS = 20 * 60 * 1000;
const MAX_VESSELS = 12000;
const KNOTS_TO_MS = 0.514444;

const MILITARY_NAME_RE =
  /\b(USS|USNS|HMS|HNoMS|HMAS|INS|ROKS|FS|TCG|CGC|RFS|HNLMS|ARA|BAP|KD|PKR|LÉ|ITS)\b|WARSHIP|PATROL\s*CRAFT|COAST\s*GUARD/i;

const MILITARY_TYPE_CODES = new Set([35, 55, 58]);

let shippingRoutes = [];
try {
  shippingRoutes = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'shipping-lanes.json'), 'utf8')
  ).routes;
} catch {
  shippingRoutes = [];
}

function knotsToMs(kn) {
  const n = Number(kn);
  return Number.isNaN(n) ? 0 : n * KNOTS_TO_MS;
}

function classifyMilitary(meta, staticData) {
  const name = (meta?.ShipName || meta?.shipName || staticData?.name || '').trim();
  if (MILITARY_NAME_RE.test(name)) return true;
  const type = staticData?.shipType ?? staticData?.Type;
  if (type != null && MILITARY_TYPE_CODES.has(Number(type))) return true;
  return false;
}

function upsertVessel(map, vessel) {
  if (vessel.lat == null || vessel.lon == null) return;
  map.set(vessel.id, vessel);
  if (map.size > MAX_VESSELS) {
    const oldest = [...map.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) map.delete(oldest[0]);
  }
}

function parseAisMessage(raw, log) {
  if (!raw || raw.error) return null;

  const meta = raw.MetaData || {};
  const mmsi = String(meta.MMSI || meta.mmsi || raw.MetaData?.MMSI || '');
  if (!mmsi) return null;

  const type = raw.MessageType;
  const msg = raw.Message?.[type] || raw.Message || {};
  const now = Date.now();

  if (type === 'PositionReport' || type === 'StandardClassBPositionReport' || type === 'ExtendedClassBPositionReport') {
    const lat = meta.latitude ?? msg.Latitude ?? msg.latitude;
    const lon = meta.longitude ?? msg.Longitude ?? msg.longitude;
    if (lat == null || lon == null) return null;

    const sog = msg.Sog ?? msg.sog ?? 0;
    const cog = msg.Cog ?? msg.cog ?? msg.TrueHeading ?? 0;

    return {
      kind: 'position',
      vessel: {
        id: `ais-${mmsi}`,
        mmsi,
        name: (meta.ShipName || meta.shipName || `MMSI ${mmsi}`).trim(),
        lat: Number(lat),
        lon: Number(lon),
        cog: Number(cog) || 0,
        sog: Number(sog) || 0,
        velocity: knotsToMs(sog),
        heading: Number(msg.TrueHeading ?? cog) || 0,
        updatedAt: now,
        source: 'aisstream',
      },
    };
  }

  if (type === 'ShipStaticData' || type === 'StaticDataReport') {
    const name = (msg.Name || msg.name || meta.ShipName || '').replace(/@/g, '').trim();
    return {
      kind: 'static',
      mmsi,
      static: {
        name,
        shipType: msg.Type ?? msg.type,
        callsign: msg.CallSign ?? msg.callsign,
        destination: msg.Destination ?? msg.destination,
      },
    };
  }

  return null;
}

function createSimulatedFleet(routes, count = 280) {
  const vessels = [];
  if (!routes.length) return vessels;

  for (let i = 0; i < count; i++) {
    const route = routes[i % routes.length];
    const coords = route.coordinates;
    const t = Math.random();
    const seg = Math.floor(t * (coords.length - 1));
    const frac = t * (coords.length - 1) - seg;
    const a = coords[seg];
    const b = coords[Math.min(seg + 1, coords.length - 1)];
    const lat = a[0] + (b[0] - a[0]) * frac + (Math.random() - 0.5) * 0.15;
    const lon = a[1] + (b[1] - a[1]) * frac + (Math.random() - 0.5) * 0.15;
    const cog = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const isMilitary = Math.random() < 0.06;
    const sog = isMilitary ? 18 + Math.random() * 12 : 8 + Math.random() * 14;

    vessels.push({
      id: `sim-${route.id}-${i}`,
      mmsi: String(200000000 + i),
      name: isMilitary
        ? `PATROL-${String.fromCharCode(65 + (i % 26))}${100 + i}`
        : `MV ${route.name.split(' ')[0].toUpperCase()} ${1000 + i}`,
      lat,
      lon,
      cog,
      sog,
      velocity: knotsToMs(sog),
      heading: cog,
      isMilitary,
      shipType: isMilitary ? 35 : 70,
      routeId: route.id,
      updatedAt: Date.now(),
      source: 'simulated',
    });
  }
  return vessels;
}

function createMaritimeFeed({ log = console.log }) {
  const vessels = new Map();
  const staticByMmsi = new Map();

  let state = {
    vessels: [],
    civilian: 0,
    military: 0,
    timestamp: 0,
    mode: 'initializing',
    connected: false,
    lastError: null,
  };

  let ws = null;
  let reconnectTimer = null;
  let simTimer = null;
  let pruneTimer = null;
  const apiKey = process.env.AISSTREAM_API_KEY || '';

  function rebuildState() {
    const now = Date.now();
    for (const [id, v] of vessels) {
      if (now - v.updatedAt > STALE_MS) vessels.delete(id);
    }

    const list = [];
    let civ = 0;
    let mil = 0;
    for (const v of vessels.values()) {
      const st = staticByMmsi.get(v.mmsi) || {};
      const isMilitary = v.isMilitary ?? classifyMilitary({ ShipName: v.name }, st);
      const row = {
        ...v,
        callsign: st.callsign || v.callsign,
        destination: st.destination || v.destination,
        shipType: st.shipType ?? v.shipType,
        isMilitary,
      };
      if (isMilitary) mil++;
      else civ++;
      list.push(row);
    }

    state = {
      vessels: list,
      civilian: civ,
      military: mil,
      timestamp: now,
      mode: state.mode,
      connected: state.connected,
      lastError: state.lastError,
    };
    return state;
  }

  function ingestParsed(parsed) {
    if (!parsed) return;
    if (parsed.kind === 'static') {
      staticByMmsi.set(parsed.mmsi, { ...staticByMmsi.get(parsed.mmsi), ...parsed.static });
      const existing = vessels.get(`ais-${parsed.mmsi}`);
      if (existing && parsed.static.name) existing.name = parsed.static.name;
      return;
    }
    if (parsed.kind === 'position') {
      const st = staticByMmsi.get(parsed.vessel.mmsi) || {};
      parsed.vessel.isMilitary = classifyMilitary(
        { ShipName: parsed.vessel.name },
        st
      );
      if (st.name) parsed.vessel.name = st.name;
      upsertVessel(vessels, parsed.vessel);
    }
  }

  function connectAisStream() {
    state.mode = 'aisstream';

    const openSocket = () => {
      if (ws) {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
      }

      ws = new WebSocket(AIS_WS_URL);

      ws.on('open', () => {
        state.connected = true;
        state.lastError = null;
        log('AISStream WebSocket connected', 'MARITIME');
        const sub = {
          APIKey: apiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: [
            'PositionReport',
            'StandardClassBPositionReport',
            'ExtendedClassBPositionReport',
            'ShipStaticData',
          ],
        };
        ws.send(JSON.stringify(sub));
      });

      ws.on('message', (buf) => {
        try {
          const raw = JSON.parse(buf.toString());
          ingestParsed(parseAisMessage(raw, log));
        } catch {
          /* skip malformed */
        }
      });

      ws.on('close', () => {
        state.connected = false;
        log('AISStream disconnected — reconnecting in 8s', 'MARITIME');
        reconnectTimer = setTimeout(openSocket, 8000);
      });

      ws.on('error', (err) => {
        state.lastError = err.message;
        log(`AISStream error: ${err.message}`, 'MARITIME');
      });
    };

    openSocket();
  }

  function startSimulation() {
    state.mode = 'simulated';
    state.connected = true;
    log('AISSTREAM_API_KEY not set — running simulated maritime traffic on shipping lanes', 'MARITIME');

    const seed = createSimulatedFleet(shippingRoutes, 320);
    seed.forEach((v) => vessels.set(v.id, v));
    rebuildState();

    simTimer = setInterval(() => {
      for (const v of vessels.values()) {
        const route = shippingRoutes.find((r) => r.id === v.routeId) || shippingRoutes[0];
        if (!route) continue;
        const rad = CesiumSafeCog(v.cog);
        const distNm = (v.sog || 10) / 360;
        v.lat += (distNm / 60) * Math.cos(rad) + (Math.random() - 0.5) * 0.002;
        v.lon += ((distNm / 60) * Math.sin(rad)) / Math.cos((v.lat * Math.PI) / 180);
        v.updatedAt = Date.now();
        if (Math.random() < 0.01) v.cog = (v.cog + (Math.random() - 0.5) * 20 + 360) % 360;
      }
      rebuildState();
    }, 4000);
  }

  function CesiumSafeCog(deg) {
    return (Number(deg) * Math.PI) / 180;
  }

  function start() {
    if (apiKey) connectAisStream();
    else startSimulation();
    pruneTimer = setInterval(() => rebuildState(), 30000);
    setInterval(() => rebuildState(), 2000);
  }

  function stop() {
    clearTimeout(reconnectTimer);
    clearInterval(simTimer);
    clearInterval(pruneTimer);
    if (ws) ws.terminate();
  }

  function getState() {
    return rebuildState();
  }

  function getShippingRoutes() {
    return shippingRoutes;
  }

  start();

  return { getState, getShippingRoutes, stop };
}

module.exports = { createMaritimeFeed, getShippingRoutes: () => shippingRoutes };
