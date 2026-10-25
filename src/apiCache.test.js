/* minimal Response for jsdom */
if (typeof global.Response === 'undefined') {
  global.Response = class {
    constructor(body, init = {}) { this._body = body; this.status = init.status || 200; this.statusText = init.statusText || ''; this.ok = this.status >= 200 && this.status < 300; this.headers = new Map(Object.entries(init.headers || {})); }
    clone() { return new global.Response(this._body, { status: this.status, statusText: this.statusText }); }
    async text() { return this._body; }
    async json() { return JSON.parse(this._body); }
  };
}

// eslint-disable-next-line import/first
import { clearApiCache, installApiCache } from './apiCache';

describe('apiCache', () => {
  let calls;
  beforeAll(() => {
    calls = [];
    window.fetch = async (input, init) => {
      calls.push([String(input), init?.method || 'GET']);
      return new Response(JSON.stringify({ n: calls.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    installApiCache();
  });
  beforeEach(() => { calls.length = 0; clearApiCache(); });

  test('serves repeated GET /api from cache', async () => {
    const a = await (await window.fetch('/api/agent-ideas?resource=world_map')).json();
    const b = await (await window.fetch('/api/agent-ideas?resource=world_map')).json();
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  test('writes invalidate the cache', async () => {
    await window.fetch('/api/x');
    await window.fetch('/api/x', { method: 'POST', body: '{}' });
    await window.fetch('/api/x');
    expect(calls.map((c) => c[1])).toEqual(['GET', 'POST', 'GET']);
  });

  test('concurrent identical requests share one call', async () => {
    await Promise.all([window.fetch('/api/z'), window.fetch('/api/z')]);
    expect(calls).toHaveLength(1);
  });

  test('non-api requests are untouched', async () => {
    await window.fetch('/static/a.json');
    await window.fetch('/static/a.json');
    expect(calls).toHaveLength(2);
  });

  test('no-store bypasses and a button click forces fresh data', async () => {
    await window.fetch('/api/y');
    await window.fetch('/api/y', { cache: 'no-store' });
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.click();
    await window.fetch('/api/y');
    expect(calls).toHaveLength(3);
  });
});
