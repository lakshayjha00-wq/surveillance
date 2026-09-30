/**
 * OSIRIS Layers Integration for GODSEYE
 * Integrates CCTV cameras and Cyber Threats/Attacks onto the Cesium Globe.
 */

(function () {
  'use strict';

  const POLL_MS = 120_000;
  
  let cameras = [];
  let cyberAttacks = [];
  let cyberThreats = [];

  const state = {
    layers: { cctv: false, cyber: false }
  };

  function getViewer() {
    return window.viewer;
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

    window.osirisCctvDataSource.show = state.layers.cctv;
    window.osirisCyberDataSource.show = state.layers.cyber;

    return viewer;
  }

  // ─── Map Rendering ───

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
          font: '16px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000),
        },
        description: `
          <div style="font-family: monospace;">
            <b>${cam.name}</b><br/>
            Location: ${cam.city || 'Unknown'}, ${cam.country || 'Unknown'}<br/>
            Source: ${cam.source || 'Unknown'}<br/>
            Type: ${isVideo ? 'Live Video' : 'Snapshot'}<br/>
            ${cam.feed_url && !isVideo ? `<img src="${cam.feed_url}" style="width:100%; max-width:300px; margin-top:8px; border:1px solid #4fc3f7;" onerror="this.style.display='none'"/>` : ''}
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
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: '⚡',
          font: '18px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000000),
        },
        description: `
          <div style="font-family: monospace;">
            <b style="color: ${color};">CYBER THREAT INDICATOR</b><br/>
            IP: ${attack.ip}<br/>
            Port: ${attack.port || 'Unknown'}<br/>
            Malware: ${attack.malware || 'Unknown'}<br/>
            Status: ${attack.status.toUpperCase()}<br/>
            Location: ${attack.country || 'Unknown'}<br/>
            Last Online: ${attack.last_online || 'Unknown'}<br/>
          </div>
        `
      });
    });
    viewer.scene.requestRender();
  }

  // ─── Panel Rendering ───

  function setPanelHtml(tabId, html) {
    const el = document.getElementById(`intel-panel-${tabId}`);
    if (el) el.innerHTML = html;
  }

  function renderCCTVPanel() {
    if (!cameras.length) {
      setPanelHtml('cctv', '<div class="intel-empty">Loading CCTV feeds...</div>');
      return;
    }

    const videos = cameras.filter(c => c.stream_type === 'hls' || c.stream_type === 'iframe' || c.stream_url);
    const stills = cameras.filter(c => c.stream_type === 'jpg');

    let html = `<div class="intel-stat">${cameras.length} active feeds (${videos.length} live video, ${stills.length} snapshots)</div>`;
    
    cameras.slice(0, 100).forEach(cam => {
      const isVideo = cam.stream_type === 'hls' || cam.stream_type === 'iframe' || cam.stream_url;
      const typeBadge = isVideo 
        ? '<span class="intel-badge" style="background:#0284c7;color:white;">LIVE VIDEO</span>' 
        : '<span class="intel-badge" style="background:#475569;color:white;">SNAPSHOT</span>';
      
      html += `
        <article class="intel-card" style="border-left: 3px solid ${isVideo ? '#0ea5e9' : '#94a3b8'};" data-lat="${cam.lat}" data-lon="${cam.lng}">
          <header class="intel-card-head">
            <h4 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${cam.name}</h4>
            ${typeBadge}
          </header>
          <p class="intel-card-meta">${cam.city || 'Unknown'}, ${cam.country || 'Unknown'} · ${cam.source}</p>
        </article>
      `;
    });

    setPanelHtml('cctv', html);
    
    // Bind fly-to
    document.querySelectorAll('#intel-panel-cctv .intel-card').forEach(card => {
      card.addEventListener('click', () => {
        const lat = parseFloat(card.dataset.lat);
        const lon = parseFloat(card.dataset.lon);
        if (!isNaN(lat) && !isNaN(lon) && window.viewer) {
          window.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 10000),
            duration: 2
          });
        }
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
          <article class="intel-card" style="border-left: 3px solid ${isOnline ? '#f97316' : '#64748b'};" data-lat="${attack.lat}" data-lon="${attack.lng}">
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

    // Bind fly-to
    document.querySelectorAll('#intel-panel-cyber .intel-card[data-lat]').forEach(card => {
      card.addEventListener('click', () => {
        const lat = parseFloat(card.dataset.lat);
        const lon = parseFloat(card.dataset.lon);
        if (!isNaN(lat) && !isNaN(lon) && window.viewer) {
          window.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 2000000),
            duration: 2
          });
          
          // Switch to Cyber layer if not active
          const toggle = document.getElementById('toggleCyberAttacks');
          if (toggle && !toggle.checked) {
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
          }
        }
      });
    });
  }

  // ─── Data Fetching ───

  async function loadCCTV() {
    try {
      const res = await fetch('/api/cctv');
      const data = await res.json();
      cameras = data.cameras || [];
      renderCCTVPanel();
      renderCCTVsOnMap();
    } catch (e) {
      console.warn('[OSIRIS] CCTV fetch failed:', e);
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
      
      renderCyberPanel();
      renderCyberAttacksOnMap();
    } catch (e) {
      console.warn('[OSIRIS] Cyber feeds fetch failed:', e);
    }
  }

  // ─── Initialization ───

  function initToggles() {
    const cctvToggle = document.getElementById('toggleCctvCameras');
    if (cctvToggle) {
      cctvToggle.addEventListener('change', (e) => {
        state.layers.cctv = e.target.checked;
        ensureDataSources();
        if (window.osirisCctvDataSource) {
          window.osirisCctvDataSource.show = state.layers.cctv;
        }
        getViewer()?.scene.requestRender();
      });
    }

    const cyberToggle = document.getElementById('toggleCyberAttacks');
    if (cyberToggle) {
      cyberToggle.addEventListener('change', (e) => {
        state.layers.cyber = e.target.checked;
        ensureDataSources();
        if (window.osirisCyberDataSource) {
          window.osirisCyberDataSource.show = state.layers.cyber;
        }
        getViewer()?.scene.requestRender();
      });
    }
  }

  function boot() {
    const wait = setInterval(() => {
      if (!window.viewer || typeof Cesium === 'undefined') return;
      clearInterval(wait);
      ensureDataSources();
      initToggles();
      
      // Load data
      loadCCTV();
      loadCyber();
      
      setInterval(loadCCTV, POLL_MS);
      setInterval(loadCyber, POLL_MS);
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
