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
};
let counter=0;
function documentRef(collection,id) {
  const key=collection+'/'+(id||'auto-'+(++counter));
  return {
    id:key.split('/').pop(),
    get: async () => documentMap.has(key) ? { id:key.split('/').pop(),exists:true,data:()=>documentMap.get(key) } : { exists:false },
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
    if (request === './documentDb' && ['worldMap.js','chatContextRegistry.js'].some(name=>parent?.filename?.endsWith(path.join('functions',name)))) {
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
    assert.equal(before.coverage.projects, 'loaded');
    assert.equal(before.projects[0].id, 'site-operations');
    assert.equal(before.spaces[0].id, 'seo-space');
    assert.equal(before.methods[0].currentVersionNumber, 2);
    assert.equal(before.aiContexts.length, 1);
    assert.equal(before.aiContexts[0].id,'ai-space');
    assert.equal(before.chatSkills.length,3);
    assert.ok(!before.aiContexts.some(space=>space.id==='seo-space'));
    const chatContext=require('../functions/chatContextRegistry');
    assert.equal(chatContext.checkSkill({id:'custom',title:'My Skill',repo:'nomuonji/skills',path:'custom/SKILL.md'}).id,'custom');
    await assert.rejects(()=>chatContext.createNote({spaceId:'seo-space',summary:'incorrect',confirm:true}),/AI-side/);
    await chatContext.createNote({spaceId:'ai-space',kind:'correction',summary:'Skill and Method must stay separate',confirm:true,idempotencyKey:'test-conversation-1'});
    const noteView=await world.get();
    assert.equal(noteView.aiContextNotes.length,1);
    assert.equal(noteView.aiContexts[0].latestNotes[0].kind,'correction');
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
    await assert.rejects(() => world.update({ confirm:true, expectedRevision:0, boundaries:['test'] }), /revision conflict/);

    const app = fs.readFileSync(path.join(__dirname, '../src/App.js'), 'utf8');
    assert.match(app, /Route path="\/" element=.+<WorldHome\s*\/>/);
    assert.match(app, /\/boards\$\{location\.search\}/);
    assert.match(app, /Route path="\/boards" element=\{<PortalBoards\s*\/>\}/);
    const mcp = fs.readFileSync(path.join(__dirname, '../netlify/functions/mcp.mts'), 'utf8');
    assert.match(mcp, /world_map_get/);
    assert.match(mcp, /world_map_update/);
    assert.match(mcp,/chat_skill_list/);
    assert.match(mcp,/ai_context_note_create/);
    const home=fs.readFileSync(path.join(__dirname, '../src/components/WorldHome.js'),'utf8');
    assert.match(home, /show\('skills'\)/);
    assert.match(home, /show\('aiContexts'\)/);
    assert.doesNotMatch(home, /Methods \/ スキル/);
    console.log('world-map-smoke: ok — meta directory, live registries, writes and routes');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} finally {
  Module._load = originalLoad;
}
