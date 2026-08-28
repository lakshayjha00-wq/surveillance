/**
 * Active global crisis flashpoints (May 2026 intelligence synthesis).
 * Coordinates derived from operational centers cited in ISW, Crisis Group,
 * and regional open-source reporting for high-intensity theaters.
 */

const CRISIS_ZONES = Object.freeze([
  {
    id: 'CZ-UKR-DONBAS',
    name: 'Ukraine / Donbas Front',
    theater: 'Eastern Ukraine contact line',
    intel_summary:
      'Attritional fighting along Donetsk–Luhansk–Zaporizhzhia; sustained Shahed/Gerbera drone and Kinzhal strikes on infrastructure (ISW, May 2026).',
    center: { lat: 48.15, lon: 37.8 },
    radius_km: 300,
  },
  {
    id: 'CZ-ISR-LEVANT',
    name: 'Israel / Levant Border',
    theater: 'Northern Israel & southern Lebanon corridor',
    intel_summary:
      'Post-Gaza ceasefire fragility; Litani zone, Golan, and western Syria remain active ISR and strike corridors (Crisis Group 2026 watchlist).',
    center: { lat: 33.2, lon: 35.6 },
    radius_km: 200,
  },
  {
    id: 'CZ-TWN-STRAIT',
    name: 'Taiwan Strait',
    theater: 'Median line & western ADIZ',
    intel_summary:
      'PLA blockade-style drills; repeated median-line crossings and warships within ~24 nm of Taiwan (May 2026 reporting).',
    center: { lat: 24.5, lon: 119.5 },
    radius_km: 250,
  },
  {
    id: 'CZ-RED-SEA',
    name: 'Red Sea / Bab al-Mandeb',
    theater: 'Maritime choke point & Houthi coast',
    intel_summary:
      'Resumed Houthi threats to shipping through Bab al-Mandeb after regional escalation; lane re-routing persists (2026 hotspots).',
    center: { lat: 13.5, lon: 43.3 },
    radius_km: 350,
  },
  {
    id: 'CZ-SDN-HORN',
    name: 'Sudan / Horn of Africa',
    theater: 'Khartoum & Nile corridor',
    intel_summary:
      'SAF–RSF civil war with regional spillover; heavy drone use around Khartoum and eastern supply routes (ICG 2026).',
    center: { lat: 15.6, lon: 32.55 },
    radius_km: 300,
  },
  {
    id: 'CZ-KOR-DMZ',
    name: 'Korean Peninsula DMZ',
    theater: 'DMZ & Seoul northern approaches',
    intel_summary:
      'Persistent DPRK missile tests and allied reinforcement cycles along the full DMZ strip (2026 defense outlook).',
    center: { lat: 37.95, lon: 126.98 },
    radius_km: 150,
  },
]);

function getCrisisZones() {
  return CRISIS_ZONES;
}

module.exports = { CRISIS_ZONES, getCrisisZones };
