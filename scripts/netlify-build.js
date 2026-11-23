#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

function run(command, args, { shell = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell,
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

// Node's executable is an absolute path that commonly contains spaces on
// Windows, so invoke it without a shell. npm is a command shim on Windows and
// needs the shell to resolve npm.cmd from PATH.
run('npm', ['run', 'build'], { shell: process.platform === 'win32' });

// A one-time, production-only pointer reclassification. It fails closed on
// unexpected versions or open runs and is idempotent across later builds.

// One-shot source-preserving enrichment of old human-rated Buzz Trials.
// Runs only in production, never in preview; idempotent until flag removal.
if (process.env.CONTEXT === 'production' && process.env.DOJO_SKILL_FEEDBACK_BOOTSTRAP === '2026-11-24') {
  run(process.execPath,['scripts/dojo-skill-feedback-bootstrap.js']);
}

// Explicit, one-time, production-only import authorized by the owner. No source deletion or cutover.
if (process.env.CONTEXT === 'production' && process.env.CONSUMER_MODEL_SNAPSHOT_IMPORT === '2026-11-18') {
  run(process.execPath, ['scripts/consumer-model-migration.js']);
}
