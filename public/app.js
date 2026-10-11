/* ═══════════════════════════════════════════════════════════════
   EARTH 3D GLOBE — Main Application (CesiumJS)
   ═══════════════════════════════════════════════════════════════ */

const loadingScreen = document.getElementById('loadingScreen');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

function setProgress(pct, text) {
  progressFill.style.width = pct + '%';
  progressText.textContent = text;
}

setProgress(10, 'Creating viewer...');

const googleSatelliteImagery = new Cesium.UrlTemplateImageryProvider({
  url: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/tiles/{z}/{x}/{y}.png?lyrs=s',
  credit: 'Google Satellite',
  maximumLevel: 21,
  enablePickFeatures: false,
});

// ─── Cesium Viewer ───
const viewer = new Cesium.Viewer('cesiumContainer', {
  imageryProvider: googleSatelliteImagery,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  shadows: false,
  shouldAnimate: true,
  requestRenderMode: false,
  msaaSamples: 2,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
});
window.viewer = viewer;

const imageryLayers = viewer.imageryLayers;

// Performance tweaks for globe
viewer.scene.globe.maximumScreenSpaceError = 3; 
viewer.scene.globe.tileCacheSize = 1000; 

viewer.scene.globe.show = true;
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b132b');
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.0002;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.showGroundAtmosphere = true;
viewer.scene.highDynamicRange = false;
viewer.scene.postProcessStages.fxaa.enabled = true;

let buildingsTileset = null;

async function bootGoogleEarthGlobe() {
  setProgress(30, 'Loading 3D globe...');

  if (typeof window.initGoogleEarthGlobe === 'function') {
    try {
      const initDone = window.initGoogleEarthGlobe(viewer, { setProgress });
      const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
      await Promise.race([initDone, timeout]);
      buildingsTileset = window.getBuildingsTileset?.() || null;
    } catch (err) {
      console.warn('[GLOBE] Globe 3D initialization fallback:', err.message);
    }
  } else {
    console.warn('[GLOBE] globe-3d.js not loaded — satellite layer active');
  }

  setProgress(90, 'Finalizing scene...');

  if (document.getElementById('toggleGrid')?.checked) {
    if (!viewer._gridImagery) {
      viewer._gridImagery = imageryLayers.addImageryProvider(
        new Cesium.GridImageryProvider({
          color: new Cesium.Color(1.0, 1.0, 1.0, 0.15),
          glowWidth: 0,
        })
      );
    }
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 12000000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-55),
      roll: 0,
    },
    duration: 0,
  });

  setProgress(100, 'Ready!');
  setTimeout(() => loadingScreen.classList.add('hidden'), 300);
}

bootGoogleEarthGlobe()
  .then(() => setMapStyle('photorealistic'))
  .catch((err) => {
    console.error('[GLOBE] Startup failed:', err);
    setProgress(100, 'Ready (limited 3D)');
    loadingScreen.classList.add('hidden');
  });

function setMapStyle(style) {
  const isGridEnabled = document.getElementById('toggleGrid')?.checked;

  if (typeof window.setGlobeMapStyle === 'function') {
    window.setGlobeMapStyle(viewer, style);
  } else {
    imageryLayers.removeAll();
    imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: '/api/tiles/{z}/{x}/{y}.png?lyrs=s',
        credit: 'Google Satellite',
        maximumLevel: 21,
      })
    );
  }
  
  if (isGridEnabled) {
    viewer._gridImagery = imageryLayers.addImageryProvider(new Cesium.GridImageryProvider({
      color: new Cesium.Color(1.0, 1.0, 1.0, 0.15),
      glowWidth: 0
    }));
  }
}

