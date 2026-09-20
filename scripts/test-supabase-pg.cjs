const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const envFile = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
  : '';
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
}

const ref = env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF || 'dgtkizrvagvfnbdkdnfs';
const password = env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD || '';
if (!password && !env.SUPABASE_DB_URL) {
  console.log('Provide SUPABASE_DB_PASSWORD or SUPABASE_DB_URL to test connection');
}

// Candidate connection strings / configs
const candidates = [
  ...(env.SUPABASE_DB_URL ? [{ name: 'env SUPABASE_DB_URL', connectionString: env.SUPABASE_DB_URL }] : []),
  { name: 'direct db host 5432', connectionString: `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres` },
  { name: 'pooler ap-southeast-1 6543', connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` },
];

async function main() {
  for (const c of candidates) {
    console.log(`Testing ${c.name}...`);
    const client = new Client({
      connectionString: c.connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      console.log(`SUCCESS! Connected via ${c.name}`);
      const res = await client.query('SELECT version();');
      console.log('Postgres version:', res.rows[0].version);
      
      // Read schema.sql and apply it!
      const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
      console.log('Applying schema.sql to Supabase Postgres...');
      await client.query(schemaSql);
      console.log('Schema successfully applied!');
      
      const tablesRes = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public';");
      console.log('Tables now in public schema:', tablesRes.rows.map(r => r.tablename));
      
      await client.end();
      return c.connectionString;
    } catch (err) {
      console.log(`Failed ${c.name}: ${err.message}`);
      try { await client.end(); } catch {}
    }
  }
  throw new Error('Could not connect to any candidate endpoint');
}

main().then((connStr) => {
  console.log('Done! Working connection string found.');
}).catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
