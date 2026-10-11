/**
 * OSIRIS Layers & Intelligence Feeds Integration for GODSEYE
 * Handles CCTV cameras, Cyber Attacks/Threats, Earthquakes, Severe Weather,
 * Global News RSS, Sanctions Search, and MalwareBazaar Threat Intel.
 */

(function () {
  'use strict';

  const POLL_MS = 120_000;
  
  let cameras = [];
  let cyberAttacks = [];
  let cyberThreats = [];
  let earthquakes = [];
  let weatherEvents = [];
  let newsArticles = [];
  let malwareSamples = [];
  let spaceWeatherData = null;
  let gdeltEvents = [];

  // Camera viewer modal state
  let cctvModalCamList = [];
  let cctvModalIndex = 0;

  const state = {
    layers: {
      cctv: false,
      cyber: false,
      earthquakes: false,
      weather: false,
    },
    loaded: {
      cctv: false,
      cyber: false,
      earthquakes: false,
      weather: false,
      news: false,
      sanctions: false,
      malware: false,
      spaceWeather: false,
      gdelt: false,
    }
  };

  function getViewer() {
    return window.viewer;
  }

  function updateBadge(id, count) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = typeof count === 'number' ? count.toLocaleString() : count;
    }
  }

  function ensureDataSources() {
    const viewer = getViewer();
    if (!viewer) return null;

    if (!window.osirisCctvDataSource) {
      window.osirisCctvDataSource = new Cesium.CustomDataSource('cctv-cameras');
      viewer.dataSources.add(window.osirisCctvDataSource);
    }
    if (!window.osirisCyberDataSource) {
      window.osirisCyberDataSource = new Cesium.CustomDataSource('cyber-attacks');
      viewer.dataSources.add(window.osirisCyberDataSource);
    }
    if (!window.osirisEarthquakesDataSource) {
      window.osirisEarthquakesDataSource = new Cesium.CustomDataSource('earthquakes');
      viewer.dataSources.add(window.osirisEarthquakesDataSource);
    }
    if (!window.osirisWeatherDataSource) {
      window.osirisWeatherDataSource = new Cesium.CustomDataSource('weather-events');
      viewer.dataSources.add(window.osirisWeatherDataSource);
    }

    window.osirisCctvDataSource.show = state.layers.cctv;
    window.osirisCyberDataSource.show = state.layers.cyber;
    window.osirisEarthquakesDataSource.show = state.layers.earthquakes;
    window.osirisWeatherDataSource.show = state.layers.weather;

    return viewer;
  }

  // ═════════════════════════════════════════════════════════════════
  // ─── MAP RENDERING ───
  // ═════════════════════════════════════════════════════════════════

  function renderCCTVsOnMap() {
    const viewer = ensureDataSources();
    if (!viewer || !window.osirisCctvDataSource) return;
    const ds = window.osirisCctvDataSource;
    ds.entities.removeAll();

    cameras.forEach(cam => {
      if (!cam.lat || !cam.lng) return;
      const isVideo = cam.stream_type === 'hls' || cam.stream_type === 'iframe' || cam.stream_url;
      const icon = isVideo ? '🎥' : '📷';
      const color = isVideo ? '#4fc3f7' : '#81d4fa';

      ds.entities.add({
        id: `cctv-${cam.id}`,
        position: Cesium.Cartesian3.fromDegrees(cam.lng, cam.lat),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: icon,
          font: '14px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000),
        },
        description: `
          <div style="font-family: monospace; line-height: 1.4;">
            <b style="color: #4fc3f7;">${cam.name}</b><br/>
            Location: ${cam.city || 'Unknown'}, ${cam.country || 'Unknown'}<br/>
            Source: ${cam.source || 'Unknown'}<br/>
            Type: ${isVideo ? 'Live Video' : 'Snapshot'}<br/>
            ${cam.feed_url && !isVideo ? `<img src="${cam.feed_url}" style="width:100%; max-width:280px; margin-top:8px; border-radius:4px; border:1px solid #38bdf8;" onerror="this.style.display='none'"/>` : ''}
          </div>
        `
      });
    });
    viewer.scene.requestRender();
  }

  function renderCyberAttacksOnMap() {
    const viewer = ensureDataSources();
    if (!viewer || !window.osirisCyberDataSource) return;
    const ds = window.osirisCyberDataSource;
    ds.entities.removeAll();

    cyberAttacks.forEach(attack => {
      if (!attack.lat || !attack.lng) return;
      const isOnline = attack.status === 'online';
      const color = isOnline ? '#ef5350' : '#ffa726';

      ds.entities.add({
        id: `cyber-${attack.id}`,
        position: Cesium.Cartesian3.fromDegrees(attack.lng, attack.lat),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: '⚡',
          font: '14px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000000),
        },
        description: `
          <div style="font-family: monospace; line-height: 1.4;">
            <b style="color: ${color};">CYBER C2 NODE INDICATOR</b><br/>
            IP: ${attack.ip}<br/>
            Port: ${attack.port || 'Any'}<br/>
            Malware: ${attack.malware || 'Unknown Family'}<br/>
            Status: ${attack.status.toUpperCase()}<br/>
            Location: ${attack.country || 'Unknown'}<br/>
            Last Online: ${attack.last_online || 'N/A'}<br/>
          </div>
        `
      });
    });
    viewer.scene.requestRender();
  }

  function renderEarthquakesOnMap() {
    const viewer = ensureDataSources();
    if (!viewer || !window.osirisEarthquakesDataSource) return;
    const ds = window.osirisEarthquakesDataSource;
    ds.entities.removeAll();

    earthquakes.forEach(eq => {
      if (eq.lat == null || eq.lon == null) return;
      const mag = eq.mag || 0;
      let color = '#22c55e'; // green
      let size = 8;
      if (mag >= 6.0) {
        color = '#ef4444'; // red
        size = 18;
      } else if (mag >= 5.0) {
        color = '#f97316'; // orange
        size = 14;
      } else if (mag >= 4.0) {
        color = '#eab308'; // yellow
        size = 10;
      }

      ds.entities.add({
        id: `quake-${eq.id}`,
        position: Cesium.Cartesian3.fromDegrees(eq.lon, eq.lat),
        point: {
          pixelSize: size,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: `M${mag.toFixed(1)}`,
          font: 'bold 11px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6000000),
        },
        description: `
          <div style="font-family: monospace; line-height: 1.4;">
            <b style="color: ${color}; font-size: 14px;">M${mag.toFixed(1)} SEISMIC EVENT</b><br/>
            Location: ${eq.place || 'Unknown'}<br/>
            Depth: ${eq.depth_km != null ? eq.depth_km + ' km' : 'N/A'}<br/>
            Time: ${new Date(eq.time).toUTCString()}<br/>
            Tsunami Warning: ${eq.tsunami ? '<span style="color:#ef4444;font-weight:bold;">YES</span>' : 'None'}<br/>
            <a href="${eq.url}" target="_blank" style="color:#38bdf8; display:inline-block; margin-top:6px;">View USGS Report ↗</a>
          </div>
        `
      });
    });
    viewer.scene.requestRender();
  }

  function renderWeatherEventsOnMap() {
    const viewer = ensureDataSources();
    if (!viewer || !window.osirisWeatherDataSource) return;
    const ds = window.osirisWeatherDataSource;
    ds.entities.removeAll();

    weatherEvents.forEach(ev => {
      if (ev.lat == null || ev.lon == null) return;
      const category = (ev.categories?.[0] || '').toLowerCase();
      let icon = '⚠️';
      let color = '#06b6d4';

      if (category.includes('storm') || category.includes('cyclone') || category.includes('hurricane')) {
        icon = '🌀';
        color = '#38bdf8';
      } else if (category.includes('wildfire') || category.includes('fire')) {
        icon = '🔥';
        color = '#f97316';
      } else if (category.includes('volcano')) {
        icon = '🌋';
        color = '#ef4444';
      } else if (category.includes('ice') || category.includes('snow')) {
        icon = '❄️';
        color = '#93c5fd';
      } else if (category.includes('flood') || category.includes('water')) {
        icon = '🌊';
        color = '#3b82f6';
      }

      ds.entities.add({
        id: `weather-${ev.id}`,
        position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: icon,
          font: '14px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
        },
        description: `
          <div style="font-family: monospace; line-height: 1.4;">
            <b style="color: ${color}; font-size: 13px;">${ev.title}</b><br/>
            Category: ${ev.categories?.join(', ') || 'Natural Event'}<br/>
            Date: ${new Date(ev.date).toLocaleDateString()}<br/>
            ${ev.link ? `<a href="${ev.link}" target="_blank" style="color:#38bdf8; display:inline-block; margin-top:6px;">NASA EONET Page ↗</a>` : ''}
          </div>
        `
      });
    });
    viewer.scene.requestRender();
  }

  // ═════════════════════════════════════════════════════════════════
  // ─── PANEL RENDERING ───
  // ═════════════════════════════════════════════════════════════════

  function setPanelHtml(tabId, html) {
    const el = document.getElementById(`intel-panel-${tabId}`);
    if (el) el.innerHTML = html;
  }

  function bindCardFlyTo(containerId, zoomAlt = 10000) {
    document.querySelectorAll(`#${containerId} .intel-card[data-lat]`).forEach(card => {
      card.addEventListener('click', () => {
        const lat = parseFloat(card.dataset.lat);
        const lon = parseFloat(card.dataset.lon);
        if (!isNaN(lat) && !isNaN(lon) && window.viewer) {
          window.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, zoomAlt),
            duration: 2
          });
        }
      });
    });
  }

  // ═══ CCTV Camera Viewer Modal ═══
  function openCctvModal(cam, index, list) {
    cctvModalCamList = list;
    cctvModalIndex = index;
    renderCctvModalFrame(cam);
    const modal = document.getElementById('cctvModal');
    if (modal) { modal.style.display = 'flex'; }
  }

  function renderCctvModalFrame(cam) {
    if (!cam) return;
    const name = document.getElementById('cctvModalName');
    const meta = document.getElementById('cctvModalMeta');
    const inner = document.getElementById('cctvFeedInner');
    const ts = document.getElementById('cctvTimestamp');
    const src = document.getElementById('cctvSourceLabel');
    const counter = document.getElementById('cctvModalCounter');
    const flyBtn = document.getElementById('cctvModalFlyTo');

    if (name) name.textContent = cam.name || 'SURVEILLANCE OPTIC';
    if (meta) meta.textContent = `${cam.city || ''}${cam.city && cam.country ? ', ' : ''}${cam.country || ''} · ${cam.source || ''}`;
    if (ts) ts.textContent = new Date().toUTCString();
    if (src) src.textContent = `CAM ${(cctvModalIndex + 1).toString().padStart(2, '0')} · ${(cam.stream_type || 'FEED').toUpperCase()}`;
    if (counter) counter.textContent = `CAM ${cctvModalIndex + 1} / ${cctvModalCamList.length}`;

    if (flyBtn) {
      flyBtn.onclick = () => {
        if (cam.lat && cam.lng && window.viewer) {
          window.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(cam.lng, cam.lat, 8000),
            duration: 2
          });
        }
      };
    }

    if (!inner) return;
    inner.innerHTML = '';

    const type = cam.stream_type || '';
    const url = cam.feed_url || cam.video_url || '';

    if (type === 'iframe' && url) {
      // Live YouTube / embed stream
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.allow = 'autoplay; encrypted-media; fullscreen';
      iframe.allowFullscreen = true;
      iframe.style.cssText = 'width:100%;height:100%;border:none;position:absolute;inset:0;';
      inner.appendChild(iframe);
    } else if (type === 'hls' || type === 'mp4' || url.includes('.m3u8') || url.includes('.mp4')) {
      // Actual video stream (HLS or native video)
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.controls = true;
      video.loop = true;
      video.playsInline = true;
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
      inner.appendChild(video);

      if ((type === 'hls' || url.includes('.m3u8')) && window.Hls && Hls.isSupported()) {
        const hls = new Hls({ maxMaxBufferLength: 10 });
        hls.loadSource(url);
        hls.attachMedia(video);
        inner._hls = hls; // Keep a reference to destroy later
      } else {
        // Native support (e.g. Safari for HLS, or standard MP4/WebM)
        video.src = url;
      }

    } else if ((type === 'jpg' || type === 'png' || type === 'mjpg') && url) {
      // Still / snapshot feed
      const img = document.createElement('img');
      // If it's a data: URI or SVG raster, display directly; for real HTTP feeds add cache-bust
      img.src = url.startsWith('data:') ? url : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      img.alt = cam.name;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;position:absolute;inset:0;margin:auto;';
      img.onerror = () => { inner.innerHTML = '<div style="color:#ef4444;font-family:monospace;font-size:13px;">⚠ FEED OFFLINE — CONNECTION REFUSED</div>'; };
      inner.appendChild(img);

      // Auto-refresh snapshots every 8s
      inner._refreshTimer = setInterval(() => {
        if (document.getElementById('cctvModal')?.style.display !== 'none') {
          img.src = url.startsWith('data:') ? url : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        } else {
          clearInterval(inner._refreshTimer);
        }
      }, 8000);
    } else {
      // No usable URL — show raster placeholder
      inner.innerHTML = `<div style="text-align:center;font-family:monospace;color:#475569;padding:20px;">
        <div style="font-size:40px;margin-bottom:12px;">📷</div>
        <div style="color:#64748b;font-size:12px;">SIGNAL ENCRYPTED · NO PREVIEW AVAILABLE</div>
        <div style="color:#334155;font-size:11px;margin-top:6px;">${cam.name}</div>
      </div>`;
    }
  }

  function closeCctvModal() {
    const modal = document.getElementById('cctvModal');
    const inner = document.getElementById('cctvFeedInner');
    if (modal) { modal.style.display = 'none'; }
    if (inner) {
      clearInterval(inner._refreshTimer);
      if (inner._hls) {
        inner._hls.destroy();
        inner._hls = null;
      }
      inner.innerHTML = ''; // destroy iframe/video to stop streams
    }
  }

  function initCctvModalControls() {
    document.getElementById('cctvModalClose')?.addEventListener('click', closeCctvModal);
    document.getElementById('cctvModal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('cctvModal')) closeCctvModal();
    });
    document.getElementById('cctvModalPrev')?.addEventListener('click', () => {
      if (!cctvModalCamList.length) return;
      cctvModalIndex = (cctvModalIndex - 1 + cctvModalCamList.length) % cctvModalCamList.length;
      renderCctvModalFrame(cctvModalCamList[cctvModalIndex]);
    });
    document.getElementById('cctvModalNext')?.addEventListener('click', () => {
      if (!cctvModalCamList.length) return;
      cctvModalIndex = (cctvModalIndex + 1) % cctvModalCamList.length;
      renderCctvModalFrame(cctvModalCamList[cctvModalIndex]);
    });
    // Keyboard: Escape to close, arrow keys to navigate
    document.addEventListener('keydown', (e) => {
      const modal = document.getElementById('cctvModal');
      if (!modal || modal.style.display === 'none') return;
      if (e.key === 'Escape') closeCctvModal();
      if (e.key === 'ArrowRight') document.getElementById('cctvModalNext')?.click();
      if (e.key === 'ArrowLeft') document.getElementById('cctvModalPrev')?.click();
    });
    // Update timestamp every second while modal is open
    setInterval(() => {
      const modal = document.getElementById('cctvModal');
      const ts = document.getElementById('cctvTimestamp');
      if (modal && modal.style.display !== 'none' && ts) {
        ts.textContent = new Date().toUTCString();
      }
    }, 1000);
  }

  function renderCCTVPanel() {
    if (!cameras.length) {
      setPanelHtml('cctv', '<div class="intel-empty">Loading CCTV feeds...</div>');
      return;
    }

    const videos = cameras.filter(c => c.stream_type === 'hls' || c.stream_type === 'iframe' || c.stream_url);
    const stills = cameras.filter(c => c.stream_type === 'jpg');
    const displayList = cameras.slice(0, 80);

    let html = `<div class="intel-stat">${cameras.length} active feeds (${videos.length} live video, ${stills.length} snapshots) · Click to view</div>`;
    
    displayList.forEach((cam, i) => {
      const isVideo = cam.stream_type === 'hls' || cam.stream_type === 'iframe' || cam.stream_url;
      const typeBadge = isVideo 
        ? '<span class="intel-badge" style="background:#0284c7;color:white;">▶ LIVE</span>' 
        : '<span class="intel-badge" style="background:#475569;color:white;">📷 CAM</span>';
      
      html += `
        <article class="intel-card" style="border-left: 3px solid ${isVideo ? '#0ea5e9' : '#94a3b8'}; cursor:pointer;" data-camidx="${i}" data-lat="${cam.lat}" data-lon="${cam.lng}">
          <header class="intel-card-head">
            <h4 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;">${cam.name}</h4>
            ${typeBadge}
          </header>
          <p class="intel-card-meta">${cam.city || 'Unknown'}, ${cam.country || 'Unknown'} · ${cam.source}</p>
        </article>
      `;
    });

    setPanelHtml('cctv', html);

    // Wire click → open camera viewer modal
    document.querySelectorAll('#intel-panel-cctv .intel-card[data-camidx]').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.camidx, 10);
        openCctvModal(displayList[idx], idx, displayList);
      });
    });
  }

  function renderCyberPanel() {
    let html = '';
    
    if (cyberThreats.threats?.length) {
      html += `<h4 style="color: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 12px; border-bottom: 1px solid #334155; margin:0;">Active Exploits (CISA)</h4>`;
      cyberThreats.threats.slice(0, 10).forEach(threat => {
        html += `
          <article class="intel-card" style="border-left: 3px solid #ef4444;">
            <header class="intel-card-head">
              <h4>${threat.id}</h4>
              <span class="intel-badge critical">CRITICAL</span>
            </header>
            <p class="intel-card-summary">${threat.name}</p>
            <p class="intel-card-meta">${threat.vendor} ${threat.product} · ${new Date(threat.date).toLocaleDateString()}</p>
          </article>
        `;
      });
    }

    if (cyberAttacks.length) {
      const onlineCount = cyberAttacks.filter(a => a.status === 'online').length;
      html += `<h4 style="color: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 12px; border-bottom: 1px solid #334155; margin:0; margin-top: 8px;">C2 Infrastructure (${onlineCount} online)</h4>`;
      
      cyberAttacks.slice(0, 50).forEach(attack => {
        const isOnline = attack.status === 'online';
        html += `
          <article class="intel-card" style="border-left: 3px solid ${isOnline ? '#f97316' : '#64748b'}; cursor:pointer;" data-lat="${attack.lat}" data-lon="${attack.lng}">
            <header class="intel-card-head">
              <h4 style="font-family: monospace;">${attack.ip}:${attack.port || '*'}</h4>
              <span class="intel-badge" style="background:${isOnline ? '#ea580c' : '#475569'};color:white;">${attack.status.toUpperCase()}</span>
            </header>
            <p class="intel-card-summary">Malware: ${attack.malware || 'Unknown'}</p>
            <p class="intel-card-meta">${attack.country || 'Unknown'} · Last seen: ${attack.last_online}</p>
          </article>
        `;
      });
    }

    if (!html) {
      html = '<div class="intel-empty">No cyber threats detected.</div>';
    }

    setPanelHtml('cyber', html);
    bindCardFlyTo('intel-panel-cyber', 2000000);
  }

  function renderEarthquakesPanel() {
    if (!earthquakes.length) {
      setPanelHtml('earthquakes', '<div class="intel-empty">Loading USGS seismic events...</div>');
      return;
    }

    let html = `<div class="intel-stat">${earthquakes.length} earthquakes past 24h (USGS)</div>`;
    
    earthquakes.slice(0, 50).forEach(eq => {
      const mag = eq.mag || 0;
      let color = '#22c55e';
      if (mag >= 6.0) color = '#ef4444';
      else if (mag >= 5.0) color = '#f97316';
      else if (mag >= 4.0) color = '#eab308';

      const timeAgoMins = Math.round((Date.now() - eq.time) / 60000);
      const timeStr = timeAgoMins < 60 ? `${timeAgoMins}m ago` : `${Math.round(timeAgoMins / 60)}h ago`;

      html += `
        <article class="intel-card" style="border-left: 3px solid ${color}; cursor:pointer;" data-lat="${eq.lat}" data-lon="${eq.lon}">
          <header class="intel-card-head">
            <h4 style="font-weight: 700; color: ${color};">M${mag.toFixed(1)}</h4>
            <span class="intel-badge" style="background:rgba(255,255,255,0.08);color:#94a3b8;">${timeStr}</span>
          </header>
          <p class="intel-card-summary">${eq.place || 'Seismic event'}</p>
          <p class="intel-card-meta">Depth: ${eq.depth_km} km ${eq.tsunami ? '· <b style="color:#ef4444;">TSUNAMI ALERT</b>' : ''}</p>
        </article>
      `;
    });

    setPanelHtml('earthquakes', html);
    bindCardFlyTo('intel-panel-earthquakes', 500000);
  }

  function renderWeatherPanel() {
    if (!weatherEvents.length) {
      setPanelHtml('weather', '<div class="intel-empty">Loading NASA severe weather events...</div>');
      return;
    }

    let html = `<div class="intel-stat">${weatherEvents.length} open natural events (NASA EONET)</div>`;

    weatherEvents.slice(0, 50).forEach(ev => {
      html += `
        <article class="intel-card" style="border-left: 3px solid #06b6d4; cursor:pointer;" data-lat="${ev.lat}" data-lon="${ev.lon}">
          <header class="intel-card-head">
            <h4 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${ev.title}</h4>
            <span class="intel-badge" style="background:#0891b2;color:white;">${ev.categories?.[0] || 'WEATHER'}</span>
          </header>
          <p class="intel-card-meta">${new Date(ev.date).toLocaleDateString()}</p>
        </article>
      `;
    });

    setPanelHtml('weather', html);
    bindCardFlyTo('intel-panel-weather', 800000);
  }

  function renderSpaceWeatherPanel() {
    const d = spaceWeatherData;
    if (!d) {
      setPanelHtml('space-weather', '<div class="intel-empty">Loading NOAA space weather data...</div>');
      return;
    }
    if (d.error) {
      setPanelHtml('space-weather', `<div class="intel-empty">NOAA SWPC unavailable: ${d.error}</div>`);
      return;
    }

    const kp = typeof d.kp_index === 'number' ? d.kp_index : null;
    const kpDisplay = kp !== null ? kp.toFixed(1) : 'N/A';
    const kpColor = kp === null ? '#94a3b8' : kp >= 7 ? '#ef4444' : kp >= 5 ? '#f97316' : kp >= 3 ? '#eab308' : '#22c55e';
    const kpLabel = d.storm_scale || 'UNKNOWN';
    const kpPct = kp !== null ? Math.min(100, (kp / 9) * 100) : 0;

    let html = `
      <div style="padding:12px; border-bottom:1px solid #1e293b;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <span style="color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:0.1em;">Kp Index (Geomagnetic)</span>
          <span style="color:${kpColor}; font-size:10px; font-weight:700; font-family:monospace;">${kpLabel}</span>
        </div>
        <div style="display:flex; align-items:baseline; gap:8px;">
          <span style="color:${kpColor}; font-size:48px; font-family:monospace; font-weight:900; line-height:1;">${kpDisplay}</span>
          <span style="color:#64748b; font-size:13px;">/ 9.0</span>
        </div>
        <div style="background:#0f172a; border-radius:4px; height:8px; margin-top:8px; overflow:hidden;">
          <div style="background:${kpColor}; height:100%; width:${kpPct}%; border-radius:4px; transition:width 0.5s;"></div>
        </div>
        <div style="color:#475569; font-size:10px; margin-top:6px;">Source: ${d.source || 'NOAA SWPC'} · Updated: ${new Date(d.timestamp || Date.now()).toUTCString()}</div>
      </div>
    `;

    if (d.solar_wind) {
      const sw = d.solar_wind;
      html += `
        <div style="padding:10px 12px; border-bottom:1px solid #1e293b;">
          <div style="color:#64748b; font-size:10px; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:6px;">Solar Wind (ACE/DSCOVR)</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <div style="background:#0f172a; border-radius:4px; padding:6px 8px;">
              <div style="color:#475569; font-size:10px;">Speed</div>
              <div style="color:#38bdf8; font-size:14px; font-weight:700; font-family:monospace;">${sw.speed_km_s != null ? sw.speed_km_s + ' km/s' : 'N/A'}</div>
            </div>
            <div style="background:#0f172a; border-radius:4px; padding:6px 8px;">
              <div style="color:#475569; font-size:10px;">Bz (nT)</div>
              <div style="color:${(sw.bz_nT || 0) < -10 ? '#ef4444' : '#22c55e'}; font-size:14px; font-weight:700; font-family:monospace;">${sw.bz_nT != null ? sw.bz_nT.toFixed(1) : 'N/A'}</div>
            </div>
            <div style="background:#0f172a; border-radius:4px; padding:6px 8px;">
              <div style="color:#475569; font-size:10px;">Density</div>
              <div style="color:#a78bfa; font-size:14px; font-weight:700; font-family:monospace;">${sw.density_p_cm3 != null ? sw.density_p_cm3.toFixed(1) + ' p/cc' : 'N/A'}</div>
            </div>
            <div style="background:#0f172a; border-radius:4px; padding:6px 8px;">
              <div style="color:#475569; font-size:10px;">Temp</div>
              <div style="color:#fb923c; font-size:14px; font-weight:700; font-family:monospace;">${sw.temp_K != null ? (sw.temp_K / 1000).toFixed(0) + 'k K' : 'N/A'}</div>
            </div>
          </div>
        </div>
      `;
    }

    const alerts = d.active_alerts || [];
    if (alerts.length) {
      html += `<div style="color:#f8fafc; font-size:10px; text-transform:uppercase; letter-spacing:0.1em; padding:8px 12px; border-bottom:1px solid #1e293b;">NOAA Active Alerts (${alerts.length})</div>`;
      alerts.forEach(alert => {
        const msg = alert.message || '';
        const severity = msg.includes('WARNING') ? '#f97316' : msg.includes('WATCH') ? '#eab308' : '#38bdf8';
        html += `
          <article class="intel-card" style="border-left:3px solid ${severity};">
            <header class="intel-card-head">
              <h4 style="color:${severity}; font-size:11px; font-family:monospace;">${alert.product_id || 'NOAA ALERT'}</h4>
              <span class="intel-badge" style="background:rgba(255,255,255,0.06);color:#94a3b8;">${alert.issue_datetime ? new Date(alert.issue_datetime).toLocaleDateString() : ''}</span>
            </header>
            <p class="intel-card-summary" style="font-size:10px; line-height:1.4; white-space:pre-wrap;">${msg.substring(0, 240)}${msg.length > 240 ? '...' : ''}</p>
          </article>
        `;
      });
    } else {
      html += `<div class="intel-card" style="border-left:3px solid #22c55e; padding:10px 12px;"><p style="color:#22c55e; font-size:12px; margin:0;">✓ No active space weather alerts from NOAA SWPC</p></div>`;
    }

    setPanelHtml('space-weather', html);
  }

  function renderGdeltPanel() {
    if (!gdeltEvents.length) {
      setPanelHtml('gdelt', '<div class="intel-empty">Loading GDELT global conflict monitor... (may take a moment)</div>');
      return;
    }

    let html = `<div class="intel-stat">${gdeltEvents.length} GDELT global news articles (conflict & unrest)</div>`;

    gdeltEvents.slice(0, 60).forEach((ev, i) => {
      const country = ev.source_country || 'GLOBAL';
      const seenDate = ev.seendate ? new Date(ev.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).toLocaleString() : '';
      html += `
        <article class="intel-card" style="border-left:3px solid #6366f1;">
          <header class="intel-card-head">
            <h4 style="font-size:11px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:195px;"><a href="${ev.url || '#'}" target="_blank" style="color:#f8fafc; text-decoration:none;">${ev.title || 'Global Event'}</a></h4>
          </header>
          <p class="intel-card-meta">${ev.source || 'Global Media'} · ${country} · ${seenDate}</p>
        </article>
      `;
    });

    setPanelHtml('gdelt', html);
  }

  function renderNewsPanel() {
    if (!newsArticles.length) {
      setPanelHtml('news', '<div class="intel-empty">Loading global news wire...</div>');
      return;
    }

    let html = `<div class="intel-stat">${newsArticles.length} international intelligence bulletins</div>`;

    newsArticles.slice(0, 40).forEach(art => {
      html += `
        <article class="intel-card" style="border-left: 3px solid #6366f1;">
          <header class="intel-card-head">
            <h4 style="font-size: 12px; line-height: 1.3;"><a href="${art.link}" target="_blank" style="color:#f8fafc; text-decoration:none;">${art.title}</a></h4>
          </header>
          <p class="intel-card-summary" style="font-size: 11px; color: #94a3b8; margin: 4px 0;">${art.description}</p>
          <p class="intel-card-meta" style="color:#818cf8;">${art.source} · ${new Date(art.pubDate).toLocaleTimeString()}</p>
        </article>
      `;
    });

    setPanelHtml('news', html);
  }

  function renderSanctionsPanel(sanctionsData) {
    const list = sanctionsData?.results || [];
    let html = `
      <div style="padding: 8px 12px; border-bottom: 1px solid #334155;">
        <input type="text" id="sanctionsSearchInput" placeholder="Search OFAC SDN individuals, vessels..." 
          value="${sanctionsData?.query || ''}"
          style="width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 6px 10px; color: #f8fafc; font-size: 11px; outline: none;" />
      </div>
      <div class="intel-stat">${list.length} matches (${sanctionsData?.source || 'OFAC SDN Directory'})</div>
    `;

    if (list.length === 0) {
      html += '<div class="intel-empty">No sanctioned entities match your query.</div>';
    } else {
      list.forEach(item => {
        html += `
          <article class="intel-card" style="border-left: 3px solid #dc2626;">
            <header class="intel-card-head">
              <h4 style="color: #f8fafc; font-size: 12px;">${item.name}</h4>
              <span class="intel-badge" style="background:#7f1d1d;color:#fca5a5;">${item.type || 'ENTITY'}</span>
            </header>
            <p class="intel-card-summary" style="font-size: 11px;">${item.remarks || item.program || 'Designated Target'}</p>
            <p class="intel-card-meta">${item.country || 'Unknown'} · Program: ${item.program || 'OFAC'}</p>
          </article>
        `;
      });
    }

    setPanelHtml('sanctions', html);

    const input = document.getElementById('sanctionsSearchInput');
    if (input) {
      input.focus();
      let debounce = null;
      input.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          loadSanctions(e.target.value);
        }, 300);
      });
    }
  }

  function renderMalwarePanel() {
    if (!malwareSamples.length) {
      setPanelHtml('malware', '<div class="intel-empty">Loading MalwareBazaar feed...</div>');
      return;
    }

    let html = `<div class="intel-stat">${malwareSamples.length} recent malware samples (abuse.ch)</div>`;

    malwareSamples.slice(0, 35).forEach(s => {
      html += `
        <article class="intel-card" style="border-left: 3px solid #e11d48;">
          <header class="intel-card-head">
            <h4 style="font-family: monospace; font-size: 11px; color:#fb7185;">${s.signature}</h4>
            <span class="intel-badge" style="background:#881337;color:#fecdd3;">${s.file_type_guess?.toUpperCase() || 'BIN'}</span>
          </header>
          <p class="intel-card-summary" style="font-family: monospace; font-size: 10px; word-break: break-all; color:#94a3b8;">${s.sha256_hash.substring(0, 32)}...</p>
          <p class="intel-card-meta">${s.file_name || 'sample'} · Reporter: ${s.reporter}</p>
        </article>
      `;
    });

    setPanelHtml('malware', html);
  }

  // ═════════════════════════════════════════════════════════════════
  // ─── PROGRESSIVE DATA FETCHING ───
  // ═════════════════════════════════════════════════════════════════

  async function loadCCTV() {
    try {
      const res = await fetch('/api/cctv');
      const data = await res.json();
      cameras = data.cameras || [];
      state.loaded.cctv = true;
      updateBadge('cctvCount', cameras.length);
      renderCCTVPanel();
      if (state.layers.cctv) renderCCTVsOnMap();
    } catch (e) {
      console.warn('[OSIRIS] CCTV fetch error:', e);
    }
  }

  async function loadCyber() {
    try {
      const [resThreats, resAttacks] = await Promise.all([
        fetch('/api/cyber-threats'),
        fetch('/api/cyber-attacks')
      ]);
      const dataThreats = await resThreats.json();
      cyberThreats = dataThreats || { threats: [] };
      const dataAttacks = await resAttacks.json();
      cyberAttacks = dataAttacks.indicators || [];
      state.loaded.cyber = true;
      updateBadge('cyberCount', cyberAttacks.length + (cyberThreats.threats?.length || 0));
      renderCyberPanel();
      if (state.layers.cyber) renderCyberAttacksOnMap();
    } catch (e) {
      console.warn('[OSIRIS] Cyber fetch error:', e);
    }
  }

  async function loadEarthquakes() {
    try {
      const res = await fetch('/api/earthquakes');
      const data = await res.json();
      earthquakes = data.earthquakes || [];
      state.loaded.earthquakes = true;
      updateBadge('earthquakesCount', earthquakes.length);
      renderEarthquakesPanel();
      if (state.layers.earthquakes) renderEarthquakesOnMap();
    } catch (e) {
      console.warn('[OSIRIS] Earthquakes fetch error:', e);
    }
  }

  async function loadWeather() {
    try {
      const res = await fetch('/api/weather-events');
      const data = await res.json();
      weatherEvents = data.events || [];
      state.loaded.weather = true;
      updateBadge('weatherCount', weatherEvents.length);
      renderWeatherPanel();
      if (state.layers.weather) renderWeatherEventsOnMap();
    } catch (e) {
      console.warn('[OSIRIS] Weather fetch error:', e);
    }
  }

  async function loadNews() {
    try {
      const res = await fetch('/api/news');
      const data = await res.json();
      newsArticles = data.articles || [];
      state.loaded.news = true;
      renderNewsPanel();
    } catch (e) {
      console.warn('[OSIRIS] News fetch error:', e);
    }
  }

  async function loadSanctions(query = '') {
    try {
      const res = await fetch(`/api/sanctions/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      state.loaded.sanctions = true;
      renderSanctionsPanel(data);
    } catch (e) {
      console.warn('[OSIRIS] Sanctions fetch error:', e);
    }
  }

  async function loadMalware() {
    try {
      const res = await fetch('/api/malware');
      const data = await res.json();
      malwareSamples = data.samples || [];
      state.loaded.malware = true;
      renderMalwarePanel();
    } catch (e) {
      console.warn('[OSIRIS] Malware fetch error:', e);
    }
  }

  async function loadSpaceWeather() {
    try {
      const res = await fetch('/api/space-weather');
      const data = await res.json();
      spaceWeatherData = data;
      state.loaded.spaceWeather = true;
      renderSpaceWeatherPanel();
    } catch (e) {
      console.warn('[OSIRIS] Space weather fetch error:', e);
    }
  }

  async function loadGdelt() {
    try {
      const res = await fetch('/api/gdelt-events');
      const data = await res.json();
      gdeltEvents = data.events || [];
      state.loaded.gdelt = true;
      renderGdeltPanel();
    } catch (e) {
      console.warn('[OSIRIS] GDELT fetch error:', e);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // ─── INITIALIZATION & TOGGLE BINDINGS ───
  // ═════════════════════════════════════════════════════════════════

  function initToggles() {
    // 1. CCTV Toggle
    const cctvToggle = document.getElementById('toggleCctvCameras');
    if (cctvToggle) {
      cctvToggle.addEventListener('change', (e) => {
        state.layers.cctv = e.target.checked;
        ensureDataSources();
        if (window.osirisCctvDataSource) window.osirisCctvDataSource.show = state.layers.cctv;
        if (state.layers.cctv) {
          if (!state.loaded.cctv) loadCCTV();
          else renderCCTVsOnMap();
        }
        getViewer()?.scene.requestRender();
      });
    }

    // 2. Cyber Toggle
    const cyberToggle = document.getElementById('toggleCyberAttacks');
    if (cyberToggle) {
      cyberToggle.addEventListener('change', (e) => {
        state.layers.cyber = e.target.checked;
        ensureDataSources();
        if (window.osirisCyberDataSource) window.osirisCyberDataSource.show = state.layers.cyber;
        if (state.layers.cyber) {
          if (!state.loaded.cyber) loadCyber();
          else renderCyberAttacksOnMap();
        }
        getViewer()?.scene.requestRender();
      });
    }

    // 3. Earthquakes Toggle
    const eqToggle = document.getElementById('toggleEarthquakes');
    if (eqToggle) {
      eqToggle.addEventListener('change', (e) => {
        state.layers.earthquakes = e.target.checked;
        ensureDataSources();
        if (window.osirisEarthquakesDataSource) window.osirisEarthquakesDataSource.show = state.layers.earthquakes;
        if (state.layers.earthquakes) {
          if (!state.loaded.earthquakes) loadEarthquakes();
          else renderEarthquakesOnMap();
        }
        getViewer()?.scene.requestRender();
      });
    }

    // 4. Weather Events Toggle
    const weatherToggle = document.getElementById('toggleWeatherEvents');
    if (weatherToggle) {
      weatherToggle.addEventListener('change', (e) => {
        state.layers.weather = e.target.checked;
        ensureDataSources();
        if (window.osirisWeatherDataSource) window.osirisWeatherDataSource.show = state.layers.weather;
        if (state.layers.weather) {
          if (!state.loaded.weather) loadWeather();
          else renderWeatherEventsOnMap();
        }
        getViewer()?.scene.requestRender();
      });
    }
  }

  function initTabsProgressiveLoading() {
    document.querySelectorAll('.intel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        if (tabName === 'earthquakes' && !state.loaded.earthquakes) loadEarthquakes();
        if (tabName === 'weather' && !state.loaded.weather) loadWeather();
        if (tabName === 'space-weather' && !state.loaded.spaceWeather) loadSpaceWeather();
        if (tabName === 'gdelt' && !state.loaded.gdelt) loadGdelt();
        if (tabName === 'news' && !state.loaded.news) loadNews();
        if (tabName === 'sanctions' && !state.loaded.sanctions) loadSanctions();
        if (tabName === 'malware' && !state.loaded.malware) loadMalware();
        if (tabName === 'cctv' && !state.loaded.cctv) loadCCTV();
        if (tabName === 'cyber' && !state.loaded.cyber) loadCyber();
      });
    });
  }

  function pollActiveLayers() {
    if (state.layers.cctv) loadCCTV();
    if (state.layers.cyber) loadCyber();
    if (state.layers.earthquakes) loadEarthquakes();
    if (state.layers.weather) loadWeather();
  }

  function boot() {
    // Initialize CCTV modal controls immediately (doesn't need Cesium)
    initCctvModalControls();

    const wait = setInterval(() => {
      if (!window.viewer || typeof Cesium === 'undefined') return;
      clearInterval(wait);
      ensureDataSources();
      initToggles();
      initTabsProgressiveLoading();

      // Pre-fetch initial counts for layer badges
      loadCCTV();
      loadCyber();
      loadEarthquakes();
      loadWeather();
      // Space weather & GDELT load on demand (tab click) to reduce startup load

      setInterval(pollActiveLayers, POLL_MS);
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