// ─── TACTICAL SENSOR OPTICS (WEBGL SHADERS) ───
const nightVisionFragmentShader = `
    uniform sampler2D colorTexture;
    in vec2 v_textureCoordinates;
    out vec4 fragColor;
    
    float rand(vec2 co) {
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
        vec4 color = texture(colorTexture, v_textureCoordinates);
        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float noise = (rand(v_textureCoordinates * 100.0) - 0.5) * 0.2;
        float dist = distance(v_textureCoordinates, vec2(0.5, 0.5));
        float vignette = smoothstep(0.8, 0.4, dist);
        vec3 nvColor = vec3(0.1, 0.95, 0.2) * (luminance + noise) * vignette;
        fragColor = vec4(nvColor, 1.0);
    }
`;

const flirFragmentShader = `
    uniform sampler2D colorTexture;
    in vec2 v_textureCoordinates;
    out vec4 fragColor;

    void main() {
        vec4 color = texture(colorTexture, v_textureCoordinates);
        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float thermal = 1.0 - luminance;
        vec3 flirColor = vec3(smoothstep(0.2, 0.8, thermal));
        fragColor = vec4(flirColor, 1.0);
    }
`;

const nightVisionStage = new Cesium.PostProcessStage({ fragmentShader: nightVisionFragmentShader });
const flirStage = new Cesium.PostProcessStage({ fragmentShader: flirFragmentShader });

viewer.scene.postProcessStages.add(nightVisionStage);
viewer.scene.postProcessStages.add(flirStage);

nightVisionStage.enabled = false;
flirStage.enabled = false;

window.setOpticsMode = function(mode) {
    nightVisionStage.enabled = (mode === 'NVG');
    flirStage.enabled = (mode === 'FLIR');
    viewer.scene.requestRender();
    
    const hudSceneStatus = document.getElementById('hudSceneStatus');
    if (hudSceneStatus) {
        hudSceneStatus.textContent = `OPTICS: ${mode === 'NORMAL' ? 'VISUAL' : mode}`;
        hudSceneStatus.style.color = mode === 'NVG' ? '#22c55e' : (mode === 'FLIR' ? '#cbd5e1' : '#4ade80');
    }
};

// Press 1 for Normal, 2 for Night Vision, 3 for FLIR Thermal
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; 
    if (e.key === '1') window.setOpticsMode('NORMAL');
    if (e.key === '2') window.setOpticsMode('NVG');
    if (e.key === '3') window.setOpticsMode('FLIR');
});

// ─── Search ───
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchClear = document.getElementById('searchClear');
let searchTimeout = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  searchClear.style.display = q ? 'flex' : 'none';
  if (q.length < 2) { searchResults.classList.remove('active'); return; }
  searchTimeout = setTimeout(() => doSearch(q), 350);
});

searchInput.addEventListener('focus', () => {
  if (searchResults.children.length > 0) searchResults.classList.add('active');
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  searchResults.classList.remove('active');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) searchResults.classList.remove('active');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if (e.key === 'Escape') { searchInput.blur(); searchResults.classList.remove('active'); }
});

function getPlaceIcon(type) {
  const m = { city: '🏙️', town: '🏘️', village: '🏡', country: '🌍', state: '📍', hamlet: '🏠',
    peak: '⛰️', mountain: '🏔️', lake: '🌊', river: '🌊', ocean: '🌊', island: '🏝️',
    airport: '✈️', station: '🚉', museum: '🏛️', university: '🎓', hospital: '🏥',
    church: '⛪', mosque: '🕌', temple: '🛕', castle: '🏰', stadium: '🏟️',
    park: '🌳', garden: '🌺', zoo: '🦁', beach: '🏖️', hotel: '🏨', restaurant: '🍽️',
    shop: '🛒', mall: '🛍️', school: '🏫', library: '📚', theatre: '🎭', cinema: '🎬' };
  if (!type) return '📍';
  const tl = type.toLowerCase();
  for (const [k, v] of Object.entries(m)) { if (tl.includes(k)) return v; }
  return '📍';
}

