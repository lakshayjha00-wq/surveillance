/** Name / subtype fragments indicating ISR, SIGINT, or IMINT platforms. */
const RECON_NAME_TAGS = Object.freeze([
  'USA-',
  'YAOGAN',
  'COSMOS',
  'LACROSSE',
  'KEYHOLE',
  'NROL',
  'INTRUDER',
  'MISTY',
  'ONYX',
  'MENTOR',
  'TRUMPET',
  'ORION',
  'MERCURY',
  'NEMESIS',
]);

const RECON_SUBTYPES = Object.freeze([
  'ISR',
  'SIGINT',
  'IMINT',
  'ELINT',
  'RECON',
  'SPYSAT',
]);

/**
 * @param {object} asset — row from aircraft_positions or satellite_coordinates
 * @returns {boolean}
 */
function isReconnaissanceAsset(asset) {
  if (!asset) return false;
  if (asset.is_recon === 1 || asset.is_recon === true) return true;
  if (asset.metadata_recon === 1 || asset.metadata_recon === true) return true;

  const subtype = String(asset.subtype || '').toUpperCase();
  if (RECON_SUBTYPES.some((tag) => subtype.includes(tag))) return true;

  const name = String(asset.name || asset.callsign || '').toUpperCase();
  return RECON_NAME_TAGS.some((tag) => name.includes(tag));
}

/**
 * @param {object} asset
 * @returns {boolean}
 */
function isMilitaryAircraft(asset) {
  return asset.is_military === 1 || asset.is_military === true;
}

module.exports = {
  RECON_NAME_TAGS,
  RECON_SUBTYPES,
  isReconnaissanceAsset,
  isMilitaryAircraft,
};
