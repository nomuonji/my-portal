'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MANIFEST, relationsForSkill } = require('../functions/chatSkillRelations');

test('character generation loads visual design and humour, but not optional creative lens', () => {
  const relations = relationsForSkill('character-creation-studio');
  assert.deepEqual(relations.filter(x => x.autoLoad).map(x => x.skillId),
    ['character-visual-design', 'humor-craft']);
  assert.ok(relations.every(x => x.versionPolicy === 'latest_approved_at_runtime'));
  assert.ok(relations.every(x => !('versionNumber' in x)));
});

test('technical edits and serious character work do not force the humour Skill', () => {
  for (const intent of ['technical_edit', 'serious_creation']) {
    const relations = relationsForSkill('character-creation-studio', intent);
    assert.deepEqual(relations.filter(x => x.autoLoad).map(x => x.skillId),
      ['character-visual-design']);
    assert.equal(relations.find(x => x.skillId === 'humor-craft').active, false);
  }
});

test('humour references creativity while optional distribution never auto-loads', () => {
  const relations = relationsForSkill('humor-craft');
  assert.deepEqual(relations.filter(x => x.autoLoad).map(x => x.skillId), ['creative-thinking']);
  assert.equal(relations.find(x => x.skillId === 'buzz-content-ideation').autoLoad, false);
  assert.equal(relations.find(x => x.skillId === 'unaimed-ideation').autoLoad, false);
});

test('automatic relations have no cycles or self-reference', () => {
  const graph = new Map(Object.keys(MANIFEST).map(id => [
    id, relationsForSkill(id).filter(x => x.autoLoad).map(x => x.skillId),
  ]));
  const seen = new Set();
  function walk(id, stack) {
    assert.ok(!stack.has(id), 'cycle at ' + id);
    if (seen.has(id)) return;
    stack.add(id);
    for (const dep of graph.get(id) || []) walk(dep, stack);
    stack.delete(id);
    seen.add(id);
  }
  for (const id of graph.keys()) walk(id, new Set());
});
