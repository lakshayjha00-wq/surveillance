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
} = require('./lib/telemetry-db');
const { propagateSatellitesChunked } = require('./lib/satellite-propagation');
const { evaluateZoneThreat, buildCriticalPayload } = require('./lib/threat-evaluator');
const { registerJob, runJob } = require('./lib/job-monitor');
const { persistAlert } = require('./lib/alert-workflow');

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
    this._zones = getCrisisZones();
  }

  async start() {
    await initTelemetrySchema();
    registerJob('crisis-zone-analysis', {
      name: 'Crisis-zone threat analysis',
      intervalMs: this._intervalMs
    });

    console.log(`${LOG} Running initial evaluation pass...`);
    await runJob('crisis-zone-analysis', () => this._tick()).catch(() => {});

    this._timer = setInterval(() => {
      runJob('crisis-zone-analysis', () => this._tick()).catch(() => {});
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
      throw err;
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
      throw err;
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
    const created = await this._persistAlert(zone, payload, evaluation);
    if (created) this._broadcast(payload);
  }

  async _persistAlert(zone, payload, evaluation) {
    const alertMinute = payload.timestamp.slice(0, 16);
    const alertId = `CZ-${zone.id}-${alertMinute}`;
    const milCount = evaluation.breaches.military_aircraft.length;
    const reconCount = evaluation.breaches.recon_satellites.length;
    const summary =
      `${payload.severity}: ${zone.name} — ${milCount} military aircraft, ` +
      `${reconCount} recon satellite(s) inside ${zone.radius_km}km radius`;

    payload.alert_id = alertId;
    payload.summary = summary;

    const created = await persistAlert({
      id: alertId,
      alertType: 'CRISIS_ZONE_BREACH',
      summary,
      triggeredBy: JSON.stringify(payload.trigger_rules),
      timestamp: Date.now(),
      severity: payload.severity,
      confidence: payload.confidence,
      confidenceBasis: payload.confidence_basis,
    });

    if (created) console.warn(`${LOG} ${summary}`);
    return created;
  }

  static getZones() {
    return getCrisisZones();
  }
}

module.exports = { CrisisZoneAnalyzer };
