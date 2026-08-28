/**
 * Cesium ion access token for optional terrain and OSM buildings.
 * Configure CESIUM_ION_TOKEN in the environment when those layers are needed.
 */
const DEFAULT_CESIUM_ION_TOKEN = process.env.CESIUM_ION_TOKEN || '';

function getCesiumIonToken() {
  return DEFAULT_CESIUM_ION_TOKEN;
}

module.exports = { DEFAULT_CESIUM_ION_TOKEN, getCesiumIonToken };
