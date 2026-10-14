import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  decryptStoreDocument,
  encryptStoreDocument,
  setJsonStoreBackendForTests,
  withJsonStores,
  type JsonStoreBackend,
  type JsonStoreName,
} from '../lib/server/jsonStore';
import { addServiceMessage, getConversationMessages, getOrCreateConversation } from '../lib/server/servicesDb';
import { getOrCreateTransaction } from '../lib/server/transactionDb';

/** In-memory stand-in for the Redis backend with the same all-or-nothing version check. */
class FakeBackend implements JsonStoreBackend {
  data = new Map<JsonStoreName, string>();
  versions = new Map<JsonStoreName, number>();
  saves = 0;
  conflicts = 0;
  delayMs = 0;

  async load(names: readonly JsonStoreName[]) {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return Object.fromEntries(names.map((n) => [n, { raw: this.data.get(n) ?? null, version: this.versions.get(n) ?? 0 }]));
  }

  async saveAll(entries: Array<{ name: JsonStoreName; raw: string; expectedVersion: number }>) {
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (entries.some((e) => (this.versions.get(e.name) ?? 0) !== e.expectedVersion)) {
      this.conflicts++;
      return false;
    }
    for (const e of entries) {
      this.data.set(e.name, e.raw);
      this.versions.set(e.name, (this.versions.get(e.name) ?? 0) + 1);
    }
    this.saves++;
    return true;
  }
}

describe('Durable JSON store (Redis snapshot layer)', () => {
  const previousKey = process.env.ASSET_KEY_ENCRYPTION_KEY;
  let backend: FakeBackend;
  const buyer = privateKeyToAccount(generatePrivateKey()).address;
  const seller = privateKeyToAccount(generatePrivateKey()).address;

  before(() => {
    if (!previousKey) process.env.ASSET_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  after(() => {
    setJsonStoreBackendForTests(null);
    if (!previousKey) delete process.env.ASSET_KEY_ENCRYPTION_KEY;
  });
  beforeEach(() => {
    backend = new FakeBackend();
    setJsonStoreBackendForTests(backend);
  });
  afterEach(() => setJsonStoreBackendForTests(null));

  it('encrypts documents at rest and binds them to their store name', () => {
    const raw = encryptStoreDocument('services', { secret: 'API key 123' });
    expect(raw.startsWith('v1:')).to.equal(true);
    expect(raw).to.not.include('API key 123');
    expect(decryptStoreDocument('services', raw)).to.deep.equal({ secret: 'API key 123' });
    expect(() => decryptStoreDocument('transactions', raw)).to.throw();
  });

  it('persists writes made inside a wrapped handler, encrypted', async () => {
    const handler = withJsonStores(async () => {
      const conv = getOrCreateConversation(buyer, seller, 'srv-store-1', 'Store test');
      addServiceMessage({ conversationId: conv.id, senderId: buyer, senderType: 'human', content: 'confidential scope' });
      return Response.json({ id: conv.id });
    });
    const { id } = await (await handler()).json();

    expect(backend.saves).to.equal(1);
    expect(backend.data.get('services')).to.not.include('confidential scope');

    const read = withJsonStores(async () => Response.json(getConversationMessages(id).map((m) => m.content)));
    expect(await (await read()).json()).to.deep.equal(['confidential scope']);
  });

  it('does not save when a handler only reads', async () => {
    await withJsonStores(async () => Response.json(getOrCreateTransaction('777') && null))();
    // getOrCreateTransaction writes when the record is new, so read again: that must not save.
    const savesAfterCreate = backend.saves;
    await withJsonStores(async () => Response.json(getOrCreateTransaction('777')))();
    expect(backend.saves).to.equal(savesAfterCreate);
  });

  it('keeps both writes when two requests race (retries the loser on fresh data)', async () => {
    const setup = withJsonStores(async () => Response.json(getOrCreateConversation(buyer, seller, 'srv-race', 'Race').id));
    const convId = await (await setup()).json();
    backend.delayMs = 15;

    const send = (content: string) =>
      withJsonStores(async () => {
        addServiceMessage({ conversationId: convId, senderId: buyer, senderType: 'human', content });
        return Response.json({ ok: true });
      })();
    await Promise.all([send('first'), send('second'), send('third')]);

    backend.delayMs = 0;
    const read = withJsonStores(async () => Response.json(getConversationMessages(convId).map((m) => m.content).sort()));
    expect(await (await read()).json()).to.deep.equal(['first', 'second', 'third']);
    expect(backend.conflicts).to.be.greaterThan(0);
  });

  it('re-reads the request body when a handler is retried', async () => {
    let attempts = 0;
    const handler = withJsonStores(async (req: Request) => {
      const body = await req.json();
      attempts++;
      if (attempts === 1) backend.versions.set('services', 99); // simulate another writer
      getOrCreateConversation(buyer, seller, `srv-body-${body.n}`, 'Body');
      return Response.json({ n: body.n });
    });
    const res = await handler(new Request('http://x/api', { method: 'POST', body: JSON.stringify({ n: 7 }) }));
    expect(await res.json()).to.deep.equal({ n: 7 });
    expect(attempts).to.equal(2);
  });

  it('refuses store access outside a wrapped handler when a durable backend is active', () => {
    expect(() => getOrCreateTransaction('888')).to.throw(/outside withJsonStores/);
  });
});
