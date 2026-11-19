/**
 * OpenStreetMap road geometry viewer with local-only traffic action demos.
 */
(function () {
  'use strict';

  let viewer = null;
  let trafficDataSource = null;
  let vehicleDataSource = null;
  let isEnabled = false;
  let updateTimer = null;
  let clockListener = null;
  let cameraListener = null;

  // Active state parameters
  const state = {
    roads: [],
    lastError: null,
    selectedRoadId: null,
    optimizingSignals: false,
    signalTimer: null,
    patrolActive: false,
    patrolEntity: null,
    patrolRoadId: null,
    patrolProgress: 0,
    reroutingActive: false,
    detourEntity: null,
    reroutedRoadId: null,
    gridlockActive: false,
    gridlockTimer: null,
    lastBbox: null
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  // Helper for computing distance along segments
  function getPathLength(points) {
    let d = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i+1];
      d += Math.hypot(p2.lat - p1.lat, p2.lon - p1.lon);
    }
    return d || 0.001;
  }

  // Interpolation along a multi-segment line
  function interpolatePosition(points, progress) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) return points[0];

    const numSegments = points.length - 1;
    const rawIndex = progress * numSegments;
    const segmentIndex = Math.min(Math.floor(rawIndex), numSegments - 1);
    const segmentProgress = rawIndex - segmentIndex;

    const p1 = points[segmentIndex];
    const p2 = points[segmentIndex + 1];

    const lat = p1.lat + (p2.lat - p1.lat) * segmentProgress;
    const lon = p1.lon + (p2.lon - p1.lon) * segmentProgress;

    return { lat, lon };
  }

  // Get current camera altitude in meters
  function getCameraAltitude() {
    if (!viewer) return 100000;
    const height = viewer.camera.positionCartographic.height;
    return height;
  }

  // Find camera viewport bounding box
  function getViewportBounds() {
    if (!viewer) return null;
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return null;

    return {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north)
    };
  }

  function ensureLayers() {
    if (!viewer && window.viewer) {
      viewer = window.viewer;
      trafficDataSource = new Cesium.CustomDataSource('street-traffic');
      vehicleDataSource = new Cesium.CustomDataSource('traffic-vehicles');
      viewer.dataSources.add(trafficDataSource);
      viewer.dataSources.add(vehicleDataSource);
    }
    return viewer;
  }

  // Parse Overpass API JSON format into roads
  function parseOverpassData(data) {
    const roads = [];
    if (!data.elements) return roads;

    const elements = data.elements.filter(e => e.type === "way" && e.geometry);
    
    elements.forEach((e, index) => {
      const points = e.geometry.map(g => ({ lat: g.lat, lon: g.lon }));
      if (points.length < 2) return;

      const tags = e.tags || {};
      const name = tags.name || tags.ref || `Unidentified Street (${tags.highway || 'road'})`;
      const lengthDeg = getPathLength(points);

      roads.push({
        id: `osm-road-${e.id}-${index}`,
        name,
        points,
        congestion: 'unknown',
        lengthDeg,
        vehicles: []
      });
    });

    return roads;
  }

  // Fetch road geometry only; Overpass does not provide live traffic conditions.
  async function fetchTrafficData() {
    ensureLayers();
    if (!isEnabled || !viewer) return;

    const alt = getCameraAltitude();
    if (alt > 15000) {
      // Too high
      state.roads = [];
      clearMapEntities();
      updatePanelUi(true);
      return;
    }

    const bounds = getViewportBounds();
    if (!bounds) return;

    // Throttle fetches if camera has barely moved
    if (state.lastBbox) {
      const dcLat = Math.abs((bounds.north + bounds.south)/2 - (state.lastBbox.north + state.lastBbox.south)/2);
      const dcLon = Math.abs((bounds.east + bounds.west)/2 - (state.lastBbox.east + state.lastBbox.west)/2);
      if (dcLat < 0.0015 && dcLon < 0.0015 && state.roads.length > 0) {
        return; // camera stationary, skip refresh
      }
    }
    state.lastBbox = bounds;

    try {
      // Query motorway, trunk, primary, secondary roads in bbox
      const query = `[out:json][timeout:3];way["highway"~"motorway|trunk|primary|secondary|tertiary"](${bounds.south.toFixed(4)},${bounds.west.toFixed(4)},${bounds.north.toFixed(4)},${bounds.east.toFixed(4)});out geom 45;`;
      const url = `/api/overpass?q=${encodeURIComponent(query)}`;
      
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000); // 4s timeout for snappy UI
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (!res.ok) throw new Error("Overpass HTTP " + res.status);
      const data = await res.json();
      const loadedRoads = parseOverpassData(data);
      
      if (loadedRoads.length > 0) {
        state.roads = loadedRoads;
        state.lastError = null;
        console.log(`[TRAFFIC] Loaded ${loadedRoads.length} roads from OpenStreetMap.`);
      } else {
        state.roads = [];
        state.lastError = null;
      }
    } catch (err) {
      console.warn("[TRAFFIC] OpenStreetMap road geometry unavailable:", err.message);
      state.roads = [];
      state.lastError = err.message;
    }

    // Keep active rerouting/patrol active on reload if their road still exists
    if (state.patrolActive && !state.roads.some(r => r.id === state.patrolRoadId)) {
      clearPatrol();
    }
    if (state.reroutingActive && !state.roads.some(r => r.id === state.reroutedRoadId)) {
      clearReroute();
    }

    renderRoadsOnMap();
    updatePanelUi(false);
  }

  // Clear map layers
  function clearMapEntities() {
    if (trafficDataSource) trafficDataSource.entities.removeAll();
    if (vehicleDataSource) vehicleDataSource.entities.removeAll();
    if (state.patrolEntity) {
      viewer?.entities.remove(state.patrolEntity);
      state.patrolEntity = null;
    }
    if (state.detourEntity) {
      viewer?.entities.remove(state.detourEntity);
      state.detourEntity = null;
    }
  }

  function getCongestionColor(status) {
    if (state.optimizingSignals) {
      return Cesium.Color.fromCssColorString('#10b981'); // optimize turns everything green
    }
    if (state.gridlockActive) {
      return Cesium.Color.fromCssColorString('#ef4444'); // gridlock turns everything red
    }
    
    switch (status) {
      case 'smooth': return Cesium.Color.fromCssColorString('#10b981');
      case 'moderate': return Cesium.Color.fromCssColorString('#f59e0b');
      case 'congested': return Cesium.Color.fromCssColorString('#ef4444');
      default: return Cesium.Color.fromCssColorString('#64748b');
    }
  }

  function renderRoadsOnMap() {
    if (!viewer || !trafficDataSource) return;
    trafficDataSource.entities.removeAll();

    state.roads.forEach(r => {
      const positions = r.points.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0));
      const color = getCongestionColor(r.congestion);
      
      // Determine thickness based on congestion
      const width = (r.congestion === 'congested' && !state.optimizingSignals) ? 4.5 : 3.0;

      trafficDataSource.entities.add({
        id: r.id,
        name: r.name,
        polyline: {
          positions,
          width,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: color.withAlpha(0.85)
          }),
          clampToGround: true
        },
        description: `<b>${r.name}</b><br/>Congestion Level: <span style="font-weight:700;color:${color.toCssColorString()}">${r.congestion.toUpperCase()}</span>`
      });
    });

    viewer.scene.requestRender();
  }

  // Animate active moving vehicles
  function animateVehicles(deltaTime) {
    if (!isEnabled || !viewer || !vehicleDataSource) return;

    vehicleDataSource.entities.removeAll();

    // Base speed factor (degrees per second, roughly)
    const baseSpeed = 0.0003;

    state.roads.forEach(r => {
      let speedFactor = 1.0;
      
      // Adjust speeds based on congestion, signals or gridlocks
      if (state.optimizingSignals) {
        speedFactor = 2.2;
      } else if (state.gridlockActive) {
        speedFactor = 0.15;
      } else {
        if (r.congestion === 'congested') speedFactor = 0.25;
        else if (r.congestion === 'moderate') speedFactor = 0.6;
      }

      const points = r.points;
      
      r.vehicles.forEach((v, vIndex) => {
        // Move vehicle progress forward
        const deltaProgress = (baseSpeed * v.speedOffset * speedFactor / r.lengthDeg) * deltaTime;
        v.progress = (v.progress + deltaProgress) % 1.0;

        const pos = interpolatePosition(points, v.progress);
        if (pos) {
          const cart3 = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0.5);
          
          let color = getCongestionColor(r.congestion);
          if (state.optimizingSignals) color = Cesium.Color.fromCssColorString('#06b6d4'); // cyber blue glow

          vehicleDataSource.entities.add({
            position: cart3,
            point: {
              pixelSize: 7,
              color: color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1.5,
            }
          });
        }
      });
    });

    // 🚔 Animate Traffic Patrol Entity
    if (state.patrolActive && state.patrolRoadId) {
      const road = state.roads.find(r => r.id === state.patrolRoadId);
      if (road) {
        // Patrol vehicle moves very quickly (takes ~5 seconds to cover the road)
        state.patrolProgress += (baseSpeed * 6.5 / road.lengthDeg) * deltaTime;
        
        if (state.patrolProgress >= 1.0) {
          // Patrol vehicle has completed clearing the street
          road.congestion = 'smooth';
          clearPatrol();
          renderRoadsOnMap();
          updatePanelUi(false);
        } else {
          const pos = interpolatePosition(road.points, state.patrolProgress);
          if (pos) {
            const cart3 = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 1.0);
            
            // Flashing Red & Blue Police Lights
            const flashTick = Math.floor(Date.now() / 150) % 2 === 0;
            const patrolColor = flashTick 
              ? Cesium.Color.fromCssColorString('#0070ff') 
              : Cesium.Color.fromCssColorString('#ff0022');

            if (!state.patrolEntity) {
              state.patrolEntity = viewer.entities.add({
                name: "🚔 HIGHWAY PATROL TASK FORCE",
                position: cart3,
                point: {
                  pixelSize: 12,
                  color: patrolColor,
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 2,
                },
                label: {
                  text: '🚔 PATROL',
                  font: '9px Courier New, monospace',
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  fillColor: Cesium.Color.CYAN,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  pixelOffset: new Cesium.Cartesian2(0, -14),
                }
              });
            } else {
              state.patrolEntity.position = cart3;
              state.patrolEntity.point.color = patrolColor;
            }
          }
        }
      } else {
        clearPatrol();
      }
    }

    viewer.scene.requestRender();
  }

  // Setup tab panel HTML content
  function updatePanelUi(isAltAlert) {
    const pane = document.getElementById('intel-panel-traffic');
    if (!pane) return;

    if (isAltAlert) {
      pane.innerHTML = `<div class="traffic-zoom-alert">
        <span style="font-size:20px;display:block;margin-bottom:8px;">📡 ALTITUDE WARNING</span>
        Zoom in below 15 km to load OpenStreetMap road geometry. Live traffic conditions are unavailable.
      </div>`;
      return;
    }

    if (state.roads.length === 0) {
      const message = state.lastError
        ? 'OpenStreetMap road geometry is unavailable for this viewport.'
        : 'No road geometry found in this viewport.';
      pane.innerHTML = `<div class="intel-empty">${message}<br/>Live speed, congestion, and incident data are unavailable because no traffic provider is configured.</div>`;
      return;
    }

    const totalRoads = state.roads.length;
    let bannerHtml = `<div class="traffic-alert-banner" style="color:#f59e0b;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.08);">
      OpenStreetMap road geometry only. Live conditions are unavailable; the controls below are local visual simulations, not dispatch actions.
    </div>`;
    if (state.optimizingSignals) {
      bannerHtml += `<div class="traffic-alert-banner" style="color:#10b981;border-color:rgba(16,185,129,0.3);background:rgba(16,185,129,0.08);">
        <span>🟢</span> <b>DEMO: signal visualization active</b>
      </div>`;
    } else if (state.gridlockActive) {
      bannerHtml += `<div class="traffic-alert-banner" style="color:#ef4444;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);">
        <span>🔴</span> <b>DEMO: gridlock visualization active</b>
      </div>`;
    } else if (state.patrolActive) {
      const pRoad = state.roads.find(r => r.id === state.patrolRoadId);
      bannerHtml += `<div class="traffic-alert-banner" style="color:#38bdf8;border-color:rgba(56,189,248,0.3);background:rgba(56,189,248,0.08);">
        <span>🚔</span> <b>DEMO: patrol animation on ${escapeHtml(pRoad ? pRoad.name.split(' ')[0] : 'street')}</b>
      </div>`;
    } else if (state.reroutingActive) {
      const rRoad = state.roads.find(r => r.id === state.reroutedRoadId);
      bannerHtml += `<div class="traffic-alert-banner" style="color:#f59e0b;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.08);">
        <span>⚠️</span> <b>DEMO: detour overlay on ${escapeHtml(rRoad ? rRoad.name.split(' ')[0] : 'street')}</b>
      </div>`;
    }

    let html = `
      <div class="traffic-overview-container">
        ${bannerHtml}
        
        <div class="traffic-metric-card">
          <div class="traffic-metric-title">Traffic data status</div>
          <div class="traffic-metric-value" style="color:#f59e0b;">UNAVAILABLE</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:8px;">
            ${totalRoads} OpenStreetMap road segments loaded; no live speeds or incidents are available.
          </div>
        </div>

        <!-- Operations Console -->
        <h3 class="traffic-actions-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M21 9H3M21 15H3M12 3v18"/></svg>
          Local Demo Controls — No Dispatch
        </h3>
        
        <div class="traffic-actions-grid">
          <button class="traffic-action-btn btn-optimize" id="btnOptSignals" title="Local visual simulation only; no signal system is connected" ${state.optimizingSignals ? 'disabled style="opacity:0.5"' : ''}>
            🚦 Demo Signal Sync
          </button>
          <button class="traffic-action-btn btn-patrol" id="btnDepPatrol" title="Local visual simulation only; no patrol is dispatched" ${state.patrolActive ? 'disabled style="opacity:0.5"' : ''}>
            🚔 Demo Patrol
          </button>
          <button class="traffic-action-btn btn-reroute" id="btnRerouteTraffic" title="Local visual simulation only; no routing system is connected" ${state.reroutingActive ? 'disabled style="opacity:0.5"' : ''}>
            ⚠️ Demo Detour
          </button>
          <button class="traffic-action-btn btn-gridlock" id="btnTriggerGridlock" title="Local visual simulation only">
            🚨 ${state.gridlockActive ? 'Clear Demo Gridlock' : 'Demo Gridlock'}
          </button>
        </div>

        <!-- Monitored Roads List -->
        <h3 class="traffic-actions-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          OpenStreetMap Road Segments
        </h3>
        
        <div class="traffic-roads-list">
    `;

    const sortedRoads = [...state.roads].sort((a, b) => a.name.localeCompare(b.name));

    sortedRoads.forEach(r => {
      html += `
        <article class="traffic-card-road" data-road-id="${r.id}">
          <div class="traffic-road-head">
            <span class="traffic-road-title" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
            <span class="traffic-status-pill">ROAD GEOMETRY</span>
          </div>
          <div class="traffic-road-meta">
            <span>Live speed: unavailable</span>
            <span>Traffic data: not configured</span>
          </div>
        </article>
      `;
    });

    html += `
        </div>
      </div>
    `;

    pane.innerHTML = html;

    // Bind event handlers
    document.getElementById('btnOptSignals')?.addEventListener('click', optimizeSignalsAction);
    document.getElementById('btnDepPatrol')?.addEventListener('click', deployPatrolAction);
    document.getElementById('btnRerouteTraffic')?.addEventListener('click', rerouteTrafficAction);
    document.getElementById('btnTriggerGridlock')?.addEventListener('click', toggleGridlockAction);

    // Bind card clicks for fly-to
    pane.querySelectorAll('.traffic-card-road').forEach(card => {
      card.addEventListener('click', () => {
        const roadId = card.dataset.roadId;
        const road = state.roads.find(r => r.id === roadId);
        if (road && road.points.length > 0) {
          state.selectedRoadId = roadId;
          const center = road.points[Math.floor(road.points.length / 2)];
          
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 2200),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch: Cesium.Math.toRadians(-45),
              roll: 0
            },
            duration: 1.8
          });
        }
      });
    });
  }

  // 🟢 Action: Optimize Signals
  function optimizeSignalsAction() {
    if (state.optimizingSignals) return;
    state.optimizingSignals = true;
    
    // Clear other simulation states
    if (state.gridlockActive) clearGridlock();

    renderRoadsOnMap();
    updatePanelUi(false);

    // Reset after 15 seconds
    state.signalTimer = setTimeout(() => {
      state.optimizingSignals = false;
      renderRoadsOnMap();
      updatePanelUi(false);
    }, 15000);
  }

  // 🚔 Action: Deploy Patrol Task Force
  function deployPatrolAction() {
    if (state.patrolActive) return;

    // Find the most congested road
    const congestedRoad = state.roads.find(r => r.congestion === 'congested') || 
                          state.roads.find(r => r.congestion === 'moderate') ||
                          state.roads[0];

    if (!congestedRoad) return;

    state.patrolActive = true;
    state.patrolRoadId = congestedRoad.id;
    state.patrolProgress = 0;

    updatePanelUi(false);
  }

  function clearPatrol() {
    state.patrolActive = false;
    state.patrolRoadId = null;
    state.patrolProgress = 0;
    if (state.patrolEntity) {
      viewer?.entities.remove(state.patrolEntity);
      state.patrolEntity = null;
    }
  }

  // ⚠️ Action: Emergency Detour Reroute
  function rerouteTrafficAction() {
    if (state.reroutingActive) return;

    const congestedRoad = state.roads.find(r => r.congestion === 'congested') || 
                          state.roads.find(r => r.congestion === 'moderate') ||
                          state.roads[0];

    if (!congestedRoad || congestedRoad.points.length < 2) return;

    state.reroutingActive = true;
    state.reroutedRoadId = congestedRoad.id;

    // Generate detour points offset from the road to represent a physical bypass
    const midIdx = Math.floor(congestedRoad.points.length / 2);
    const start = congestedRoad.points[0];
    const end = congestedRoad.points[congestedRoad.points.length - 1];
    
    // Detour curves out to the side
    const curveOffsetLat = 0.0015;
    const curveOffsetLon = 0.0015;

    const detourPoints = [
      Cesium.Cartesian3.fromDegrees(start.lon, start.lat, 0),
      Cesium.Cartesian3.fromDegrees(start.lon + curveOffsetLon, start.lat + curveOffsetLat, 0),
      Cesium.Cartesian3.fromDegrees(end.lon + curveOffsetLon, end.lat + curveOffsetLat, 0),
      Cesium.Cartesian3.fromDegrees(end.lon, end.lat, 0)
    ];

    // Add a flashing detour route polyline
    state.detourEntity = viewer.entities.add({
      name: "⚠️ EMERGENCY TRAFFIC BYPASS DETOUR",
      polyline: {
        positions: detourPoints,
        width: 3.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#f59e0b'),
          dashLength: 16.0
        }),
        clampToGround: true
      }
    });

    // Animate the detour dashed line flashing
    let flash = false;
    const detourFlashTimer = setInterval(() => {
      if (!state.reroutingActive || !state.detourEntity) {
        clearInterval(detourFlashTimer);
        return;
      }
      flash = !flash;
      state.detourEntity.polyline.width = flash ? 5.0 : 2.5;
    }, 500);

    // Decongest target road
    congestedRoad.congestion = 'smooth';
    renderRoadsOnMap();
    updatePanelUi(false);

    // Revert detour after 12 seconds
    setTimeout(() => {
      clearReroute();
      updatePanelUi(false);
    }, 12000);
  }

  function clearReroute() {
    state.reroutingActive = false;
    state.reroutedRoadId = null;
    if (state.detourEntity) {
      viewer?.entities.remove(state.detourEntity);
      state.detourEntity = null;
    }
  }

  // 🔴 Action: Toggle Gridlock
  function toggleGridlockAction() {
    if (state.gridlockActive) {
      clearGridlock();
    } else {
      state.gridlockActive = true;
      if (state.optimizingSignals) {
        state.optimizingSignals = false;
        clearTimeout(state.signalTimer);
      }
    }
    renderRoadsOnMap();
    updatePanelUi(false);
  }

  function clearGridlock() {
    state.gridlockActive = false;
  }

  function setTrafficEnabled(on) {
    isEnabled = on;
    ensureLayers();
    if (!viewer) return;

    clearMapEntities();

    if (on) {
      // Refresh traffic data periodically (every 7 seconds)
      fetchTrafficData();
      updateTimer = setInterval(fetchTrafficData, 7000);

      // Listen for camera movements to load new OSM roads on map view updates
      cameraListener = viewer.camera.moveEnd.addEventListener(fetchTrafficData);

      // Register delta-time animation loop for vehicles
      let lastTime = Date.now();
      clockListener = viewer.clock.onTick.addEventListener(() => {
        const now = Date.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;
        animateVehicles(deltaTime);
      });
    } else {
      clearInterval(updateTimer);
      updateTimer = null;

      if (cameraListener) {
        cameraListener(); // unsubscribe camera moveEnd
        cameraListener = null;
      }
      if (clockListener) {
        clockListener(); // unsubscribe animation tick
        clockListener = null;
      }

      clearPatrol();
      clearReroute();
      clearGridlock();
      state.roads = [];
      state.lastBbox = null;

      const pane = document.getElementById('intel-panel-traffic');
      state.lastError = null;
      if (pane) pane.innerHTML = `<div class="intel-empty">Enable the OpenStreetMap road layer to view road geometry. Live traffic conditions are unavailable.</div>`;
    }
    viewer.scene.requestRender();
  }

  function initUi() {
    document.getElementById('toggleTraffic')?.addEventListener('change', (e) => {
      setTrafficEnabled(e.target.checked);
    });
  }

  function boot() {
    const wait = setInterval(() => {
      if (!window.viewer) return;
      clearInterval(wait);
      ensureLayers();
      initUi();
    }, 200);
  }

  boot();
})();
