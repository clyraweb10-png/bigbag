const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

// Read .env.local
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
}

const url = env.TURSO_DATABASE_URL;
const authToken = env.TURSO_AUTH_TOKEN;

console.log('Connecting to Turso:', url);
const client = createClient({ url, authToken });

async function check() {
  try {
    const res = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
    console.log('Tables found in Turso:', res.rows.map(r => r.name));
    for (const table of res.rows) {
      const name = String(table.name);
      if (name.startsWith('sqlite_') || name.startsWith('_litestream')) continue;
      const countRes = await client.execute(`SELECT COUNT(*) as c FROM ${name}`);
      console.log(`Table ${name} count:`, countRes.rows[0].c);
      if (Number(countRes.rows[0].c) > 0) {
        const sample = await client.execute(`SELECT * FROM ${name} LIMIT 3`);
        console.log(`Sample from ${name}:`, JSON.stringify(sample.rows, null, 2));
      }
    }
  } catch (err) {
    console.error('Error querying Turso:', err);
  }
}
check();
