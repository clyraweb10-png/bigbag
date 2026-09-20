const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const pgConnectionString = env.SUPABASE_DB_URL || env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!pgConnectionString) {
  throw new Error('SUPABASE_DB_URL or DATABASE_URL must be defined');
}

async function testOperations() {
  console.log('Testing Supabase PostgreSQL operations...');
  const pg = new Client({ connectionString: pgConnectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const testTenant = 'test-tenant-' + Date.now();
  const testProject = 'test-project-' + Date.now();

  try {
    // 1. Insert project
    console.log('1. Testing project insert/upsert...');
    const recordJson = JSON.stringify({ projectId: testProject, tenantId: testTenant, name: 'Test App' });
    const now = new Date().toISOString();
    const insertRes = await pg.query(
      `INSERT INTO builder_projects (project_id, tenant_id, record_json, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET record_json = EXCLUDED.record_json, updated_at = EXCLUDED.updated_at
       WHERE builder_projects.tenant_id = EXCLUDED.tenant_id
       RETURNING *`,
      [testProject, testTenant, recordJson, now]
    );
    assert.equal(insertRes.rowCount, 1);
    console.log('   Project inserted successfully.');

    // 2. Conflict rejection on wrong tenant
    console.log('2. Testing cross-tenant ownership rejection...');
    const wrongTenantRes = await pg.query(
      `INSERT INTO builder_projects (project_id, tenant_id, record_json, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET record_json = EXCLUDED.record_json, updated_at = EXCLUDED.updated_at
       WHERE builder_projects.tenant_id = EXCLUDED.tenant_id`,
      [testProject, 'attacker-tenant', recordJson, now]
    );
    assert.equal(wrongTenantRes.rowCount, 0, 'Should reject update from different tenant');
    console.log('   Cross-tenant rejection verified.');

    // 3. Save source file
    console.log('3. Testing file insert with binary content (BYTEA)...');
    const binaryContent = Buffer.from('console.log("Hello Supabase!");');
    await pg.query(
      `INSERT INTO builder_project_files (project_id, tenant_id, kind, path, content, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [testProject, testTenant, 'source', 'src/index.js', binaryContent, now]
    );
    console.log('   File inserted.');

    // 4. Read source file
    console.log('4. Testing file retrieval and binary integrity...');
    const fileRes = await pg.query(
      `SELECT path, content FROM builder_project_files WHERE project_id = $1 AND kind = 'source' AND path = $2`,
      [testProject, 'src/index.js']
    );
    assert.equal(fileRes.rows.length, 1);
    const retrievedContent = fileRes.rows[0].content;
    assert.equal(Buffer.from(retrievedContent).toString(), 'console.log("Hello Supabase!");');
    console.log('   File content matched 100%.');

    // 5. App record CRUD
    console.log('5. Testing builder_app_records CRUD...');
    const recId = 'rec-' + Date.now();
    await pg.query(
      `INSERT INTO builder_app_records (project_id, collection_name, record_id, data_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [testProject, 'todos', recId, JSON.stringify({ task: 'Migrate to Supabase', done: false }), now, now]
    );

    const appRecRes = await pg.query(
      `SELECT * FROM builder_app_records WHERE project_id = $1 AND collection_name = $2`,
      [testProject, 'todos']
    );
    assert.equal(appRecRes.rows.length, 1);
    assert.equal(JSON.parse(appRecRes.rows[0].data_json).task, 'Migrate to Supabase');
    console.log('   App record created and verified.');

    // 6. Delete / cascade
    console.log('6. Testing delete with cascade...');
    await pg.query(`DELETE FROM builder_projects WHERE project_id = $1`, [testProject]);
    const remainingFiles = await pg.query(`SELECT COUNT(*) as c FROM builder_project_files WHERE project_id = $1`, [testProject]);
    assert.equal(Number(remainingFiles.rows[0].c), 0, 'Files should cascade delete');
    const remainingRecs = await pg.query(`SELECT COUNT(*) as c FROM builder_app_records WHERE project_id = $1`, [testProject]);
    assert.equal(Number(remainingRecs.rows[0].c), 0, 'Records should cascade delete');
    console.log('   Cascade delete verified.');

    // 7. Test via Supabase JS SDK
    console.log('7. Testing Supabase JS client access...');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: sdkProjects, error: sdkErr } = await supabase.from('builder_projects').select('project_id').limit(1);
    assert.ifError(sdkErr);
    assert(sdkProjects.length > 0);
    console.log('   Supabase JS client query succeeded.');

    console.log('\n>>> ALL SUPABASE DATABASE OPERATIONS PASSED! <<<');
  } finally {
    await pg.end();
  }
}

testOperations().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
