const { db } = require('../satellite-db');

const LOG = '[TELEMETRY-DB]';

function queryDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function execDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function execDbSerialize(fn) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      try {
        fn();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function tableHasColumn(table, column) {
  const cols = await queryDb(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

async function ensureColumn(table, column, definition) {
  if (await tableHasColumn(table, column)) return;
  await execDb(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`${LOG} Migrated ${table}: added column ${column}`);
}

async function migrateTelemetrySchema() {
  await ensureColumn('aircraft_positions', 'subtype', 'TEXT');
  await ensureColumn('aircraft_positions', 'metadata_recon', 'INTEGER DEFAULT 0');
  await ensureColumn('satellite_coordinates', 'subtype', 'TEXT');
  await ensureColumn('satellite_coordinates', 'metadata_recon', 'INTEGER DEFAULT 0');
}

async function initTelemetrySchema() {
  await execDb(`
    CREATE TABLE IF NOT EXISTS aircraft_positions (
      id TEXT PRIMARY KEY,
      callsign TEXT,
      lat REAL,
      lon REAL,
      alt REAL,
      velocity REAL,
      track REAL,
      is_military INTEGER DEFAULT 0,
      type TEXT,
      subtype TEXT,
      metadata_recon INTEGER DEFAULT 0,
      source TEXT,
      snapshot_ts INTEGER
    )
  `);

  await execDb(`
    CREATE TABLE IF NOT EXISTS satellite_coordinates (
      norad_id TEXT PRIMARY KEY,
      name TEXT,
      lat REAL,
      lon REAL,
      alt_km REAL,
      type TEXT,
      subtype TEXT,
      is_recon INTEGER DEFAULT 0,
      metadata_recon INTEGER DEFAULT 0,
      snapshot_ts INTEGER
    )
  `);

  await migrateTelemetrySchema();

  console.log(`${LOG} aircraft_positions & satellite_coordinates ready.`);
}

/** Latest aircraft snapshot rows (one row per id via INSERT OR REPLACE). */
async function fetchLatestAircraft() {
  return queryDb(`
    SELECT id, callsign, lat, lon, alt, velocity, track,
           is_military, type, subtype, metadata_recon, source, snapshot_ts
    FROM aircraft_positions
    WHERE lat IS NOT NULL AND lon IS NOT NULL
  `);
}

/** Latest propagated satellite snapshot rows. */
async function fetchLatestSatellites() {
  return queryDb(`
    SELECT norad_id, name, lat, lon, alt_km, type, subtype,
           is_recon, metadata_recon, snapshot_ts
    FROM satellite_coordinates
    WHERE lat IS NOT NULL AND lon IS NOT NULL
  `);
}

async function upsertAircraftBatch(flights, snapshotTs) {
  if (!flights?.length) return 0;

  let written = 0;
  await execDbSerialize(() => {
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO aircraft_positions
      (id, callsign, lat, lon, alt, velocity, track, is_military, type, subtype, metadata_recon, source, snapshot_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const f of flights) {
      if (f.lat == null || f.lon == null) continue;
      const metadataRecon =
        f.metadataRecon || f.metadata?.recon || f.metadata?.isRecon ? 1 : 0;
      stmt.run([
        f.id,
        f.callsign || '',
        f.lat,
        f.lon,
        f.alt || 0,
        f.velocity || 0,
        f.track || 0,
        f.isMilitary ? 1 : 0,
        f.type || '',
        f.subtype || f.category || '',
        metadataRecon,
        f.source || '',
        snapshotTs,
      ]);
      written += 1;
    }

    stmt.finalize();
    db.run('COMMIT');
  });

  return written;
}

async function upsertSatelliteBatch(positions, snapshotTs) {
  if (!positions?.length) return 0;

  await execDbSerialize(() => {
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO satellite_coordinates
      (norad_id, name, lat, lon, alt_km, type, subtype, is_recon, metadata_recon, snapshot_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of positions) {
      stmt.run([
        s.norad_id,
        s.name,
        s.lat,
        s.lon,
        s.alt_km,
        s.type,
        s.subtype || '',
        s.is_recon ? 1 : 0,
        s.metadata_recon ? 1 : 0,
        snapshotTs,
      ]);
    }

    stmt.finalize();
    db.run('COMMIT');
  });

  return positions.length;
}

module.exports = {
  queryDb,
  execDb,
  execDbSerialize,
  initTelemetrySchema,
  fetchLatestAircraft,
  fetchLatestSatellites,
  upsertAircraftBatch,
  upsertSatelliteBatch,
};
