const satellite = require('satellite.js');
const { isReconnaissanceAsset } = require('./recon-detection');

const SGP4_CHUNK_SIZE = 500;

/**
 * Propagate TLE catalog to geodetic coordinates; yields between chunks.
 * @param {Array} tleRows
 * @param {Date} now
 * @returns {Promise<Array>}
 */
function propagateSatellitesChunked(tleRows, now) {
  return new Promise((resolve) => {
    const results = [];
    let idx = 0;

    function processChunk() {
      const end = Math.min(idx + SGP4_CHUNK_SIZE, tleRows.length);

      for (; idx < end; idx++) {
        const row = tleRows[idx];
        try {
          const satrec = satellite.twoline2satrec(row.tle1, row.tle2);
          const posVel = satellite.propagate(satrec, now);
          if (!posVel.position || typeof posVel.position === 'boolean') continue;

          const gmst = satellite.gstime(now);
          const geo = satellite.eciToGeodetic(posVel.position, gmst);
          const lat = satellite.degreesLat(geo.latitude);
          const lon = satellite.degreesLong(geo.longitude);
          if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

          const position = {
            norad_id: row.norad_id,
            name: row.name,
            lat,
            lon,
            alt_km: geo.height,
            type: row.type || 'UNKNOWN',
            subtype: row.subtype || '',
            is_recon: 0,
            metadata_recon: 0,
          };

          if (isReconnaissanceAsset(position)) {
            position.is_recon = 1;
          }

          results.push(position);
        } catch {
          // corrupt TLE — skip
        }
      }

      if (idx < tleRows.length) {
        setImmediate(processChunk);
      } else {
        resolve(results);
      }
    }

    processChunk();
  });
}

module.exports = { propagateSatellitesChunked, SGP4_CHUNK_SIZE };