async function doSearch(query) {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    searchResults.innerHTML = '';
    if (!data.length) {
      searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
      searchResults.classList.add('active');
      return;
    }
    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      const icon = getPlaceIcon(item.type);
      div.innerHTML = `
        <div class="search-result-icon">${icon}</div>
        <div class="search-result-info">
          <div class="search-result-name">${item.display_name.split(',')[0]}</div>
          <div class="search-result-desc">${item.display_name}</div>
        </div>
        <span class="search-result-type">${item.type || 'place'}</span>`;
      div.addEventListener('click', () => flyToResult(item));
      searchResults.appendChild(div);
    });
    searchResults.classList.add('active');
  } catch (e) { console.error('Search error:', e); }
}

function flyToResult(item) {
  searchResults.classList.remove('active');
  const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
  const bb = item.boundingbox;
  let alt = 1500;
  if (bb) {
    const dLat = Math.abs(parseFloat(bb[1]) - parseFloat(bb[0]));
    const dLon = Math.abs(parseFloat(bb[3]) - parseFloat(bb[2]));
    alt = Math.max(dLat, dLon) * 111000 * 1.5;
    alt = Math.max(300, Math.min(alt, 10000000));
  }
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 2.5
  });
}

document.querySelectorAll('.style-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMapStyle(btn.dataset.style);
  });
});

document.getElementById('toggleBuildings')?.addEventListener('change', (e) => {
  const ts = buildingsTileset || window.getBuildingsTileset?.();
  const p3d = window.getGlobe3DState?.()?.photorealisticTileset;
  if (ts) ts.show = e.target.checked;
  if (p3d) p3d.show = e.target.checked;
  viewer.scene.requestRender();
});

document.getElementById('toggleTerrain')?.addEventListener('change', (e) => {
  const mode = window.getGlobe3DState?.()?.mode;
  const on = e.target.checked;
  if (mode === 'photorealistic') {
    const p3d = window.getGlobe3DState?.()?.photorealisticTileset;
    if (p3d) p3d.show = on;
  } else {
    viewer.scene.globe.show = on;
    viewer.scene.globe.terrainExaggeration = on ? 1.0 : 0.0;
  }
  viewer.scene.requestRender();
});

document.getElementById('toggleAtmosphere').addEventListener('change', (e) => {
  viewer.scene.skyAtmosphere.show = e.target.checked;
  viewer.scene.globe.showGroundAtmosphere = e.target.checked;
});

document.getElementById('toggleDayNight').addEventListener('change', (e) => {
  viewer.scene.globe.enableLighting = e.target.checked;
});

document.getElementById('toggleGrid').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (!viewer._gridImagery) {
      viewer._gridImagery = imageryLayers.addImageryProvider(new Cesium.GridImageryProvider({
        color: new Cesium.Color(1.0, 1.0, 1.0, 0.15),
        glowWidth: 0
      }));
    }
  } else if (viewer._gridImagery) {
    imageryLayers.remove(viewer._gridImagery);
    viewer._gridImagery = null;
  }
});

// ─── Restricted Airspaces ───
const airspaceDataSource = new Cesium.CustomDataSource('airspaces');
airspaceDataSource.show = false;
viewer.dataSources.add(airspaceDataSource);

async function loadStrategicAirspaces() {
  try {
    const res = await fetch('/api/airspace');
    const data = await res.json();
    
    data.zones.forEach(z => {
      const color = Cesium.Color.fromCssColorString(z.color);
      if (z.polygon) {
        const degreesArray = z.polygon.flatMap(p => [p[1], p[0]]); 
        airspaceDataSource.entities.add({
          id: z.id, name: z.name,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
            material: color.withAlpha(0.15),
            outline: true, outlineColor: color.withAlpha(0.8), outlineWidth: 2, height: 0
          },
          properties: { isAirspace: true, description: `Zone Type: ${z.type}`, country: 'India', radius: 'N/A' }
        });
      } else if (z.polyline) {
        const degreesArray = z.polyline.flatMap(p => [p[1], p[0]]); 
        airspaceDataSource.entities.add({
          id: z.id, name: z.name,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(degreesArray), width: 4,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color })
          },
          properties: { isAirspace: true, description: `Border/Line: ${z.type}`, country: 'India', radius: 'N/A' }
        });
      } else if (z.center && z.radius_km) {
        airspaceDataSource.entities.add({
          id: z.id, name: z.name,
          position: Cesium.Cartesian3.fromDegrees(z.center[1], z.center[0], 0), 
          ellipse: {
            semiMinorAxis: z.radius_km * 1000, semiMajorAxis: z.radius_km * 1000,
            material: color.withAlpha(0.2), outline: true, outlineColor: color, outlineWidth: 2, height: 0, extrudedHeight: 15000
          },
          properties: { isAirspace: true, description: `Zone Type: ${z.type}`, country: 'India', radius: z.radius_km * 1000 }
        });
      }
    });
  } catch (err) { console.error('Failed to load airspaces:', err); }
}
loadStrategicAirspaces();

