import { getSolanaAuctionProgramId } from '../lib/cross-chain/solanaAuction';

async function rpcCall(endpoint: string, method: string, params: any[]) {
  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const latency = Date.now() - t0;
  const json = await res.json() as any;
  return { status: res.status, json, latency };
}

async function main() {
  const endpoint = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
  const programId = getSolanaAuctionProgramId();
  console.log(`Testing endpoint: ${endpoint}`);
  console.log(`Testing program ID: ${programId}`);

  // 1. getHealth
  try {
    const health = await rpcCall(endpoint, 'getHealth', []);
    console.log(`getHealth: status=${health.status}, latency=${health.latency}ms, result=`, health.json);
  } catch (err: any) {
    console.error('getHealth failed:', err.message);
  }

  // 2. getSlot
  try {
    const slot = await rpcCall(endpoint, 'getSlot', [{ commitment: 'finalized' }]);
    console.log(`getSlot: status=${slot.status}, latency=${slot.latency}ms, slot=`, slot.json.result);
  } catch (err: any) {
    console.error('getSlot failed:', err.message);
  }

  // 3. getAccountInfo (Program)
  try {
    const accountInfo = await rpcCall(endpoint, 'getAccountInfo', [programId, { encoding: 'jsonParsed' }]);
    console.log(`getAccountInfo for program: status=${accountInfo.status}, latency=${accountInfo.latency}ms`);
    const value = accountInfo.json.result?.value;
    if (value) {
      console.log(`  executable: ${value.executable}`);
      console.log(`  owner: ${value.owner}`);
      console.log(`  lamports: ${value.lamports}`);
    } else {
      console.log('  Account does not exist on cluster!');
    }
  } catch (err: any) {
    console.error('getAccountInfo failed:', err.message);
  }

  // 4. getProgramAccounts
  try {
    const programAccounts = await rpcCall(endpoint, 'getProgramAccounts', [programId, { encoding: 'base64' }]);
    console.log(`getProgramAccounts: status=${programAccounts.status}, latency=${programAccounts.latency}ms, count=${programAccounts.json.result?.length ?? 'none'}`);
  } catch (err: any) {
    console.error('getProgramAccounts failed:', err.message);
  }
}

main().catch(console.error);
