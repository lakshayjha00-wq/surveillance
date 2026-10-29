// TacticalGraphEngine.js
const { db } = require('./satellite-db');
const { persistAlert } = require('./lib/alert-workflow');

/**
 * Ensures the intelligence matrix tables exist inside your SQLite database
 */
async function initIntelSchema(databaseInstance) {
  const conn = databaseInstance || db;
  if (!conn) {
    throw new Error("Database instance was not provided to initIntelSchema");
  }
  return new Promise((resolve, reject) => {
    conn.serialize(() => {
      // Tracked Watchlist Individuals
      conn.run(`CREATE TABLE IF NOT EXISTS tracked_persons (
        id TEXT PRIMARY KEY, name TEXT, risk_profile TEXT, 
        last_known_lat REAL, last_known_lon REAL, target_status TEXT
      )`, (err1) => {
        if (err1) return reject(err1);

        // Monitored Tactical Sectors/Fenced Areas
        conn.run(`CREATE TABLE IF NOT EXISTS monitored_regions (
          id TEXT PRIMARY KEY, name TEXT, boundary_type TEXT, 
          center_lat REAL, center_lon REAL, radius_km REAL, risk_threshold_level TEXT
        )`, (err2) => {
          if (err2) return reject(err2);

          // Field Event Ingestion Log
          conn.run(`CREATE TABLE IF NOT EXISTS reported_events (
            id TEXT PRIMARY KEY, event_type TEXT, description TEXT, 
            latitude REAL, longitude REAL, timestamp INTEGER, severity TEXT
          )`, (err3) => {
            if (err3) return reject(err3);

            // Combined Output Cross-Correlation Warnings
            conn.run(`CREATE TABLE IF NOT EXISTS tactical_alerts (
              id TEXT PRIMARY KEY, alert_type TEXT, summary TEXT, 
              triggered_by_entity TEXT, timestamp INTEGER, severity TEXT
            )`, (err4) => {
              if (err4) return reject(err4);
              resolve();
            });
          });
        });
      });
    });
  });
}

/**
 * Computes geographic distance using the Haversine formula
 */
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cross-references Watchlist locations against Active Events inside Fenced Sectors
 */
async function evaluateEntityCrossCorrelation({ notify } = {}) {
  console.log('[INTEL ENGINE] Running dot-connecting analysis pass...');
  const now = Date.now();
  const timeWindow = now - (24 * 60 * 60 * 1000); // Lookback limit: 24 Hours

  try {
    const highRiskPersons = await queryDb("SELECT * FROM tracked_persons WHERE target_status = 'WATCHLIST'");
    const monitoredRegions = await queryDb("SELECT * FROM monitored_regions");
    const recentEvents = await queryDb("SELECT * FROM reported_events WHERE timestamp >= ?", [timeWindow]);

    for (const person of highRiskPersons) {
      for (const region of monitoredRegions) {
        const personDist = getHaversineDistance(person.last_known_lat, person.last_known_lon, region.center_lat, region.center_lon);

        if (personDist <= region.radius_km) {
          for (const event of recentEvents) {
            const eventDist = getHaversineDistance(event.latitude, event.longitude, region.center_lat, region.center_lon);

            if (eventDist <= region.radius_km) {
              await triggerTacticalAlert(person, region, event, now, notify);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[INTEL ENGINE ERROR] Processing cycle failed:', err.message);
    throw err;
  }
}

async function triggerTacticalAlert(person, region, event, timestamp, notify) {
  const alertId = `ALT-${person.id}-${event.id}`;
  const severity = normalizeSeverity(event.severity);
  const summary = `${severity} INTERSECTION: Watchlist Entity [${person.name}] localized within Monitored Area [${region.name}] concurrently matching active event: "${event.description}"`;
  const confidenceBasis = 'One watchlist/event correlation rule matched; source reliability is not calibrated';
  const created = await persistAlert({
    id: alertId,
    alertType: 'ENTITY_CORRELATION',
    summary,
    triggeredBy: person.id,
    timestamp,
    severity,
    confidence: 'MODERATE',
    confidenceBasis,
  });
  if (!created) return;

  console.warn(`[THREAT DETECTION ALERT] ${summary}`);
  if (notify) {
    notify({
      type: 'ENTITY_CORRELATION_ALERT',
      alert_id: alertId,
      alert_type: 'ENTITY_CORRELATION',
      summary,
      severity,
      confidence: 'MODERATE',
      confidence_basis: confidenceBasis,
      status: 'OPEN',
      requires_operator_review: true,
      action_taken: false,
      timestamp,
      zone: {
        id: region.id,
        name: region.name,
        center: { lat: region.center_lat, lon: region.center_lon },
      },
    });
  }
}

function normalizeSeverity(value) {
  const severity = String(value || '').toUpperCase();
  if (severity === 'MODERATE') return 'MEDIUM';
  if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severity)) return severity;
  return 'HIGH';
}

// Helper Wrappers for DB operations
function queryDb(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)));
  });
}

