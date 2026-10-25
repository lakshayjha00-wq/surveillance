const crypto = require('crypto');
const { db } = require('./satellite-db');
const { getCrisisZones } = require('./lib/crisis-zones');
const { haversineKm } = require('./lib/haversine');
const { registerJob, runJob } = require('./lib/job-monitor');
const { getGdeltEvents, getNewsFeed, getWeatherEvents } = require('./lib/osiris-feeds');

const INGESTION_INTERVAL_MS = 10 * 60 * 1000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PIPELINE_FEEDS = [
  { id: 'rss-news-feed', name: 'RSS news feed', fetch: getNewsFeed },
  { id: 'nasa-eonet-feed', name: 'NASA EONET feed', fetch: getWeatherEvents },
  { id: 'gdelt-conflict-feed', name: 'GDELT conflict feed', fetch: getGdeltEvents },
];

const ZONE_KEYWORDS = {
  'CZ-UKR-DONBAS': ['ukraine', 'donbas', 'donetsk', 'luhansk', 'zaporizhzhia'],
  'CZ-ISR-LEVANT': ['israel', 'lebanon', 'levant', 'golan', 'litani'],
  'CZ-TWN-STRAIT': ['taiwan', 'taiwan strait', 'pla', 'median line'],
  'CZ-RED-SEA': ['red sea', 'bab al-mandeb', 'houthi', 'yemen'],
  'CZ-SDN-HORN': ['sudan', 'khartoum', 'rsf', 'saf'],
  'CZ-KOR-DMZ': ['korean peninsula', 'north korea', 'south korea', 'dmz', 'dprk'],
};

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function queryDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function ensureColumn(table, name, definition) {
  const columns = await queryDb(`PRAGMA table_info(${table})`);
  if (columns.some((column) => column.name === name)) return;
  await runDb(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

async function initPipelinesSchema() {
  const schema = [
    `CREATE TABLE IF NOT EXISTS news_articles (
      id TEXT PRIMARY KEY, zone_id TEXT, headline TEXT, source TEXT, timestamp INTEGER,
      lat REAL, lon REAL, source_url TEXT, location_precision TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS weather_reports (
      id TEXT PRIMARY KEY, zone_id TEXT, condition TEXT, visibility_km REAL, temp_c REAL, timestamp INTEGER,
      lat REAL, lon REAL, event_title TEXT, event_category TEXT, source TEXT, source_url TEXT,
      location_precision TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS traffic_incidents (
      id TEXT PRIMARY KEY, zone_id TEXT, status TEXT, road_name TEXT, timestamp INTEGER,
      lat REAL, lon REAL, source TEXT, source_url TEXT, location_precision TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS conflict_assessments (
      id TEXT PRIMARY KEY, zone_id TEXT, assessment_summary TEXT, risk_level TEXT, timestamp INTEGER,
      lat REAL, lon REAL, source TEXT, source_url TEXT, location_precision TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation_type TEXT, timestamp INTEGER, weight REAL
    )`,
  ];

  for (const statement of schema) await runDb(statement);

  const migrations = {
    news_articles: [
      ['source_url', 'TEXT'],
      ['location_precision', 'TEXT'],
    ],
    weather_reports: [
      ['event_title', 'TEXT'],
      ['event_category', 'TEXT'],
      ['source', 'TEXT'],
      ['source_url', 'TEXT'],
      ['location_precision', 'TEXT'],
    ],
    traffic_incidents: [
      ['source', 'TEXT'],
      ['source_url', 'TEXT'],
      ['location_precision', 'TEXT'],
    ],
    conflict_assessments: [
      ['source', 'TEXT'],
      ['source_url', 'TEXT'],
      ['location_precision', 'TEXT'],
    ],
  };

  for (const [table, columns] of Object.entries(migrations)) {
    for (const [name, definition] of columns) {
      await ensureColumn(table, name, definition);
    }
  }
}

function stableId(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function parseTimestamp(value) {
  if (!value) return null;
  const gdeltDate = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(String(value));
  if (gdeltDate) {
    const parsed = Date.UTC(
        Number(gdeltDate[1]),
        Number(gdeltDate[2]) - 1,
        Number(gdeltDate[3]),
        Number(gdeltDate[4]),
        Number(gdeltDate[5]),
        Number(gdeltDate[6])
      );
    const date = new Date(parsed);
    if (
      date.getUTCFullYear() !== Number(gdeltDate[1]) ||
      date.getUTCMonth() !== Number(gdeltDate[2]) - 1 ||
      date.getUTCDate() !== Number(gdeltDate[3]) ||
      date.getUTCHours() !== Number(gdeltDate[4]) ||
      date.getUTCMinutes() !== Number(gdeltDate[5]) ||
      date.getUTCSeconds() !== Number(gdeltDate[6])
    ) return null;
    return parsed;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchingZones(text, zones) {
  const normalized = String(text || '').toLowerCase();
  return zones.filter((zone) => (ZONE_KEYWORDS[zone.id] || []).some((keyword) => {
    if (keyword.length <= 4) {
      return new RegExp(`\\b${keyword}\\b`).test(normalized);
    }
    return normalized.includes(keyword);
  }));
}

function isRecent(timestamp, now) {
  return timestamp !== null && timestamp <= now && now - timestamp <= MAX_EVENT_AGE_MS;
}

async function insertNewsArticles(feed, zones, now) {
  let inserted = 0;
  for (const article of feed?.articles || []) {
    const timestamp = parseTimestamp(article.pubDate);
    if (!article.title || !article.link || !isRecent(timestamp, now)) continue;

    for (const zone of matchingZones(`${article.title} ${article.description || ''}`, zones)) {
      const id = stableId('NEWS', `${article.link}:${zone.id}`);
      const result = await runDb(
        `INSERT OR IGNORE INTO news_articles
          (id, zone_id, headline, source, timestamp, lat, lon, source_url, location_precision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          zone.id,
          article.title,
          article.source || 'RSS',
          timestamp,
          zone.center.lat,
          zone.center.lon,
          article.link,
          'ZONE_CENTROID_KEYWORD_MATCH',
        ]
      );
      inserted += result.changes;
    }
  }
  return inserted;
}

async function insertWeatherEvents(feed, zones, now) {
  if (feed?.degraded) return 0;

  let inserted = 0;
  for (const event of feed?.events || []) {
    const timestamp = parseTimestamp(event.date);
    if (
      event.lat == null ||
      event.lon == null ||
      !Number.isFinite(Number(event.lat)) ||
      !Number.isFinite(Number(event.lon)) ||
      !isRecent(timestamp, now)
    ) continue;

    const eventZones = zones.filter((zone) =>
      haversineKm(Number(event.lat), Number(event.lon), zone.center.lat, zone.center.lon) <= zone.radius_km
    );

    for (const zone of eventZones) {
      const sourceUrl = event.link || event.sources?.[0]?.url;
      if (!sourceUrl) continue;
      const id = stableId('WTH', `${event.id}:${zone.id}`);
      const categories = Array.isArray(event.categories) ? event.categories : [];
      const result = await runDb(
        `INSERT OR IGNORE INTO weather_reports
          (id, zone_id, condition, visibility_km, temp_c, timestamp, lat, lon,
           event_title, event_category, source, source_url, location_precision)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          zone.id,
          categories.join(', ') || event.title || 'Natural event',
          timestamp,
          Number(event.lat),
          Number(event.lon),
          event.title || '',
          categories.join(', '),
          feed.source || 'NASA EONET',
          sourceUrl,
          'EVENT_COORDINATE',
        ]
      );
      inserted += result.changes;
    }
  }
  return inserted;
}

async function insertConflictEvents(feed, zones, now) {
  if (feed?.degraded) return 0;

  let inserted = 0;
  for (const event of feed?.events || []) {
    const timestamp = parseTimestamp(event.seendate);
    if (!event.title || !event.url || !isRecent(timestamp, now)) continue;

    for (const zone of matchingZones(event.title, zones)) {
      const id = stableId('CFL', `${event.url}:${zone.id}`);
      const result = await runDb(
        `INSERT OR IGNORE INTO conflict_assessments
          (id, zone_id, assessment_summary, risk_level, timestamp, lat, lon,
           source, source_url, location_precision)
         VALUES (?, ?, ?, 'UNASSESSED', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          zone.id,
          event.title,
          timestamp,
          zone.center.lat,
          zone.center.lon,
          `GDELT${event.source ? ` / ${event.source}` : ''}`,
          event.url,
          'ZONE_CENTROID_KEYWORD_MATCH',
        ]
      );
      inserted += result.changes;
    }
  }
  return inserted;
}

async function ingestSourceBackedData(zones = getCrisisZones()) {
  const now = Date.now();
  const sources = await Promise.allSettled(PIPELINE_FEEDS.map(({ id, fetch }) =>
    runJob(id, async () => {
      const result = await fetch();
      const count = result?.count ?? result?.articles?.length ?? result?.events?.length ?? 0;
      const status = result?.degraded ? 'degraded' : 'healthy';
      return {
        ...result,
        detail: `${count} records returned; feed status ${status}${result?.error ? `: ${result.error}` : ''}`,
      };
    })
  ));
  const failures = [];
  const [newsResult, weatherResult, gdeltResult] = sources.map((result, index) => {
    const { name } = PIPELINE_FEEDS[index];
    if (result.status === 'rejected') {
      failures.push(`${name} fetch failed: ${result.reason?.message || result.reason}`);
      return null;
    }
    if (result.value?.degraded) {
      failures.push(result.value.error
        ? `${name}: ${result.value.error}`
        : `${name} returned degraded data`);
    }
    return result.value;
  });

  const [newsInserted, weatherInserted, conflictInserted] = await Promise.all([
    insertNewsArticles(newsResult, zones, now),
    insertWeatherEvents(weatherResult, zones, now),
    insertConflictEvents(gdeltResult, zones, now),
  ]);

  failures.push('Traffic incidents not ingested: no live traffic-incident provider is configured');
  const detail =
    `Inserted ${newsInserted} news, ${weatherInserted} NASA natural-event, and ` +
    `${conflictInserted} GDELT conflict-event records. ${failures.join('; ')}`;

  return { degraded: true, detail };
}

let ingestionTimer = null;

function startPipelineIngestion() {
  if (ingestionTimer) return;
  console.log('[PIPELINES] Starting source-backed ingestion for news, natural events, and conflict coverage.');
  registerJob('source-backed-pipeline-ingestion', {
    name: 'Source-backed pipeline ingestion',
    intervalMs: INGESTION_INTERVAL_MS,
  });
  for (const { id, name } of PIPELINE_FEEDS) {
    registerJob(id, { name, intervalMs: INGESTION_INTERVAL_MS });
  }

  runJob('source-backed-pipeline-ingestion', () => ingestSourceBackedData())
    .catch(() => {});
  ingestionTimer = setInterval(() => {
    runJob('source-backed-pipeline-ingestion', () => ingestSourceBackedData())
      .catch(() => {});
  }, INGESTION_INTERVAL_MS);
}

module.exports = {
  initPipelinesSchema,
  startPipelineIngestion,
  ingestSourceBackedData,
  matchingZones,
  parseTimestamp,
};