const sidePanel = document.getElementById('sidePanel');
document.getElementById('panelToggle').addEventListener('click', () => {
  sidePanel.classList.toggle('collapsed');
});

const hudClock = document.getElementById('hudClock');
const hudCoordinates = document.getElementById('hudCoordinates');
const hudSensorCount = document.getElementById('hudSensorCount');
const hudSensorDetail = document.getElementById('hudSensorDetail');
const hudSceneStatus = document.getElementById('hudSceneStatus');
const hudSceneDetail = document.getElementById('hudSceneDetail');

function updateHudSensors() {
  const sensors = [
    ['toggleGrid', 'GRID'], ['toggleAtmosphere', 'ATM'], ['toggleCrisisZones', 'CRISIS'],
    ['toggleFlights', 'FLIGHT'], ['toggleMaritime', 'MARITIME'], ['toggleSatellites', 'ORBIT'],
    ['toggleTraffic', 'TRAFFIC'], ['toggleThermalMap', 'THERMAL']
  ];
  const active = sensors.filter(([id]) => document.getElementById(id)?.checked);
  hudSensorCount.textContent = `${String(active.length).padStart(2, '0')} ONLINE`;
  hudSensorDetail.textContent = active.length ? active.map(([, label]) => label).join(' / ') : 'NO SENSOR LAYERS';
}

function updateHudClock() {
  hudClock.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
}

function updateHudTrack(flight = null) {
  if (!hudSceneStatus || !hudSceneDetail) return;
  hudSceneStatus.textContent = flight ? 'TRACK ACQUIRED' : 'MONITORING';
  hudSceneDetail.textContent = flight
    ? `${flight.isMilitary ? 'MILITARY' : 'CIVILIAN'} // ${flight.callsign || flight.id || 'UNKNOWN'}`
    : 'NO ACTIVE TRACK';
  if (!flight) hudSceneStatus.style.color = '';
}

document.querySelectorAll('#sidePanel input[type="checkbox"]').forEach((input) => {
  input.addEventListener('change', updateHudSensors);
});
updateHudSensors();
updateHudClock();
updateHudTrack();
setInterval(updateHudClock, 1000);

