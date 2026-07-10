const { Pool } = require('pg');

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Neon requires TLS; this trusts Neon's cert chain
  });
}

const READY = (async () => {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staircase_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      payload JSONB NOT NULL
    );
  `);
})();

async function logEvent(payload) {
  if (!pool) return; // logging disabled — no DATABASE_URL configured
  await READY;
  try {
    await pool.query('INSERT INTO staircase_events (payload) VALUES ($1)', [payload]);
  } catch (err) {
    console.error('[db] failed to log event:', err.message);
  }
}

async function recentEvents(limit = 100) {
  if (!pool) return [];
  await READY;
  const { rows } = await pool.query(
    'SELECT id, received_at, payload FROM staircase_events ORDER BY id DESC LIMIT $1',
    [limit]
  );
  return rows;
}

// ---------------------------------------------------------------
// CSV export — every received JSON payload, flattened into one row per
// event, for offline/future analytics (open in Excel/Sheets, load into
// pandas, etc).
// ---------------------------------------------------------------
const CSV_FIELDS = ['ldr1', 'ldr2', 'ldr3', 'strip5', 'strip6', 'strip7', 'strip9', 'speaker'];

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function eventsToCSV(rows) {
  const header = ['id', 'received_at', ...CSV_FIELDS];
  const lines = [header.join(',')];
  for (const row of rows) {
    const payload = row.payload || {};
    const line = [
      row.id,
      new Date(row.received_at).toISOString(),
      ...CSV_FIELDS.map(f => (payload[f] === undefined ? '' : csvEscape(payload[f])))
    ];
    lines.push(line.join(','));
  }
  return lines.join('\n') + '\n';
}

async function allEventsCSV() {
  if (!pool) return eventsToCSV([]);
  await READY;
  const { rows } = await pool.query(
    'SELECT id, received_at, payload FROM staircase_events ORDER BY id ASC'
  );
  return eventsToCSV(rows);
}

module.exports = { logEvent, recentEvents, allEventsCSV, enabled: !!pool };
