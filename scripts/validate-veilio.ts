/**
 * Automated validation script for VEILIO Post-Implementation Hardening (v4.0)
 * Validates endpoints, schemas, agent manifest, and error handling against the active server.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function validate() {
  console.log(`\n======================================================`);
  console.log(`  VEILIO POST-IMPLEMENTATION VALIDATION SUITE (v4.0)`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`======================================================\n`);

  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message || err}`);
      failed++;
    }
  }

  // 1. Agent Discovery Manifest
  await check('V04-01: Agent Manifest GET /.well-known/agent.json', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/agent.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.name !== 'VEILIO') throw new Error(`Expected name VEILIO, got ${data.name}`);
    if (data.chain?.chainId !== 97) throw new Error(`Expected chainId 97, got ${data.chain?.chainId}`);
    if (!data.capabilities?.includes('asset_discovery')) throw new Error('Missing asset_discovery capability');
    if (!data.api?.endpoints?.list_assets) throw new Error('Missing list_assets endpoint');
  });

  // 2. Agent Asset Discovery API
  await check('V04-02: Agent Asset Discovery GET /api/agent/v1/assets', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/v1/assets?limit=5`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.data)) throw new Error('Expected data array');
    if (data.data.length === 0) throw new Error('Expected at least 1 asset in catalog');
    const first = data.data[0];
    if (!first.id || !first.title || !first.license || !first.auction) {
      throw new Error(`Incomplete asset schema: ${JSON.stringify(first)}`);
    }
    if (first.seller?.delivery_rate_percent !== null && typeof first.seller?.delivery_rate_percent !== 'number') {
      throw new Error('delivery_rate_percent must be number or null');
    }
  });

  // 3. Agent Asset Discovery with Filters
  await check('V04-02b: Agent Asset Filtering by category=dataset', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/v1/assets?category=dataset`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const item of data.data) {
      if (item.category.toLowerCase() !== 'dataset') {
        throw new Error(`Item ${item.id} has category ${item.category}, expected dataset`);
      }
    }
  });

  // 4. Agent Asset Detail API
  await check('V04-03: Agent Asset Detail GET /api/agent/v1/assets/1', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/v1/assets/1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.data?.id || !data.data?.title) throw new Error('Missing asset details in response');
    if (!data.data?.license?.type) throw new Error('Missing license.type');
    if (!data.data?.seller?.address) throw new Error('Missing seller address');
  });

  // 5. Agent Auction Endpoints
  await check('V01-01b: Agent Auctions GET /api/agent/v1/auctions', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/v1/auctions?limit=5`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.chainId !== 97) throw new Error(`Expected chainId 97, got ${data.chainId}`);
  });

  // 6. Marketplace Page Health
  await check('V01-01c: Web Route GET /auctions', async () => {
    const res = await fetch(`${BASE_URL}/auctions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('Digital Asset') && !html.includes('Auctions')) {
      throw new Error('Expected Digital Asset Auctions in /auctions HTML');
    }
  });

  // 7. Verify Page Health
  await check('V01-01d: Web Route GET /verify', async () => {
    const res = await fetch(`${BASE_URL}/verify`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('Verify an Auction')) throw new Error('Expected Verify an Auction title');
  });

  // 8. Create Page Health
  await check('V01-01e: Web Route GET /create', async () => {
    const res = await fetch(`${BASE_URL}/create`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const lower = html.toLowerCase();
    if (!lower.includes('create') || !lower.includes('digital asset')) {
      throw new Error('Create page not loading expected content');
    }
  });

  // 9. Input Validation & Edge Cases (HARDENING_07)
  await check('HARDENING_07: Invalid Asset ID returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/v1/assets/invalid-id`);
    if (res.status !== 400) throw new Error(`Expected 400 Bad Request, got ${res.status}`);
  });

  await check('HARDENING_07: Invalid Cursor returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/agent/v1/auctions?cursor=-5`);
    if (res.status !== 400) throw new Error(`Expected 400 Bad Request, got ${res.status}`);
  });

  console.log(`\n======================================================`);
  console.log(`  VALIDATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

validate().catch((err) => {
  console.error('Fatal validation runner error:', err);
  process.exit(1);
});
