const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Load .env.local
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
envFile.split('\n').forEach(line => {
  const t = line.trim();
  if (t && !t.startsWith('#')) {
    const idx = t.indexOf('=');
    if (idx !== -1) process.env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
});

// Ensure TS execution
require('ts-node/register/transpile-only');
const { durableProjectStore } = require('../src/lib/local-orchestrator/durable-project-store');

async function test() {
  console.log('=== Verifying durableProjectStore with Supabase PostgreSQL ===');

  const testTenant = 'sb-tenant-' + Date.now();
  const testProject = 'sb-project-' + Date.now();

  const record = {
    projectId: testProject,
    tenantId: testTenant,
    label: 'Supabase Verify App',
    description: 'Testing Supabase Store',
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
    port: 3001,
    status: 'done',
    serverStatus: 'Active',
    conversation: []
  };

  // 1. Save project
  console.log('1. Testing saveRecord...');
  await durableProjectStore.saveRecord(record);
  console.log('   saveRecord succeeded.');

  // 2. Project exists
  console.log('2. Testing projectIdExists...');
  const exists = await durableProjectStore.projectIdExists(testProject);
  assert.equal(exists, true);
  console.log('   projectIdExists: true');

  // 3. Load record
  console.log('3. Testing loadRecord...');
  const loaded = await durableProjectStore.loadRecord(testProject, testTenant);
  assert.equal(loaded.projectId, testProject);
  assert.equal(loaded.tenantId, testTenant);
  console.log('   loadRecord verified:', loaded.label);

  // 4. List records
  console.log('4. Testing listRecords...');
  const list = await durableProjectStore.listRecords(testTenant);
  assert.equal(list.length, 1);
  assert.equal(list[0].projectId, testProject);
  console.log('   listRecords returned 1 matching record.');

  // 5. Save deployment files
  console.log('5. Testing saveDeployment and readDeploymentFile...');
  await durableProjectStore.saveDeployment(record, [
    { path: 'index.html', content: Buffer.from('<!DOCTYPE html><html><body>Supabase Preview</body></html>') },
    { path: 'assets/main.css', content: Buffer.from('body { background: #121212; }') }
  ]);
  const deploymentFile = await durableProjectStore.readDeploymentFile(testProject, 'index.html');
  assert.equal(Buffer.from(deploymentFile.content).toString(), '<!DOCTYPE html><html><body>Supabase Preview</body></html>');
  console.log('   saveDeployment and readDeploymentFile verified.');

  // 6. App records
  console.log('6. Testing App Records CRUD...');
  const appRec = await durableProjectStore.createAppRecord(testProject, 'items', { name: 'Item 1', quantity: 5 });
  assert.equal(appRec.name, 'Item 1');
  assert.equal(typeof appRec._id, 'string');

  const loadedAppRec = await durableProjectStore.getAppRecord(testProject, 'items', appRec._id);
  assert.equal(loadedAppRec.name, 'Item 1');

  const updatedAppRec = await durableProjectStore.updateAppRecord(testProject, 'items', appRec._id, { quantity: 10 });
  assert.equal(updatedAppRec.quantity, 10);

  const collections = await durableProjectStore.listAppCollections(testProject);
  assert.deepEqual(collections, [{ name: 'items', count: 1 }]);

  const deleted = await durableProjectStore.deleteAppRecord(testProject, 'items', appRec._id);
  assert.equal(deleted, true);
  console.log('   App Records CRUD verified.');

  // 7. Remove project
  console.log('7. Testing remove...');
  const removed = await durableProjectStore.remove(testProject, testTenant);
  assert.equal(removed, true);

  const existsAfter = await durableProjectStore.projectIdExists(testProject);
  assert.equal(existsAfter, false);
  console.log('   remove verified.');

  console.log('\n>>> ALL durableProjectStore SUPABASE CHECKS PASSED! <<<');
}

test().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
