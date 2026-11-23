'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { UI_HTML, TOOLS } = require('../functions/mcpWorkspaceApp');

test('MCP Workspace tree script compiles and reuses compatible read-only tools', () => {
  const match = UI_HTML.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'one live Workspace app script must exist');
  assert.doesNotThrow(() => new vm.Script(match[1], { filename: 'my-portal-workspace-app.js' }));
  assert.match(UI_HTML, /Skill → 工程 → 仮説 → 評価物/);
  assert.match(UI_HTML, /dojo:__graph:/);
  assert.match(UI_HTML, /treeHypDetail/);
  assert.match(UI_HTML, /treeCaseDetail/);
  assert.match(UI_HTML, /本人の原文評価/);
  assert.ok(TOOLS.some(t => t.name === 'portal_workspace_contexts'));
  assert.ok(TOOLS.some(t => t.name === 'portal_workspace_open'));
});

test('Workspace tree defaults to a selected dojo and never invents user ratings', () => {
  assert.match(UI_HTML, /mode="dojo",selectedDojo="viral-post-method-discovery"/);
  assert.match(UI_HTML, /graphCache=new Map/);
  assert.match(UI_HTML, /eligibleForMerge/);
  assert.match(UI_HTML, /因果効果は未実証/);
  assert.match(UI_HTML, /工程別の取得方法・選別条件/);
  assert.match(UI_HTML, /source\.locator/);
  assert.doesNotMatch(UI_HTML, /innerHTML\s*=/);
});
