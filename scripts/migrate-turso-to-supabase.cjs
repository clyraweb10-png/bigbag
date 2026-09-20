const { createClient } = require('@libsql/client');
const { Client: PgClient } = require('pg');
const fs = require('fs');
const path = require('path');

// Read .env.local for Turso credentials
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

const tursoClient = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN
});

const pgConnectionString = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!pgConnectionString) {
  throw new Error('SUPABASE_DB_URL or DATABASE_URL must be defined in .env.local or environment');
}

async function migrate() {
  console.log('=== Step 1: Connecting to Turso and Supabase ===');
  const pgClient = new PgClient({
    connectionString: pgConnectionString,
    ssl: { rejectUnauthorized: false }
  });
  await pgClient.connect();
  console.log('Connected to both Turso and Supabase PostgreSQL.');

  try {
    // -------------------------------------------------------------
    // 1. Migrate builder_projects
    // -------------------------------------------------------------
    console.log('\n=== Step 2: Migrating builder_projects ===');
    const tursoProjects = await tursoClient.execute('SELECT * FROM builder_projects');
    console.log(`Fetched ${tursoProjects.rows.length} projects from Turso.`);

    for (const row of tursoProjects.rows) {
      await pgClient.query(
        `INSERT INTO public.builder_projects (project_id, tenant_id, record_json, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           record_json = EXCLUDED.record_json,
           updated_at = EXCLUDED.updated_at`,
        [row.project_id, row.tenant_id, row.record_json, row.updated_at]
      );
    }
    console.log(`Migrated ${tursoProjects.rows.length} builder_projects.`);

    // -------------------------------------------------------------
    // 2. Migrate builder_project_files
    // -------------------------------------------------------------
    console.log('\n=== Step 3: Migrating builder_project_files ===');
    const tursoFiles = await tursoClient.execute('SELECT * FROM builder_project_files');
    console.log(`Fetched ${tursoFiles.rows.length} files from Turso.`);

    let fileCount = 0;
    for (const row of tursoFiles.rows) {
      let contentBuffer;
      if (Buffer.isBuffer(row.content)) {
        contentBuffer = row.content;
      } else if (row.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(row.content);
      } else if (typeof row.content === 'string') {
        contentBuffer = Buffer.from(row.content, 'base64');
      } else if (row.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(row.content);
      } else {
        contentBuffer = Buffer.from(String(row.content || ''));
      }

      await pgClient.query(
        `INSERT INTO public.builder_project_files (project_id, tenant_id, kind, path, content, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, kind, path) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           content = EXCLUDED.content,
           updated_at = EXCLUDED.updated_at`,
        [row.project_id, row.tenant_id, row.kind, row.path, contentBuffer, row.updated_at]
      );
      fileCount++;
    }
    console.log(`Migrated ${fileCount} builder_project_files.`);

    // -------------------------------------------------------------
    // 3. Migrate builder_app_records
    // -------------------------------------------------------------
    console.log('\n=== Step 4: Migrating builder_app_records ===');
    const tursoRecords = await tursoClient.execute('SELECT * FROM builder_app_records');
    console.log(`Fetched ${tursoRecords.rows.length} app records from Turso.`);

    for (const row of tursoRecords.rows) {
      await pgClient.query(
        `INSERT INTO public.builder_app_records (project_id, collection_name, record_id, data_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, collection_name, record_id) DO UPDATE SET
           data_json = EXCLUDED.data_json,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [row.project_id, row.collection_name, row.record_id, row.data_json, row.created_at, row.updated_at]
      );
    }
    console.log(`Migrated ${tursoRecords.rows.length} builder_app_records.`);

    // -------------------------------------------------------------
    // 4. Verification Check
    // -------------------------------------------------------------
    console.log('\n=== Step 5: Verification of Row Counts ===');
    const countProjects = await pgClient.query('SELECT COUNT(*) as c FROM public.builder_projects');
    const countFiles = await pgClient.query('SELECT COUNT(*) as c FROM public.builder_project_files');
    const countRecords = await pgClient.query('SELECT COUNT(*) as c FROM public.builder_app_records');

    console.log(`Turso builder_projects: ${tursoProjects.rows.length} | Supabase: ${countProjects.rows[0].c}`);
    console.log(`Turso builder_project_files: ${tursoFiles.rows.length} | Supabase: ${countFiles.rows[0].c}`);
    console.log(`Turso builder_app_records: ${tursoRecords.rows.length} | Supabase: ${countRecords.rows[0].c}`);

    if (
      Number(countProjects.rows[0].c) === tursoProjects.rows.length &&
      Number(countFiles.rows[0].c) === tursoFiles.rows.length &&
      Number(countRecords.rows[0].c) === tursoRecords.rows.length
    ) {
      console.log('\n>>> SUCCESS: ALL DATA MIGRATED WITH 100% PARITY! <<<');
    } else {
      throw new Error('Row count mismatch after migration!');
    }

  } finally {
    await pgClient.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
