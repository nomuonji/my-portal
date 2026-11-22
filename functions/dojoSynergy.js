'use strict';

// Cross-dojo dependency propagation. A dojo release is the only trigger: editing
// a Skill draft or a Pack draft must never silently change consuming agents.
// Dependency-only Pack versions preserve the full immutable Pack definition.
// A Pack trained in a dojo remains pinned to its dojo-released version until
// that dojo separately validates and releases the new candidate version.

function pinNumber(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function planPackRewrites(definition, released) {
  const found = new Map();
  const all = [
    ...(definition.dependencies || []),
    ...(definition.components || []).flatMap((component) => component.dependencies || []),
  ];
  for (const dep of all) {
    if (dep.resourceType !== released.kind || dep.canonicalRef !== released.id) continue;
    const old = pinNumber(dep.versionNumber);
    if (!old || old >= released.versionNumber) continue;
    const key = old + ':' + dep.canonicalRef;
    if (!found.has(key)) {
      found.set(key, {
        from: { resourceType: dep.resourceType, canonicalRef: dep.canonicalRef, versionNumber: old },
        to: { resourceType: dep.resourceType, canonicalRef: dep.canonicalRef, versionNumber: released.versionNumber },
      });
    }
  }
  return [...found.values()];
}

function planProfileUpdates(definition, released) {
  return (definition.intelligencePortfolio || [])
    .filter((item) => item.packId === released.id && pinNumber(item.versionNumber)
      && item.versionNumber < released.versionNumber)
    .map((item) => ({ packId: item.packId, versionNumber: released.versionNumber }));
}

async function reconcileDojoRelease(released, services = {}) {
  const { kind, id, versionNumber } = released || {};
  if (!['chat_skill', 'intelligence_pack'].includes(kind)
    || !/^[a-z][a-z0-9-]{1,79}$/.test(id || '')
    || !Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new Error('A valid dojo-released Skill/Pack version is required');
  }
  const registry = services.registry || require('./agentIntelligenceRegistry');
  const dojos = services.dojos || require('./explorationBaseStore');
  const trainers = await dojos.trainersOf({ kind, id });
  if (!trainers.some((dojo) => Number(dojo.releasedVersion) === versionNumber)) {
    throw new Error('Version is not currently released by a dojo: ' + kind + ':' + id + ' v' + versionNumber);
  }

  const report = { released: { kind, id, versionNumber }, scanned: 0, updated: [], failures: [], skipped: 0 };
  if (kind === 'chat_skill') {
    // Scan bounded, active Pack metadata only. Compare-and-swap in the Registry
    // protects concurrent edits; a collision is reported, not force-overwritten.
    const listed = await registry.listPacks({ status: 'active', scanLimit: 500, limit: 100 });
    for (const item of listed.items || []) {
      report.scanned += 1;
      try {
        const current = await registry.getPack({ id: item.id });
        if (current.pack.status !== 'active') { report.skipped += 1; continue; }
        const rewrites = planPackRewrites(current.definition, released);
        if (!rewrites.length) { report.skipped += 1; continue; }
        const updated = await registry.derivePackVersion({
          id: item.id,
          expectedCurrentVersion: current.pack.currentVersionNumber,
          dependencyRewrites: rewrites,
          changeSummary: 'Dojo synergy: propagate approved ' + id + ' v' + versionNumber
            + ' into exact dependency pins only. No editorial/quality claim or trained-Pack release is implied.',
          confirm: true,
        });
        report.updated.push({ kind: 'intelligence_pack', id: item.id,
          from: current.pack.currentVersionNumber, to: updated.versionNumber,
          dependencyRewrites: updated.rewritten });
      } catch (error) {
        report.failures.push({ kind: 'intelligence_pack', id: item.id, error: String(error.message || error).slice(0, 500) });
      }
    }
  } else {
    // Only explicitly pinned Agent Profile portfolio entries require rewiring.
    // Null pins already resolve the current Pack, subject to the dojo selection.
    const listed = await registry.listProfiles({ status: 'active', scanLimit: 500, limit: 100 });
    for (const item of listed.items || []) {
      report.scanned += 1;
      try {
        const current = await registry.getProfile({ id: item.id });
        const updates = planProfileUpdates(current.definition, released);
        if (!updates.length) { report.skipped += 1; continue; }
        const updated = await registry.deriveProfileVersion({
          id: item.id, expectedCurrentVersion: current.profile.currentVersionNumber,
          portfolio: updates,
          changeSummary: 'Dojo synergy: follow released Pack ' + id + ' v' + versionNumber
            + ' for previously pinned portfolio entries.', confirm: true,
        });
        report.updated.push({ kind: 'agent_profile', id: item.id,
          from: current.profile.currentVersionNumber, to: updated.versionNumber });
      } catch (error) {
        report.failures.push({ kind: 'agent_profile', id: item.id, error: String(error.message || error).slice(0, 500) });
      }
    }
  }
  return report;
}

module.exports = { planPackRewrites, planProfileUpdates, reconcileDojoRelease };
