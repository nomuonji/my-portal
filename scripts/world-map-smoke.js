const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const originalLoad = Module._load;
const documentMap = new Map();
const data = {
  projects: [{ id: 'site-operations', name: 'Site Operations', status: 'active', repositories: [{ fullName: 'nomuonji/keywords' }], mcpTools: [{ name: 'Sites Operator' }] }],
  spaces: [{ id: 'seo-space', title: 'SEO研究', status: 'active', themeOwner:'user', tags: ['seo'] },
           { id: 'ai-space', title:'AI側の記録', status:'active', themeOwner:'assistant', currentBrief:'手戻りを防ぐ' }],
  methods: [{ id: 'method-1', title: 'Manager Method', status: 'active', currentVersionNumber: 2 }],
  decisions: [{id:'legacy-decision-1',spaceId:'ai-space',decision:'adopt',reason:'Do not conflate human Spaces and Contexts',status:'active'}],
};
let counter=0;
function documentRef(collection,id) {
  const key=collection+'/'+(id||'auto-'+(++counter));
  return {
    id:key.split('/').pop(),
    get: async () => {
      const value=documentMap.get(key) || (data[collection]||[]).find(x=>x.id===id);
      return value ? {id:key.split('/').pop(),exists:true,data:()=>value} : {exists:false};
    },
    set: obj => { documentMap.set(key,obj); },
  };
}
function database() {
  return {
    collection: name => ({
      doc: id => documentRef(name,id),
      limit: () => ({ get: async () => ({
        docs: [...(data[name]||[]).map(value => ({id:value.id,data:()=>value})),
          ...[...documentMap.entries()].filter(([key])=>key.startsWith(name+'/')).map(([key,value])=>({id:key.split('/').pop(),data:()=>value}))],
      }) }),
    }),
    runTransaction: async action => action({
      get: ref => ref.get(),
      set: (ref, value) => ref.set(value),
    }),
  };
}
try {
  Module._load = function(request, parent, isMain) {
    if (request === './documentDb' && ['worldMap.js','chatContextRegistry.js','contextRegistry.js'].some(name=>parent?.filename?.endsWith(path.join('functions',name)))) {
      return { getDocumentDb: database, FieldValue: { serverTimestamp: () => new Date('2026-10-10T02:00:00Z') } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const world = require('../functions/worldMap');
  Module._load = originalLoad;

  (async () => {
    assert.equal(world.ROUTES.some(r => r.id === 'site-seo' && r.primary === 'Sites Operator'), true);
    assert.equal(world.ROUTES.some(r => r.id === 'seo-research' && r.primary.includes('My Portal')), true);
    assert.equal(world.ROUTES.some(r => r.id === 'english-notes'), true);
    assert.throws(() => world.cleanRoute({ id: '__proto__', title:'invalid' }), /kebab-case/);
    assert.throws(() => world.cleanRoute({ id:'ok' }), /title required/);

    const before = await world.get();
    assert.equal(before.metadataRevision, 0);
    assert.equal(before.agentGuideStorage,'persisted');
    assert.ok(before.agentGuide.instructions.includes('context_get'));
    assert.ok(before.agentGuide.instructions.includes('chat_skill_get'));
    assert.ok(before.agentGuide.minimalCustomInstruction.includes('world_map_get'));
    assert.ok(before.agentGuide.minimalCustomInstruction.length<150);
    assert.equal(before.coverage.projects, 'loaded');
    assert.equal(before.projects[0].id, 'site-operations');
    assert.ok(before.spaces.some(space=>space.id==='seo-space'));
    assert.ok(!before.spaces.some(space=>space.id==='ai-space'));

    assert.equal(before.methods[0].currentVersionNumber, 2);
    assert.equal(before.contexts.length,1);
    assert.equal(before.contexts[0].id,'legacy-ai-space');
    assert.equal(before.contexts[0].legacySpaceId,'ai-space');
    assert.deepEqual(before.contexts[0].domains,['general']);
    assert.equal(before.chatSkills.length,11);
    assert.equal(before.chatSkills[0].sourceOfTruth,'My Portal DB');
    assert.ok(before.chatSkills.every(s=>!('body' in s)));
    assert.ok(!before.contexts.some(c=>c.id==='seo-space'));
    const compactView = await world.getCompact();
    assert.equal(compactView.view,'compact');
    assert.equal(compactView.agentGuide.instructions,before.agentGuide.instructions);
    assert.equal(compactView.contexts.length,before.contexts.length);
    assert.ok(compactView.contexts.every(c=>!('decisions' in c)&&!('currentState' in c)));
    assert.ok(compactView.layers.some(l=>l.layer==='Exploration Base'));
    assert.equal(compactView.routes.length,before.routes.length);
    const contexts=require('../functions/contextRegistry');
    const chatContext=require('../functions/chatContextRegistry');
    assert.equal(chatContext.cleanSkill({id:'custom',title:'My Skill',body:'A'.repeat(70)}).id,'custom');
    const skill=await chatContext.getSkill({id:'human-web-voice'});
    assert.ok(skill.body.length>1000);
    assert.equal(skill.sourceOfTruth,'My Portal DB');
    const updated=await chatContext.upsertSkill({
      skill:{id:skill.id,title:skill.title,summary:skill.summary,triggers:skill.triggers,body:skill.body+'\nRevision proof.'},
      expectedRevision:1,changeReason:'Revision test',confirm:true
    });
    assert.equal(updated.revision,2);
    assert.match(updated.body,/Revision proof/);
    const versions=await chatContext.skillVersions({id:skill.id});
    assert.equal(versions.items.length,2);
    assert.equal(versions.items[0].versionNumber,2);
    await assert.rejects(()=>chatContext.upsertSkill({
      skill:{id:skill.id,title:skill.title,body:skill.body},expectedRevision:1,confirm:true,
    }),/revision conflict/);
    // Partial edit: only the passage changes; title, summary and triggers are kept without being resent.
    const editedSkill=await chatContext.upsertSkill({skill:{id:skill.id},bodyEdits:[{find:'Revision proof.',replace:'Edited in place.'}],expectedRevision:2,changeReason:'Partial edit',confirm:true});
    assert.equal(editedSkill.revision,3);
    assert.equal(editedSkill.title,skill.title);
    assert.deepEqual(editedSkill.triggers,skill.triggers);
    assert.equal(editedSkill.body,skill.body+'\nEdited in place.');
    await assert.rejects(()=>chatContext.upsertSkill({skill:{id:skill.id},bodyEdits:[{find:'no such passage',replace:'x'}],expectedRevision:3,confirm:true}),/text not found/);
    await assert.rejects(()=>chatContext.upsertSkill({skill:{id:skill.id,body:'x'.repeat(80)},bodyEdits:[{find:'a',replace:'b'}],expectedRevision:3,confirm:true}),/not both/);
    await assert.rejects(()=>chatContext.createNote({spaceId:'seo-space',summary:'incorrect',confirm:true}),/AI-side/);
    await chatContext.createNote({spaceId:'ai-space',kind:'correction',summary:'Skill and Method must stay separate',confirm:true,idempotencyKey:'test-conversation-1'});
    const legacy=await contexts.get({id:'legacy-ai-space'});
    assert.equal(legacy.history.length,2);
    assert.ok(legacy.history.some(x=>x.provenance==='legacy-space-decision'));
    assert.equal(legacy.history[0].kind,'correction');
    assert.equal(legacy.context.title,'AI側の記録');
    const revision=legacy.context.revision;
    const updatedContext=await contexts.save({id:legacy.context.id,expectedRevision:revision,confirm:true,context:{title:'Team Continuity',purpose:'Remember project decisions',projectIds:['site-operations'],domains:['seo'],summary:'Stable decisions',decisions:'SEO knowledge for chat only',currentState:'Moved out of Space',nextActions:'Preserve boundaries'}});
    assert.equal(updatedContext.context.revision,revision+1);
    assert.equal(updatedContext.context.projectIds[0],'site-operations');
    assert.equal((await contexts.list({projectId:'site-operations'})).count,1);
    await assert.rejects(()=>contexts.save({id:legacy.context.id,expectedRevision:revision,confirm:true,context:{title:'Invalid stale update',domains:['seo']}}),/revision conflict/);
    await contexts.addEvent({contextId:legacy.context.id,kind:'decision',summary:'Respect project boundaries',confirm:true,idempotencyKey:'confirmed-decision-1'});
    await contexts.addEvent({contextId:legacy.context.id,kind:'decision',summary:'Respect project boundaries',confirm:true,idempotencyKey:'confirmed-decision-1'});
    const continuity=await contexts.get({id:legacy.context.id});
    assert.equal(continuity.history.length,3);
    assert.ok(continuity.history.some(x=>x.kind==='decision'));
    assert.ok(continuity.history.some(x=>x.kind==='correction'));
    assert.equal((await contexts.list({domain:'seo'})).count,1);
    assert.equal(before.routes.some(r => r.id === 'site-seo'), true);

    await assert.rejects(() => world.update({ expectedRevision:0, routes:[] }), /confirm/);
    await world.update({
      confirm: true, expectedRevision:0,
      routes: [{
        id: 'site-seo', title: 'Site SEO', primary: 'Sites Operator',
        boundary: '自動SEO ManagerへMy Portal知見を注入しない。',
      }],
    });
    const after = await world.get();
    assert.equal(after.metadataRevision, 1);
    assert.equal(after.routes.find(r => r.id === 'site-seo').title, 'Site SEO');
    assert.equal(after.routes.some(r => r.id === 'keywords'), true);
    const originalGuide=after.agentGuide.instructions;
    const edited=await world.update({confirm:true,expectedRevision:1,agentGuide:{title:'Chat Entry Guide',instructions:originalGuide+'\nFinal: always preserve context.',minimalCustomInstruction:'最初にMy Portalの world_map_get を読んでください。'}});
    assert.equal(edited.metadataRevision,2);
    assert.equal(edited.agentGuide.title,'Chat Entry Guide');
    assert.equal(edited.agentGuide.version,2);
    assert.match(edited.agentGuide.instructions,/preserve context/);
    const stable=await world.get();
    assert.equal(stable.agentGuide.instructions,edited.agentGuide.instructions);
    assert.equal(stable.agentGuide.version,2);
    await assert.rejects(()=>world.update({confirm:true,expectedRevision:2,agentGuide:{title:'Bad',instructions:'short',minimalCustomInstruction:'world_map_get'}}),/250-20000/);
    await assert.rejects(() => world.update({ confirm:true, expectedRevision:0, boundaries:['test'] }), /revision conflict/);

    const app = fs.readFileSync(path.join(__dirname, '../src/App.js'), 'utf8');
    assert.match(app, /Route path="\/" element=.+<WorldHome\s*\/>/);
    assert.match(app, /\/boards\$\{location\.search\}/);
    assert.match(app, /Route path="\/boards" element=\{<PortalBoards\s*\/>\}/);
    const mcp = fs.readFileSync(path.join(__dirname, '../netlify/functions/mcp.mts'), 'utf8');
    assert.match(mcp, /world_map_get/);
    assert.match(mcp, /world_map_update/);
    assert.match(mcp,/chat_skill_list/);
    assert.doesNotMatch(mcp,/ai_context_note_create/);
    const home=fs.readFileSync(path.join(__dirname, '../src/components/WorldHome.js'),'utf8');
    assert.match(home,/AgentGuidePanel/);
    assert.match(home,/show\('guide'\)/);
    assert.match(mcp,/world_map_get/);
    const server=fs.readFileSync(path.join(__dirname,'../netlify/functions/agent-ideas-api.mts'),'utf8');
    assert.match(server,/agentGuide: body.agentGuide/);
    assert.match(home, /show\('skills'\)/);
    assert.match(home, /show\('contexts'\)/);
    const contextPanel=fs.readFileSync(path.join(__dirname,'../src/components/ContextPanel.js'),'utf8');
    assert.match(contextPanel,/projectFilter/);
    assert.match(contextPanel,/domainFilter/);
    const thought=fs.readFileSync(path.join(__dirname,'../src/components/ThinkingWorkspace.js'),'utf8');
    assert.doesNotMatch(thought,/AI側の課題/);
    assert.match(mcp,/context_event_create/);
    assert.doesNotMatch(home, /Methods \/ スキル/);
    {
      // Partial Agent Guide edit: only the passage changes; nothing is resent.
      const current=await world.get();
      const guideEdited=await world.update({confirm:true,expectedRevision:current.metadataRevision,agentGuideEdits:[{find:'Final: always preserve context.',replace:'Final: preserve context.'}]});
      assert.equal(guideEdited.metadataRevision,current.metadataRevision+1);
      assert.equal(guideEdited.agentGuide.title,current.agentGuide.title);
      assert.equal(guideEdited.agentGuide.instructions,current.agentGuide.instructions.replace('Final: always preserve context.','Final: preserve context.'));
      await assert.rejects(()=>world.update({confirm:true,expectedRevision:guideEdited.metadataRevision,agentGuideEdits:[{find:'not in the guide',replace:'x'}]}),/text not found/);
    }
    console.log('world-map-smoke: ok — meta directory, live registries, writes and routes');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} finally {
  Module._load = originalLoad;
}
