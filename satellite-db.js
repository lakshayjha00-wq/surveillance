const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const dbPath = path.join(__dirname, 'satellites.db');
const db = new sqlite3.Database(dbPath);

function initDB() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS satellites (
        norad_id TEXT PRIMARY KEY,
        name TEXT,
        tle1 TEXT,
        tle2 TEXT,
        type TEXT,
        last_updated INTEGER
      )
    `, (err) => {
      if (err) return reject(err);
      console.log('📦 Database ready: satellites.db');
      resolve();
    });
  });
}

function classifySatellite(name) {
  name = name.toUpperCase();
  if (name.includes('OBJECT') || name.includes('TIANGONG') || name.includes('ZARYA')) return 'SPACE_STATION';
  if (name.includes('STARLINK') || name.includes('ONEWEB') || name.includes('IRIDIUM')) return 'COMMERCIAL';
  if (name.includes('COSMOS') || name.includes('USA-') || name.includes('YAOGAN')) return 'MILITARY';
  if (name.includes('NOAA') || name.includes('METEOR') || name.includes('GOES')) return 'WEATHER';
  if (name.includes('INTELSAT') || name.includes('GALAXY') || name.includes('EUTELSAT')) return 'TELECOM';
  return 'SCIENTIFIC'; // Default fallback
}

async function fetchAndIngestCelesTrak() {
  console.log('📡 [DB] Fetching massive CelesTrak Active catalog...');
  try {
    const url = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const text = await response.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    const now = Date.now();
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO satellites (norad_id, name, tle1, tle2, type, last_updated) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      let count = 0;
      for (let i = 0; i < lines.length; i += 3) {
        if (lines[i] && lines[i+1] && lines[i+2]) {
          const name = lines[i];
          const tle1 = lines[i+1];
          const tle2 = lines[i+2];
          // Extract NORAD ID from TLE Line 1 (columns 3-7)
          const noradId = tle1.substring(2, 7).trim();
          const type = classifySatellite(name);
          
          stmt.run([noradId, name, tle1, tle2, type, now]);
          count++;
        }
      }
      
      stmt.finalize();
      db.run('COMMIT', () => {
        console.log(`✅ [DB] Successfully ingested ${count} satellites into local SQLite database.`);
      });
    });

  } catch (err) {
    console.error('❌ [DB] Failed to fetch CelesTrak:', err.message);
  }
}

function getAllSatellites() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT norad_id, name, tle1, tle2, type FROM satellites`, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Automatically sync DB periodically (every 12 hours)
setInterval(fetchAndIngestCelesTrak, 12 * 60 * 60 * 1000);

module.exports = {
  db,
  initDB,
  fetchAndIngestCelesTrak,
  getAllSatellites
};