function escapeGraphText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

/**
 * Extracts the current Knowledge Graph state for a specific zone
 * Connects source-attributed news, natural events, traffic, and conflict reports.
 */
async function extractKnowledgeGraph(zoneId) {
  const nodes = [];
  const edges = [];
  
  // Central Event Node (The Zone itself or a Tactical Alert)
  nodes.push({ id: `ZONE-${zoneId}`, label: `Crisis Zone\n${zoneId}`, group: 'zone', value: 20 });
  
  // Fetch latest data from pipelines
  const news = await queryDb("SELECT * FROM news_articles WHERE zone_id = ? AND source_url IS NOT NULL ORDER BY timestamp DESC LIMIT 3", [zoneId]);
  const weather = await queryDb("SELECT * FROM weather_reports WHERE zone_id = ? AND source_url IS NOT NULL ORDER BY timestamp DESC LIMIT 1", [zoneId]);
  const traffic = await queryDb("SELECT * FROM traffic_incidents WHERE zone_id = ? AND source_url IS NOT NULL ORDER BY timestamp DESC LIMIT 3", [zoneId]);
  const conflict = await queryDb("SELECT * FROM conflict_assessments WHERE zone_id = ? AND source_url IS NOT NULL ORDER BY timestamp DESC LIMIT 1", [zoneId]);
  
  // Add News Nodes
  news.forEach(n => {
    nodes.push({
      id: n.id,
      label: `NEWS: ${n.headline.substring(0, 20)}...`,
      group: 'news',
      title: `${escapeGraphText(n.headline)}\nSource: ${escapeGraphText(n.source)}\nLocation: ${escapeGraphText(n.location_precision)}\n${escapeGraphText(n.source_url)}`,
    });
    edges.push({ from: n.id, to: `ZONE-${zoneId}`, label: 'reports on' });
  });
  
  // Add geolocated natural hazards
  weather.forEach(w => {
    const eventName = w.event_title || w.condition || 'Natural event';
    nodes.push({
      id: w.id,
      label: `EVENT: ${eventName.substring(0, 24)}`,
      group: 'weather',
      title: `${escapeGraphText(eventName)}\nCategory: ${escapeGraphText(w.event_category || 'Unspecified')}\nSource: ${escapeGraphText(w.source)}\n${escapeGraphText(w.source_url)}`,
    });
    edges.push({ from: w.id, to: `ZONE-${zoneId}`, label: 'affects' });
  });
  
  // Add source-backed traffic observations when a provider is configured.
  traffic.forEach(t => {
    nodes.push({
      id: t.id,
      label: `TRAFFIC: ${t.status}\n${t.road_name}`,
      group: 'traffic',
      title: `Source: ${escapeGraphText(t.source)}\n${escapeGraphText(t.source_url)}`,
    });
    edges.push({ from: t.id, to: `ZONE-${zoneId}`, label: 'impacts' });
  });
  
  // Add reported events without inferring uncalibrated risk from headlines.
  conflict.forEach(c => {
    nodes.push({
      id: c.id,
      label: `EVENT: ${c.assessment_summary.substring(0, 24)}`,
      group: 'intel',
      title: `${escapeGraphText(c.assessment_summary)}\nAssessment: ${escapeGraphText(c.risk_level)}\nSource: ${escapeGraphText(c.source)}\nLocation: ${escapeGraphText(c.location_precision)}\n${escapeGraphText(c.source_url)}`,
    });
    edges.push({ from: c.id, to: `ZONE-${zoneId}`, label: 'assesses' });
  });

  return { nodes, edges };
}

module.exports = { initIntelSchema, evaluateEntityCrossCorrelation, extractKnowledgeGraph };