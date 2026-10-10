const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const originalLoad = Module._load;
let worldDocument = null;
const data = {
  projects: [{ id: 'site-operations', name: 'Site Operations', status: 'active', repositories: [{ fullName: 'nomuonji/keywords' }], mcpTools: [{ name: 'Sites Operator' }] }],
  spaces: [{ id: 'seo-space', title: 'SEO研究', status: 'active', tags: ['seo'] }],
  methods: [{ id: 'method-1', title: 'Human Web Voice', status: 'active', currentVersionNumber: 2 }],
};
function documentRef() {
  return {
    get: async () => worldDocument ? { exists: true, data: () => worldDocument } : { exists: false },
    set: obj => { worldDocument = obj; },
  };
}
function database() {
  return {
    collection: name => ({
      doc: () => documentRef(),
      limit: () => ({
        get: async () => ({
          docs: (data[name] || []).map(value => ({ id: value.id, data: () => value })),
        }),
      }),
    }),
    runTransaction: async action => action({
      get: ref => ref.get(),
      set: (ref, value) => ref.set(value),
    }),
  };
}
try {
  Module._load = function(request, parent, isMain) {
    if (request === './documentDb' && parent?.filename?.endsWith(path.join('functions','worldMap.js'))) {
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
    console.log('world-map-smoke: ok — meta directory, live registries, writes and routes');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} finally {
  Module._load = originalLoad;
}
