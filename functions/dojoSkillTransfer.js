'use strict';

// Human verdicts are a learning signal, not a diagnosis of a particular Skill.
// Return a read-through improvement inbox keyed by the Skill that can own the fix.
// No canonical H/T data, Chat Skill body or dojo release pointer is mutated here.
const BUZZ_TARGETS = Object.freeze({
  source: ['creative-market-discovery'],
  selection: ['idea-resonance-lab'],
  transform: ['creative-thinking'],
  voice: ['text-native-social-copywriting', 'human-web-voice'],
  gate: ['social-post-quality-gate'],
  audience: ['baka-culture-content-engine'],
});
const VALID_SKILL_ID = /^[a-z][a-z0-9-]{1,89}$/;
const RATED = new Set(['pass', 'partial', 'fail']);
const MODULES = new Set(['source', 'selection', 'transform', 'voice', 'gate', 'audience']);

function planSkillTransfers({base, items = [], trials = []}) {
  const ownerSkillId = base?.method?.bodyRef?.kind === 'chat_skill'
    ? base.method.bodyRef.location : null;
  const byHypothesis = new Map(items.filter(h => h.kind === 'hypothesis').map(h => [h.id, h]));
  const candidates = new Map();
  let unroutedRated = 0;
  const ratings = trials.filter(t => t.status === 'rated' && RATED.has(t.verdict))
    .sort((a, b) => String(b.ratedAt || b.id).localeCompare(String(a.ratedAt || a.id)));

  for (const trial of ratings) {
    let routed = false;
    for (const id of trial.hypothesisIds || []) {
      const h = byHypothesis.get(id);
      if (!h) continue;
      const modules = (h.targetModuleIds || [h.pipelineStage])
        .filter(m => MODULES.has(m));
      const explicitTargets = (h.targetSkillIds || []).filter(t => VALID_SKILL_ID.test(t));
      for (const moduleId of modules.length ? modules : ['root']) {
        // Only Buzz has an audited default mapping. Other dojos must name the
        // target Skill explicitly; guessing from generic pipeline names is unsafe.
        const targets = explicitTargets.length ? explicitTargets
          : base?.id === 'viral-post-method-discovery' ? BUZZ_TARGETS[moduleId] || [] : [];
        for (const targetSkillId of targets) {
          if (targetSkillId === ownerSkillId) continue;
          routed = true;
          const key = targetSkillId + ':' + moduleId;
          if (!candidates.has(key)) candidates.set(key, {
            targetSkillId, moduleId, sourceBaseId: base.id,
            ownerSkillId, hypothesisIds: new Set(), trialIds: new Set(),
            pass: 0, partial: 0, fail: 0, examples: [],
          });
          const c = candidates.get(key);
          c.hypothesisIds.add(id);
          if (c.trialIds.has(trial.id)) continue;
          c.trialIds.add(trial.id);
          c[trial.verdict] += 1;
          if (c.examples.length < 8) c.examples.push({
            trialId: trial.id, hypothesisId: id, verdict: trial.verdict,
            ratedAt: trial.ratedAt || null,
          });
        }
      }
    }
    if (!routed) unroutedRated += 1;
  }
  const worklist = [...candidates.values()].map(c => ({
    targetSkillId: c.targetSkillId, moduleId: c.moduleId,
    sourceBaseId: c.sourceBaseId, ownerSkillId: c.ownerSkillId,
    hypothesisIds: [...c.hypothesisIds].sort(),
    evidence: {rated: c.pass + c.partial + c.fail,
      pass: c.pass, partial: c.partial, fail: c.fail, examples: c.examples},
    state: c.pass && (c.fail || c.partial)
      ? 'positive_and_negative_cases_need_controlled_comparison' : 'needs_comparison_cases',
    action: 'Review original human-rated cases, competing explanations and independent controls. If a rule is justified, edit the TARGET Skill (not only the coordinator), validate cases, and release through its own dojo. Never treat a verdict as a confirmed Skill defect.',
  })).sort((a, b) => b.evidence.rated - a.evidence.rated
    || a.targetSkillId.localeCompare(b.targetSkillId)).slice(0, 30);
  return {
    kind: 'cross_skill_learning_inbox', ownerSkillId,
    status: worklist.length ? 'candidate_review_required' : 'no_routed_candidates',
    routes: worklist, unroutedRated,
    routing: 'Explicit hypothesis.targetSkillIds takes priority; only viral-post-method-discovery has a vetted module fallback.',
    releasePolicy: 'No automatic edits or releases. Independent evidence, regression cases and the TARGET Skill dojo release gate remain required.',
  };
}

module.exports = { planSkillTransfers, BUZZ_TARGETS };