// ─── Bottom Controls ───
document.getElementById('btnZoomIn').addEventListener('click', () => {
  viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.4);
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
  viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.6);
});
document.getElementById('btnHome').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 8000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 2
  });
});
document.getElementById('btnNorth').addEventListener('click', () => {
  viewer.camera.flyTo({ destination: viewer.camera.position, orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 }, duration: 1 });
});
document.getElementById('btnTopDown').addEventListener('click', () => {
  viewer.camera.flyTo({ destination: viewer.camera.position, orientation: { heading: viewer.camera.heading, pitch: Cesium.Math.toRadians(-90), roll: 0 }, duration: 1 });
});
document.getElementById('btnFullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

// ─── Mouse Tracking & Tooltips ───
const coordLat = document.getElementById('coordLat');
const coordLon = document.getElementById('coordLon');
const coordAlt = document.getElementById('coordAlt');

const hoverTooltip = document.createElement('div');
hoverTooltip.style.position = 'absolute';
hoverTooltip.style.background = 'rgba(15, 23, 42, 0.9)';
hoverTooltip.style.color = '#f87171';
hoverTooltip.style.padding = '10px 14px';
hoverTooltip.style.borderRadius = '6px';
hoverTooltip.style.pointerEvents = 'none';
hoverTooltip.style.fontSize = '13px';
hoverTooltip.style.border = '1px solid #ef4444';
hoverTooltip.style.zIndex = '9999';
hoverTooltip.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.5)';
hoverTooltip.style.display = 'none';
document.body.appendChild(hoverTooltip);

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement) => {
  const cart = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
  if (cart) {
    const carto = Cesium.Cartographic.fromCartesian(cart);
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(4);
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(4);
    coordLat.textContent = lat + '°';
    coordLon.textContent = lon + '°';
    hudCoordinates.textContent = `LAT ${lat} / LON ${lon}`;
  }

  const picked = viewer.scene.pick(movement.endPosition, 10, 10);
  if (Cesium.defined(picked) && picked.primitive && picked.primitive.flightId) {
    const f = flightsById[picked.primitive.flightId];
    if (f) {
      let typeLabel = f.isMilitary ? "⚔️ TACTICAL MILITARY TARGET" : "✈️ COMMERCIAL FLIGHT";
      let color = f.isMilitary ? "#f87171" : "#4ade80";
      if (f.is_threat) { typeLabel = "🚨 CRITICAL THREAT 🚨"; color = "#ff0055"; }
      hoverTooltip.innerHTML = `
        <b style="font-size: 14px; color: ${color};">${f.isMilitary ? '⚔️' : '✈️'} ${f.callsign}</b><br>
        <div style="margin-top: 4px; color: #cbd5e1;">Alt: ${Math.round(f.alt)}m | Spd: ${Math.round(f.velocity * 3.6)} km/h</div>
        <div style="margin-top: 6px; font-weight: 600; color: ${color};">${typeLabel}</div>
      `;
      hoverTooltip.style.left = (movement.endPosition.x + 15) + 'px';
      hoverTooltip.style.top = (movement.endPosition.y + 15) + 'px';
      hoverTooltip.style.display = 'block';
      return;
    }
  }
  hoverTooltip.style.display = 'none';
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

handler.setInputAction((click) => {
  const picked = viewer.scene.pick(click.position, 10, 10);
  const clickFlightId = picked?.primitive?.flightId;
  if (clickFlightId && window.selectFlight) {
    window.selectFlight(clickFlightId);
  } else {
    window.clearFlightSelection?.();
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ─── LIVE GLOBAL FLIGHTS & WEBSOCKET ENGINE ───
function buildPlaneIconDataUrl() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(32, 4); ctx.lineTo(28, 24); ctx.lineTo(12, 28); ctx.lineTo(12, 32);
  ctx.lineTo(26, 30); ctx.lineTo(26, 44); ctx.lineTo(20, 48); ctx.lineTo(20, 52);
  ctx.lineTo(32, 50); ctx.lineTo(44, 52); ctx.lineTo(44, 48); ctx.lineTo(38, 44);
  ctx.lineTo(38, 30); ctx.lineTo(52, 32); ctx.lineTo(52, 28); ctx.lineTo(36, 24);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  return canvas.toDataURL('image/png');
}

const PLANE_ICON = buildPlaneIconDataUrl();
const FLIGHT_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(2e4, 1.4, 1.2e7, 0.55);

const flightBillboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
flightBillboards.show = false;

let flightSocket = null;
const flightsById = {};
const flightMarkers = {};
const flightHistory = {};
let selectedFlightId = null;
let selectedFlightPathEntity = null;
let highlightedFlightMarker = null;
let highlightedFlightScale = null;

function setFlightRenderMode(enabled) {
  viewer.targetFrameRate = 60;
  viewer.useDefaultRenderLoop = true;
  viewer.scene.requestRender();
}

function flightBillboardOptions(f, position) {
  const isMil = !!f.isMilitary;
  let colorHex = isMil ? '#f87171' : '#4ade80';
  if (f.is_threat) colorHex = '#ff0055';

  return {
    image: PLANE_ICON,
    position,
    width: isMil ? 32 : 26,
    height: isMil ? 32 : 26,
    scale: (isMil || f.is_threat) ? 1.1 : 1.0,
    rotation: -Cesium.Math.toRadians(f.track || 0),
    color: Cesium.Color.fromCssColorString(colorHex),
    scaleByDistance: FLIGHT_SCALE_BY_DISTANCE,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    show: true
  };
}

const flightPopup = document.getElementById('flightPopup');
const flightPopupTitle = document.getElementById('flightPopupTitle');
const flightPopupBadge = document.getElementById('flightPopupBadge');
const flightPopupDetails = document.getElementById('flightPopupDetails');
const flightPopupFlyTo = document.getElementById('flightPopupFlyTo');

function recordFlightPosition(f) {
  if (f.lat == null || f.lon == null) return;
  if (!flightHistory[f.id]) flightHistory[f.id] = [];
  const hist = flightHistory[f.id];
  const last = hist[hist.length - 1];
  if (!last || Math.hypot(f.lat - last.lat, f.lon - last.lon) > 0.02) {
    hist.push({ lat: f.lat, lon: f.lon, alt: f.alt });
    if (hist.length > 60) hist.shift();
  }
}

function computeFlightPath(f) {
  const positions = [];
  const history = flightHistory[f.id] || [];
  history.forEach((p) => {
    positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt || f.alt || 10000));
  });
  if (!positions.length) {
    positions.push(Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.alt || 10000));
  }
  return positions;
}

