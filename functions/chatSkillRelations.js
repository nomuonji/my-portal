'use strict';

// Verified structural references extracted from the canonical approved Skill
// instructions. References contain *IDs only*; revisions are always resolved
// against My Portal at execution. No Skill content or historical version pin is
// copied into this registry. Add relationships only when the source Skill's
// approved body explicitly names the target and scope.
//
// To preserve the human-authored task boundary, conditional edges are selected
// by intent. "technical_edit" and "serious_creation" do not activate humour.
const MANIFEST = Object.freeze({
  'character-creation-studio': [
    { skillId: 'character-visual-design', requiredness: 'required',
      intents: ['character_ideation', 'serious_creation', 'technical_edit'],
      rationale: 'Character design and visual comparison use the specialized design Skill.' },
    { skillId: 'humor-craft', requiredness: 'recommended',
      intents: ['character_ideation'],
      rationale: 'For new character concepts, compare the accepted/rejected humour mechanisms; never force on serious or extraction-only edits.' },
    { skillId: 'creative-thinking', requiredness: 'optional',
      intents: ['character_ideation', 'serious_creation'],
      rationale: 'Use as an additional lens only when ideation requires distant transfer.' },
  ],
  'humor-craft': [
    { skillId: 'creative-thinking', requiredness: 'recommended',
      intents: ['humor_ideation'],
      rationale: 'Abstract examples into transferable creative operations.' },
    { skillId: 'personal-voice-humor', requiredness: 'optional',
      intents: ['personal_voice'],
      rationale: 'User-authored voice and taste evidence when a personal voice is requested.' },
    { skillId: 'unaimed-ideation', requiredness: 'optional',
      intents: ['humor_ideation'],
      rationale: 'Independent no-target discovery lane, not a mandatory style.' },
    { skillId: 'buzz-content-ideation', requiredness: 'optional',
      intents: ['distribution'],
      rationale: 'Use when user explicitly wants social reach as a downstream objective.' },
  ],
});

const DEFAULT_INTENT = Object.freeze({
  'character-creation-studio': 'character_ideation',
  'humor-craft': 'humor_ideation',
});
const INTENTS = new Set([
  'character_ideation', 'serious_creation', 'technical_edit',
  'humor_ideation', 'personal_voice', 'distribution',
]);

function relationsForSkill(id, intent) {
  const entries = MANIFEST[id] || [];
  const chosen = intent && INTENTS.has(intent) ? intent : (DEFAULT_INTENT[id] || '');
  return entries.map((item) => ({ ...item,
    active: item.intents.includes(chosen),
    // Optional edges are declarations, not unconditional execution.
    autoLoad: item.intents.includes(chosen) && item.requiredness !== 'optional',
    intent: chosen,
    versionPolicy: 'latest_approved_at_runtime',
    provenance: 'curated_from_canonical_skill_body',
  }));
}

module.exports = { MANIFEST, DEFAULT_INTENT, INTENTS, relationsForSkill };
