#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.env.TURSO_MIGRATE_ON_BUILD === '1') {
  console.log('[turso] TURSO_MIGRATE_ON_BUILD=1: migrating Firestore to Turso before build.');
  run(process.execPath, ['scripts/migrate-firestore-to-turso.js', '--apply']);
  console.log('[turso] migration and count verification completed.');
}

console.log('[turso] verifying transaction query compatibility before build.');
run(process.execPath, ['scripts/turso-transaction-smoke.js']);

run('npm', ['run', 'build']);