function renderFlightPanel(f) {
  const isMil = !!f.isMilitary;
  let color = isMil ? '#f87171' : '#4ade80';
  if (f.is_threat) color = '#ff0055';

  flightPopup.classList.toggle('military', isMil || f.is_threat);
  flightPopupTitle.textContent = isMil ? `⚔️ ${f.callsign}` : `✈️ ${f.callsign}`;
  flightPopupBadge.textContent = f.is_threat ? '🚨 THREAT DETECTED' : (isMil ? 'Military' : 'Civilian ADS-B');
  flightPopupBadge.style.color = color;
  flightPopupTitle.style.color = color;

  const rows = [
    ['Flight ID', f.id || '—'],
    ['Callsign', f.callsign || '—'],
    ['Latitude', f.lat != null ? `${f.lat.toFixed(4)}°` : '—'],
    ['Longitude', f.lon != null ? `${f.lon.toFixed(4)}°` : '—'],
    ['Altitude', f.alt != null ? `${Math.round(f.alt)} m` : '—'],
  ];

  flightPopupDetails.innerHTML = rows.map(([label, value]) => `
    <div class="popup-row"><span>${label}</span><span>${value}</span></div>
  `).join('');

  flightPopupFlyTo.onclick = () => {
    if (f.lon == null || f.lat == null) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, (f.alt || 10000) + 8000),
      duration: 2
    });
  };
  flightPopup.classList.remove('hidden');
}

function clearFlightSelection() {
  if (selectedFlightPathEntity) {
    viewer.entities.remove(selectedFlightPathEntity);
    selectedFlightPathEntity = null;
  }
  selectedFlightId = null;
  updateHudTrack();
  if (flightPopup) flightPopup.classList.add('hidden');
  viewer.scene.requestRender();
}

function selectFlight(flightId) {
  const f = flightsById[flightId];
  if (!f) return;
  clearFlightSelection();
  selectedFlightId = flightId;
  updateHudTrack(f);
  renderFlightPanel(f);
  viewer.scene.requestRender();
}

window.selectFlight = selectFlight;
window.clearFlightSelection = clearFlightSelection;

document.getElementById('flightPopupClose')?.addEventListener('click', clearFlightSelection);

