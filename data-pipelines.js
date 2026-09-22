const { db } = require('./satellite-db');
const { getCrisisZones } = require('./lib/crisis-zones');

// Sample mock data pools
const NEWS_HEADLINES = [
    "Border Tensions Escalate Near Sector Alpha",
    "Unidentified Aircraft Spotted Entering Restricted Airspace",
    "Local Supply Chains Disrupted by Roadblocks",
    "Military Movements Reported in Northern Regions",
    "Diplomatic Talks Stall as Troops Mobilize",
    "Civilian Evacuations Ordered Near Conflict Zone"
];

const WEATHER_CONDITIONS = ["Clear", "Heavy Rain", "Dense Fog", "Sandstorm", "Thunderstorm", "Snowstorm"];
const TRAFFIC_STATUS = ["Flowing", "Moderate Congestion", "Heavy Congestion", "Roadblock", "Military Checkpoint"];

function initPipelinesSchema() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS news_articles (
                id TEXT PRIMARY KEY, zone_id TEXT, headline TEXT, source TEXT, timestamp INTEGER,
                lat REAL, lon REAL
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS weather_reports (
                id TEXT PRIMARY KEY, zone_id TEXT, condition TEXT, visibility_km REAL, temp_c REAL, timestamp INTEGER,
                lat REAL, lon REAL
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS traffic_incidents (
                id TEXT PRIMARY KEY, zone_id TEXT, status TEXT, road_name TEXT, timestamp INTEGER,
                lat REAL, lon REAL
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS conflict_assessments (
                id TEXT PRIMARY KEY, zone_id TEXT, assessment_summary TEXT, risk_level TEXT, timestamp INTEGER,
                lat REAL, lon REAL
            )`);
            
            // Adding a general event graph edge table for connecting entities
            db.run(`CREATE TABLE IF NOT EXISTS graph_edges (
                id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation_type TEXT, timestamp INTEGER, weight REAL
            )`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function jitter(coord) {
    return coord + (Math.random() * 0.1 - 0.05); // +/- ~5km
}

async function simulateDataForZone(zone) {
    const now = Date.now();
    const lat = zone.center ? zone.center.lat || zone.center[0] : 28.6;
    const lon = zone.center ? zone.center.lon || zone.center[1] : 77.2;
    const zId = zone.id;

    const newsId = `NEWS-${zId}-${now}`;
    const headline = getRandom(NEWS_HEADLINES);
    
    const weatherId = `WTH-${zId}-${now}`;
    const condition = getRandom(WEATHER_CONDITIONS);
    
    const trafficId = `TRF-${zId}-${now}`;
    const trafficStatus = getRandom(TRAFFIC_STATUS);
    
    const conflictId = `CFL-${zId}-${now}`;
    const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const risk = getRandom(riskLevels);
    
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run("INSERT INTO news_articles (id, zone_id, headline, source, timestamp, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [newsId, zId, headline, "Reuters Mock", now, jitter(lat), jitter(lon)]);
            
            db.run("INSERT INTO weather_reports (id, zone_id, condition, visibility_km, temp_c, timestamp, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [weatherId, zId, condition, Math.random() * 10, Math.random() * 40, now, jitter(lat), jitter(lon)]);
            
            db.run("INSERT INTO traffic_incidents (id, zone_id, status, road_name, timestamp, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [trafficId, zId, trafficStatus, `Highway ${Math.floor(Math.random()*100)}`, now, jitter(lat), jitter(lon)]);
            
            db.run("INSERT INTO conflict_assessments (id, zone_id, assessment_summary, risk_level, timestamp, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [conflictId, zId, `Aggregated analytical report indicates ${risk} threat environment`, risk, now, jitter(lat), jitter(lon)]);
                
            resolve();
        });
    });
}

let generatorTimer = null;
function startPipelineGenerator() {
    console.log('[PIPELINES] Starting simulated data pipeline ingestion...');
    const zones = getCrisisZones();
    
    generatorTimer = setInterval(async () => {
        // Randomly pick a zone to simulate data for
        if (zones.length > 0) {
            const zone = getRandom(zones);
            await simulateDataForZone(zone);
        }
    }, 15000); // generate new data every 15s
}

module.exports = {
    initPipelinesSchema,
    startPipelineGenerator
};
