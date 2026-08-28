const { haversineKm } = require('./haversine');
const { isMilitaryAircraft, isReconnaissanceAsset } = require('./recon-detection');

const MILITARY_AIRCRAFT_THRESHOLD = 3;

/**
 * Classify assets inside a crisis zone and apply breach rules.
 * @returns {{ triggered: boolean, triggerRules: string[], breaches: object }}
 */
function evaluateZoneThreat(zone, aircraft, satellites) {
  const { center, radius_km: radiusKm } = zone;
  const militaryBreaches = [];
  const reconBreaches = [];

  for (const ac of aircraft) {
    if (!isMilitaryAircraft(ac)) continue;
    const distanceKm = haversineKm(ac.lat, ac.lon, center.lat, center.lon);
    if (distanceKm > radiusKm) continue;
    militaryBreaches.push({
      entity_id: ac.id,
      entity_type: 'MILITARY_AIRCRAFT',
      callsign: ac.callsign,
      distance_km: roundKm(distanceKm),
      lat: ac.lat,
      lon: ac.lon,
      alt: ac.alt,
      asset_type: ac.type,
      subtype: ac.subtype,
    });
  }

  for (const sat of satellites) {
    if (!isReconnaissanceAsset(sat)) continue;
    const distanceKm = haversineKm(sat.lat, sat.lon, center.lat, center.lon);
    if (distanceKm > radiusKm) continue;
    reconBreaches.push({
      entity_id: sat.norad_id,
      entity_type: 'RECON_SATELLITE',
      name: sat.name,
      distance_km: roundKm(distanceKm),
      lat: sat.lat,
      lon: sat.lon,
      alt_km: sat.alt_km,
      asset_type: sat.type,
      subtype: sat.subtype,
    });
  }

  const triggerRules = [];
  if (militaryBreaches.length > MILITARY_AIRCRAFT_THRESHOLD) {
    triggerRules.push('MIL_AIRCRAFT_THRESHOLD_EXCEEDED');
  }
  if (reconBreaches.length > 0) {
    triggerRules.push('ACTIVE_RECON_SATELLITE_IN_ZONE');
  }

  const allBreaches = [...militaryBreaches, ...reconBreaches];

  return {
    triggered: triggerRules.length > 0,
    triggerRules,
    breaches: {
      military_aircraft: militaryBreaches,
      recon_satellites: reconBreaches,
      all: allBreaches,
      total_count: allBreaches.length,
    },
  };
}

function buildCriticalPayload(zone, evaluation) {
  const timestamp = new Date().toISOString();
  const { breaches, triggerRules } = evaluation;

  return {
    type: 'CRISIS_ZONE_THREAT',
    status: 'CRITICAL',
    timestamp,
    zone: {
      id: zone.id,
      name: zone.name,
      theater: zone.theater,
      center: zone.center,
      radius_km: zone.radius_km,
    },
    trigger_rules: triggerRules,
    breaching_entity_ids: breaches.all.map((b) => b.entity_id),
    breaching_entities: breaches.all.map((b) => ({
      id: b.entity_id,
      type: b.entity_type,
      distance_km: b.distance_km,
    })),
    breach_detail: {
      military_aircraft: breaches.military_aircraft,
      recon_satellites: breaches.recon_satellites,
      total_count: breaches.total_count,
    },
  };
}

function roundKm(km) {
  return Math.round(km * 10) / 10;
}

module.exports = {
  MILITARY_AIRCRAFT_THRESHOLD,
  evaluateZoneThreat,
  buildCriticalPayload,
};
