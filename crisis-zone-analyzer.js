/**
 * Crisis Zone Threat Analysis Engine
 *
 * Non-blocking setInterval loop: ingest telemetry → SQLite → query latest
 * snapshots → Haversine zone checks → CRITICAL payload → WebSocket broadcast.
 */

const { getCrisisZones } = require('./lib/crisis-zones');
const {
  initTelemetrySchema,
  fetchLatestAircraft,
  fetchLatestSatellites,
  upsertAircraftBatch,
  upsertSatelliteBatch,
  queryDb,
  execDb,
} = require('./lib/telemetry-db');
const { propagateSatellitesChunked } = require('./lib/satellite-propagation');
const { evaluateZoneThreat, buildCriticalPayload } = require('./lib/threat-evaluator');

const LOG = '[CRISIS-ANALYZER]';

class CrisisZoneAnalyzer {
  /**
   * @param {object} opts
   * @param {Function} opts.broadcastFn — (payload) => void, wired to WsThreatRelay
   * @param {Function} opts.getFlights — () => current flight array for snapshot ingest
   * @param {number} [opts.intervalMs=45000]
   */
  constructor({ broadcastFn, getFlights, intervalMs = 45_000 }) {
    if (typeof broadcastFn !== 'function') {
      throw new TypeError('broadcastFn is required');
    }
    if (typeof getFlights !== 'function') {
      throw new TypeError('getFlights is required');
    }

    this._broadcast = broadcastFn;
    this._getFlights = getFlights;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._running = false;
    this._zones = getCrisisZones();
  }

  async start() {
    await initTelemetrySchema();

    console.log(`${LOG} Running initial evaluation pass...`);
    await this._tick();

    this._timer = setInterval(() => {
      if (this._running) {
        console.log(`${LOG} Previous tick still in flight — skipping interval.`);
        return;
      }
      this._tick();
    }, this._intervalMs);

    if (this._timer.unref) this._timer.unref();

    console.log(
      `${LOG} Background loop active (every ${this._intervalMs / 1000}s, ` +
        `${this._zones.length} crisis zones)`
    );
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log(`${LOG} Evaluation loop stopped.`);
  }

  async _tick() {
    this._running = true;
    const tickStart = Date.now();

    try {
      await this._ingestTelemetry();

      const [aircraft, satellites] = await Promise.all([
        fetchLatestAircraft(),
        fetchLatestSatellites(),
      ]);

      console.log(
        `${LOG} Evaluating ${aircraft.length} aircraft + ` +
          `${satellites.length} satellites`
      );

      for (const zone of this._zones) {
        await this._processZone(zone, aircraft, satellites);
      }

      console.log(`${LOG} Pass completed in ${Date.now() - tickStart}ms`);
    } catch (err) {
      console.error(`${LOG} Tick failed: ${err.message}`);
    } finally {
      this._running = false;
    }
  }

  async _ingestTelemetry() {
    const ts = Date.now();
    const flights = this._getFlights() || [];
    await upsertAircraftBatch(flights, ts);
    await this._ingestSatellitePositions(ts);
  }

  async _ingestSatellitePositions(snapshotTs) {
    let tleRows;
    try {
      tleRows = await queryDb(
        'SELECT norad_id, name, tle1, tle2, type FROM satellites'
      );
    } catch (err) {
      console.error(`${LOG} TLE read failed: ${err.message}`);
      return;
    }

    if (!tleRows.length) return;

    const propagated = await propagateSatellitesChunked(tleRows, new Date());
    if (!propagated.length) return;

    await upsertSatelliteBatch(propagated, snapshotTs);
    const reconCount = propagated.filter((s) => s.is_recon).length;
    console.log(
      `${LOG} Snapshotted ${propagated.length} satellites (${reconCount} recon-flagged)`
    );
  }

  async _processZone(zone, aircraft, satellites) {
    const evaluation = evaluateZoneThreat(zone, aircraft, satellites);
    if (!evaluation.triggered) return;

    const payload = buildCriticalPayload(zone, evaluation);
    await this._persistAlert(zone, payload, evaluation);
    this._broadcast(payload);
  }

  async _persistAlert(zone, payload, evaluation) {
    const alertMinute = payload.timestamp.slice(0, 16);
    const alertId = `CZ-${zone.id}-${alertMinute}`;

    try {
      const existing = await queryDb(
        'SELECT 1 FROM tactical_alerts WHERE id = ?',
        [alertId]
      );
      if (existing.length > 0) return;

      const milCount = evaluation.breaches.military_aircraft.length;
      const reconCount = evaluation.breaches.recon_satellites.length;
      const summary =
        `CRITICAL: ${zone.name} — ${milCount} military aircraft, ` +
        `${reconCount} recon satellite(s) inside ${zone.radius_km}km radius`;

      await execDb(
        `INSERT INTO tactical_alerts (id, alert_type, summary, triggered_by_entity, timestamp, severity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          alertId,
          'CRISIS_ZONE_BREACH',
          summary,
          JSON.stringify(payload.trigger_rules),
          Date.now(),
          'CRITICAL',
        ]
      );

      console.warn(`${LOG} 🚨 ${summary}`);
    } catch (err) {
      console.error(`${LOG} Alert persist failed (${alertId}): ${err.message}`);
    }
  }

  static getZones() {
    return getCrisisZones();
  }
}

module.exports = { CrisisZoneAnalyzer };
