'use strict';

// Live transitive resolution: follow task-scoped relation IDs but NEVER pinned
// version snapshots. Every visited Skill is fetched through the newest
// dojo-released executable view. Fail closed on stale declarations and cycles.
// Bound work so a growing network does not blow up a single chat call.
async function resolveRelatedSkills({
  root, intent, getPolicy, decorate, getApprovedSkill,
  maxDepth=3, maxRelated=10,
}) {
  if (!root?.id || typeof getPolicy !== 'function' || typeof getApprovedSkill !== 'function'
      || typeof decorate !== 'function') throw new Error('Missing Skill graph inputs');
  const seen=new Map([[root.id,root]]);
  const relatedSkills=[];
  const skillRelations=[];
  const policyById=new Map();
  let truncated=false;
  async function walk(source, chosenIntent, depth, chain) {
    const policy=await getPolicy(source.id);
    policyById.set(source.id,policy);
    const links=decorate(policy,chosenIntent);
    for (const link of links) {
      const mentioned=String(source.body||'').includes('`'+link.skillId+'`');
      const relation={sourceSkillId:source.id,skillId:link.skillId,
        requiredness:link.requiredness,intent:link.intent,when:link.intents,
        depth:depth+1,versionPolicy:link.versionPolicy,
        provenance:link.provenance,
        loadState:!mentioned?'stale_source_reference':!link.active?'not_applicable':
          !link.autoLoad?'optional_not_requested':'loading'};
      if (relation.loadState==='loading') {
        if(chain.has(link.skillId)) {
          relation.loadState='cycle_avoided';
        } else if(seen.has(link.skillId)) {
          relation.loadState='already_loaded';
          relation.resolvedVersion=seen.get(link.skillId).revision;
        } else if(relatedSkills.length>=maxRelated || depth>=maxDepth) {
          relation.loadState='limit_reached';
          truncated=true;
        } else {
          try {
            const skill=await getApprovedSkill(link.skillId);
            if(!skill?.id || !skill?.body || !Number.isInteger(Number(skill.revision)))
              throw new Error('Resolved Skill lacks approved executable data');
            seen.set(skill.id,skill);
            relatedSkills.push({id:skill.id,title:skill.title,revision:skill.revision,
              versionPolicy:skill.versionPolicy,body:skill.body,...(skill.qualitativeEvidence?{qualitativeEvidence:skill.qualitativeEvidence}:{}),
              via:source.id,depth:depth+1});
            relation.loadState='loaded';
            relation.resolvedVersion=skill.revision;
            // Intent scopes are *per Skill*: humour brought into a new character
            // concept uses its default humour_ideation, not character_ideation.
            const nextChain=new Set(chain);
            nextChain.add(skill.id);
            await walk(skill,undefined,depth+1,nextChain);
          }catch(error) {
            relation.loadState='unresolved';
            relation.reason=String(error.message||error).slice(0,350);
          }
        }
      }
      skillRelations.push(relation);
    }
  }
  await walk(root,intent,0,new Set([root.id]));
  return {relatedSkills,skillRelations,relationPolicy:policyById.get(root.id),
    policyById,truncated};
}
module.exports={resolveRelatedSkills};
