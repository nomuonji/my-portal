const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSkill, skillSizeNotice, SKILL_BODY_LIMIT, SKILL_BODY_BUDGET } = require('../functions/chatContextRegistry');

const skill = (body) => ({ id: 'example-skill', title: 'Example', body });

test('a skill body over the limit is refused, not silently truncated', () => {
  assert.throws(() => cleanSkill(skill('a'.repeat(SKILL_BODY_LIMIT + 1))), /the limit is 45000/);
  assert.equal(cleanSkill(skill('a'.repeat(SKILL_BODY_LIMIT))).body.length, SKILL_BODY_LIMIT);
});

test('size notice appears past the budget or after a large single addition', () => {
  assert.equal(skillSizeNotice(10000, 11000), null);
  const over = skillSizeNotice(19000, SKILL_BODY_BUDGET + 1);
  assert.ok(over && over.notes.some((n) => n.includes('純減')));
  const grew = skillSizeNotice(5000, 8000);
  assert.ok(grew && grew.notes.some((n) => n.includes('3000 字増えた')));
  assert.equal(skillSizeNotice(0, 8000), null, 'a new skill is not a growth event');
});
