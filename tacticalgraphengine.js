// TacticalGraphEngine.js
const { db } = require('./satellite-db');

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
async function evaluateEntityCrossCorrelation() {
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
              await triggerTacticalAlert(person, region, event, now);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[INTEL ENGINE ERROR] Processing cycle failed:', err.message);
  }
}

async function triggerTacticalAlert(person, region, event, timestamp) {
  const alertId = `ALT-${person.id}-${event.id}`;
  const duplicateCheck = await queryDb("SELECT 1 FROM tactical_alerts WHERE id = ?", [alertId]);
  if (duplicateCheck.length > 0) return;

  const summary = `CRITICAL INTERSECTION: Watchlist Entity [${person.name}] localized within Monitored Area [${region.name}] concurrently matching active event: "${event.description}"`;
  
  await executeDb(
    "INSERT INTO tactical_alerts (id, alert_type, summary, triggered_by_entity, timestamp, severity) VALUES (?, ?, ?, ?, ?, ?)",
    [alertId, 'ENTITY_CORRELATION', summary, person.id, timestamp, 'CRITICAL']
  );
  console.warn(`[🚨 THREAT DETECTION ALERT] ${summary}`);
}

// Helper Wrappers for DB operations
function queryDb(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)));
  });
}
function executeDb(sql, params = []) {
  return new Promise((res, rej) => {
    db.run(sql, params, (err) => (err ? rej(err) : res(true)));
  });
}

/**
 * Extracts the current Knowledge Graph state for a specific zone
 * Connecting News, Weather, Traffic, Conflicts, and calculating probabilities.
 */
async function extractKnowledgeGraph(zoneId) {
  const nodes = [];
  const edges = [];
  
  // Central Event Node (The Zone itself or a Tactical Alert)
  nodes.push({ id: `ZONE-${zoneId}`, label: `Crisis Zone\n${zoneId}`, group: 'zone', value: 20 });
  
  // Fetch latest data from pipelines
  const news = await queryDb("SELECT * FROM news_articles WHERE zone_id = ? ORDER BY timestamp DESC LIMIT 3", [zoneId]);
  const weather = await queryDb("SELECT * FROM weather_reports WHERE zone_id = ? ORDER BY timestamp DESC LIMIT 1", [zoneId]);
  const traffic = await queryDb("SELECT * FROM traffic_incidents WHERE zone_id = ? ORDER BY timestamp DESC LIMIT 3", [zoneId]);
  const conflict = await queryDb("SELECT * FROM conflict_assessments WHERE zone_id = ? ORDER BY timestamp DESC LIMIT 1", [zoneId]);
  
  // Add News Nodes
  news.forEach(n => {
    nodes.push({ id: n.id, label: `NEWS: ${n.headline.substring(0, 20)}...`, group: 'news', title: n.headline });
    edges.push({ from: n.id, to: `ZONE-${zoneId}`, label: 'reports on' });
  });
  
  // Add Weather
  let badWeather = false;
  weather.forEach(w => {
    nodes.push({ id: w.id, label: `WEATHER: ${w.condition}\nVis: ${Math.round(w.visibility_km)}km`, group: 'weather' });
    edges.push({ from: w.id, to: `ZONE-${zoneId}`, label: 'affects' });
    if (w.condition !== 'Clear') badWeather = true;
  });
  
  // Add Traffic
  let blockedTraffic = false;
  traffic.forEach(t => {
    nodes.push({ id: t.id, label: `TRAFFIC: ${t.status}\n${t.road_name}`, group: 'traffic' });
    edges.push({ from: t.id, to: `ZONE-${zoneId}`, label: 'impacts' });
    if (t.status.includes('Block') || t.status.includes('Military')) blockedTraffic = true;
  });
  
  // Add Conflict
  let highRisk = false;
  conflict.forEach(c => {
    nodes.push({ id: c.id, label: `INTEL: Risk ${c.risk_level}`, group: 'intel' });
    edges.push({ from: c.id, to: `ZONE-${zoneId}`, label: 'assesses' });
    if (c.risk_level === 'HIGH' || c.risk_level === 'CRITICAL') highRisk = true;
  });
  
  // CALCULATE PROBABILITY CONSEQUENCES
  if (badWeather && blockedTraffic) {
    const outcomeId = `OUTCOME-1-${zoneId}`;
    nodes.push({ id: outcomeId, label: 'OUTCOME:\nSupply Line\nDisruption', group: 'outcome', value: 15, color: '#ff9900' });
    edges.push({ from: `ZONE-${zoneId}`, to: outcomeId, label: 'Probability: 85%' });
  }
  
  if (highRisk && blockedTraffic) {
    const outcomeId = `OUTCOME-2-${zoneId}`;
    nodes.push({ id: outcomeId, label: 'OUTCOME:\nImminent\nEscalation', group: 'outcome', value: 15, color: '#ff4444' });
    edges.push({ from: `ZONE-${zoneId}`, to: outcomeId, label: 'Probability: 72%' });
  }

  if (badWeather && highRisk) {
    const outcomeId = `OUTCOME-3-${zoneId}`;
    nodes.push({ id: outcomeId, label: 'OUTCOME:\nLimited Air\nSupport', group: 'outcome', value: 15, color: '#ff9900' });
    edges.push({ from: `ZONE-${zoneId}`, to: outcomeId, label: 'Probability: 90%' });
  }

  return { nodes, edges };
}

module.exports = { initIntelSchema, evaluateEntityCrossCorrelation, extractKnowledgeGraph };