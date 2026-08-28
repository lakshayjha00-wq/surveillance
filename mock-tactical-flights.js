/**
 * AEGIS Tactical Simulation - Mock Military Flight Generator
 * Generates realistic, dynamic flight paths for testing military/tactical overlays.
 */

// Define strategic patrol zones with base coordinates
const PATROL_BASES = [
  { name: "Hindon AFB", lat: 28.7041, lon: 77.3586, callsigns: ["SHARK1", "SHARK2", "HAWK1"], type: "SU-30 MKI" },
  { name: "Ambala AFB", lat: 30.3708, lon: 76.8175, callsigns: ["RAFALE1", "RAFALE2", "TRIDENT"], type: "Rafale" },
  { name: "Sulur AFB", lat: 10.9902, lon: 77.1611, callsigns: ["TEJAS1", "TEJAS2", "LANCER"], type: "Tejas LCA" },
  { name: "Jodhpur AFB", lat: 26.2514, lon: 73.0483, callsigns: ["GARUDA1", "VULTURE", "FALCON"], type: "Jaguar IS" },
  { name: "Tezpur AFB", lat: 26.7119, lon: 92.7981, callsigns: ["PHANTOM", "DRAGON", "ARROW"], type: "SU-30 MKI" }
];

// In-memory state for active tactical simulation flights
let simulatedFlights = [];

function initSimulatedFlights() {
  simulatedFlights = PATROL_BASES.map((base, index) => {
    // Determine a flight pattern type: 0 = Orbit/CAP, 1 = Border Patrol, 2 = High-Speed Intercept
    const pattern = index % 3;
    return {
      id: `SIM-MIL-${1000 + index}`,
      callsign: base.callsigns[0],
      type: base.type,
      origin: base.name,
      baseLat: base.lat,
      baseLon: base.lon,
      lat: base.lat,
      lon: base.lon,
      alt: 9000 + (index * 1500), // Altitude in meters (approx 30,000 ft)
      velocity: 250 + (index * 50), // Velocity in m/s (approx Mach 0.8 - 1.2)
      track: Math.floor(Math.random() * 360),
      pattern: pattern,
      phase: Math.random() * Math.PI * 2, // Random starting point in path phase
      country: "TACTICAL / CLASSIFIED PATROL",
      isMilitary: true
    };
  });
}

/**
 * Updates coordinates of simulated flights along realistic military trajectories.
 * @param {number} deltaTimeSeconds Time elapsed since last update
 */
function updateSimulatedFlights(deltaTimeSeconds = 5) {
  if (simulatedFlights.length === 0) {
    initSimulatedFlights();
  }

  simulatedFlights.forEach(f => {
    f.phase += (f.velocity / 100000) * deltaTimeSeconds; // Increment orbital phase

    if (f.pattern === 0) {
      // 1. Combat Air Patrol (CAP) - Circular Orbiting Pattern
      const radius = 0.8; // degrees
      f.lat = f.baseLat + Math.sin(f.phase) * radius;
      f.lon = f.baseLon + Math.cos(f.phase) * radius;
      f.track = Math.round((CesiumToDegrees(Math.atan2(Math.cos(f.phase), -Math.sin(f.phase))) + 360) % 360);
    } 
    else if (f.pattern === 1) {
      // 2. Linear Border Reconnaissance - Figure 8 / Racetrack Pattern
      const width = 1.5;
      const height = 0.4;
      f.lat = f.baseLat + Math.sin(f.phase * 2) * height;
      f.lon = f.baseLon + Math.sin(f.phase) * width;
      
      // Approximate heading angle calculation
      const nextPhase = f.phase + 0.01;
      const nextLat = f.baseLat + Math.sin(nextPhase * 2) * height;
      const nextLon = f.baseLon + Math.sin(nextPhase) * width;
      f.track = Math.round((CesiumToDegrees(Math.atan2(nextLon - f.lon, nextLat - f.lat)) + 360) % 360);
    } 
    else {
      // 3. High-Speed Dash / Intercept - Rapid straight line and reposition
      const range = 2.0; // Max sweep offset
      const cycle = Math.sin(f.phase * 0.5);
      f.lat = f.baseLat + cycle * range;
      f.lon = f.baseLon + cycle * (range * 0.5);
      f.track = cycle >= 0 ? 45 : 225;
      f.velocity = cycle >= 0.8 || cycle <= -0.8 ? 180 : 450; // Supercruise velocity on straights
    }

    // Add slight altitude turbulence/adjustments (±15m)
    f.alt += (Math.random() - 0.5) * 30;
    f.alt = Math.max(3000, Math.min(f.alt, 18000)); // Cap between 10k ft and 60k ft
  });

  return simulatedFlights;
}

function CesiumToDegrees(rad) {
  return rad * (180 / Math.PI);
}

module.exports = {
  updateSimulatedFlights
};
