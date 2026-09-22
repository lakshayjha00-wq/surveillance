const { db } = require('./satellite-db');
const { getCrisisZones } = require('./lib/crisis-zones');

const fetch = require('node-fetch');

// Sample mock data pools (used as fallback)
const FALLBACK_HEADLINES = [
    "Border Tensions Escalate Near Sector Alpha",
    "Unidentified Aircraft Spotted Entering Restricted Airspace",
    "Local Supply Chains Disrupted by Roadblocks",
    "Military Movements Reported in Northern Regions",
    "Diplomatic Talks Stall as Troops Mobilize",
    "Civilian Evacuations Ordered Near Conflict Zone"
];

const WEATHER_CONDITIONS = ["Clear", "Heavy Rain", "Dense Fog", "Sandstorm", "Thunderstorm", "Snowstorm"];
const TRAFFIC_STATUS = ["Flowing", "Moderate Congestion", "Heavy Congestion", "Roadblock", "Military Checkpoint"];

const RSS_FEEDS = [
    { source: 'BBC', url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
    { source: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
    { source: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { source: 'CNN', url: 'http://rss.cnn.com/rss/edition_world.rss' }
];

async function fetchLiveNews() {
    const feed = getRandom(RSS_FEEDS);
    try {
        const response = await fetch(feed.url, { timeout: 8000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml = await response.text();
        
        // Simple regex to extract <title> tags (ignoring the first one which is usually the channel title)
        const titleRegex = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g;
        let match;
        const titles = [];
        while ((match = titleRegex.exec(xml)) !== null) {
            if (match[1] && !match[1].includes('CNN.com') && !match[1].includes('NYT >') && !match[1].includes('BBC News')) {
                titles.push(match[1].trim());
            }
        }
        
        if (titles.length > 0) {
            return { headline: getRandom(titles), source: feed.source };
        }
    } catch (e) {
        console.error(`[PIPELINES] Failed to fetch news from ${feed.source}:`, e.message);
    }
    
    // Fallback
    return { headline: getRandom(FALLBACK_HEADLINES), source: 'Unknown (Fallback)' };
}

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
    const liveNews = await fetchLiveNews();
    const headline = liveNews.headline;
    const newsSource = liveNews.source;
    
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
                [newsId, zId, headline, newsSource, now, jitter(lat), jitter(lon)]);
            
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
