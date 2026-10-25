if (typeof global.Response === 'undefined') {
  global.Response = class {
    constructor(body, init = {}) { this._body = body; this.status = init.status || 200; this.statusText = init.statusText || ''; this.ok = this.status >= 200 && this.status < 300; this.headers = new Map(Object.entries(init.headers || {})); }
    clone() { return new global.Response(this._body, { status: this.status, statusText: this.statusText }); }
    async text() { return this._body; }
    async json() { return JSON.parse(this._body); }
  };
}
jest.mock('./firebase', () => ({ auth: { currentUser: { getIdToken: async () => 't' } } }));

describe('shared onSnapshot (turso)', () => {
  let client;
  let requests;
  beforeAll(() => {
    process.env.REACT_APP_PORTAL_DB_BACKEND = 'turso';
    requests = 0;
    window.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ docs: [{ id: 'a', data: { content: 'hi' } }] }), { status: 200 });
    };
    jest.isolateModules(() => { client = require('./documentDbClient'); });
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('remount reuses the cached snapshot without refetching', async () => {
    const q = client.query(client.collection({}, 'stocks'), client.orderBy('createdAt', 'desc'));
    const first = jest.fn();
    const stop1 = client.onSnapshot(q, first);
    await flush(); await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(requests).toBe(1);
    stop1();

    const second = jest.fn();
    const q2 = client.query(client.collection({}, 'stocks'), client.orderBy('createdAt', 'desc'));
    const stop2 = client.onSnapshot(q2, second);
    await flush(); await flush();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0].docs[0].data().content).toBe('hi');
    expect(requests).toBe(1);
    stop2();
  });
});