function processLiveFlights(flightsData) {
  const currentIds = new Set();
  const statusEl = document.getElementById('flightFeedStatus');
  if (statusEl) statusEl.textContent = `${flightsData.length} LIVE TRACKS 🟢`;

  flightsData.forEach(f => {
    if (f.lat == null || f.lon == null) return;
    currentIds.add(f.id);
    if (flightsById[f.id] && flightsById[f.id].is_threat) f.is_threat = true;

    flightsById[f.id] = f;
    recordFlightPosition(f);

    const position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(f.alt || 0, 100));
    const opts = flightBillboardOptions(f, position);

    if (flightMarkers[f.id]) {
      const b = flightMarkers[f.id];
      b.show = true;
      b.position = position;
      b.rotation = opts.rotation;
      b.color = opts.color;
    } else {
      const billboard = flightBillboards.add(opts);
      billboard.flightId = f.id;
      flightMarkers[f.id] = billboard;
    }
  });

  Object.keys(flightMarkers).forEach(id => {
    if (!currentIds.has(id)) {
      flightBillboards.remove(flightMarkers[id]);
      delete flightMarkers[id];
      delete flightsById[id];
    }
  });

  if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
}

function sendFlightViewport() {
  if (!flightSocket || flightSocket.readyState !== WebSocket.OPEN) return;
  try {
    const rect = viewer.camera.computeViewRectangle();
    if (rect) {
      const south = Cesium.Math.toDegrees(rect.south);
      const west = Cesium.Math.toDegrees(rect.west);
      const north = Cesium.Math.toDegrees(rect.north);
      const east = Cesium.Math.toDegrees(rect.east);
      flightSocket.send(JSON.stringify({ type: 'viewport', bbox: [south, west, north, east] }));
    }
  } catch (e) {}
}

function connectFlightSocket() {
  if (flightSocket) return;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  flightSocket = new WebSocket(`${wsProtocol}//${window.location.host}/ws/flights`);

  flightSocket.onopen = () => {
    sendFlightViewport();
  };

  flightSocket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'threat_alert') {
        triggerHudThreatWarning(payload.flight_id, payload.zone);
        return;
      }

      const flightList = payload.data || payload.flights;
      if (Array.isArray(flightList)) {
        processLiveFlights(flightList);
        const countBadge = document.getElementById('flightsCount');
        if (countBadge) {
          countBadge.textContent = payload.total_global || payload.count || flightList.length;
        }
      }
    } catch (e) {
      console.warn('[Socket] Message parse error:', e);
    }
  };

  flightSocket.onerror = () => { console.error('[Socket] Flight stream error.'); };
  flightSocket.onclose = () => { flightSocket = null; };
}

viewer.camera.moveEnd.addEventListener(() => {
  sendFlightViewport();
});

function triggerHudThreatWarning(flightId, zoneName) {
  const f = flightsById[flightId];
  if (!f) return;
  f.is_threat = true; 
  if (flightMarkers[flightId]) {
    flightMarkers[flightId].color = Cesium.Color.fromCssColorString('#ff0055');
    flightMarkers[flightId].scale = 1.8;
  }
  if (hudSceneStatus && hudSceneDetail) {
    hudSceneStatus.textContent = 'CRITICAL: ZONE BREACH';
    hudSceneStatus.style.color = '#ff0055';
    hudSceneDetail.textContent = `TARGET ${f.callsign || flightId} ENTERED ${zoneName}`;
  }
  viewer.scene.requestRender();
}

document.getElementById('toggleFlights').addEventListener('change', (e) => {
  const on = e.target.checked;
  flightBillboards.show = on;
  setFlightRenderMode(on);

  if (on) {
    connectFlightSocket();
  } else {
    if (flightSocket) { flightSocket.close(); flightSocket = null; }
    clearFlightSelection();
    Object.keys(flightMarkers).forEach((id) => {
      flightBillboards.remove(flightMarkers[id]);
      delete flightMarkers[id];
    });
    const countBadge = document.getElementById('flightsCount');
    if (countBadge) countBadge.textContent = '--';
  }
  viewer.scene.requestRender();
});

console.log('🌍 Earth 3D Globe initialized successfully with Tactical Optics');