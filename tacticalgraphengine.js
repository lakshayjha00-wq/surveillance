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

module.exports = { initIntelSchema, evaluateEntityCrossCorrelation };