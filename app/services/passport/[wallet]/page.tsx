'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, Bot, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import ServicesNav from '@/components/services/ServicesNav';

type PassportData = {
  wallet: string;
  stats: { verifiedCompletedOrders: number; mutuallyApprovedOrders: number; networks: string[]; disputeFreeOrders: number; ordersWithResolvedDisputes: number };
  records: Array<{ orderId: string; serviceTitle: string; network: string; settlementReference: string; evidenceHash: string; dispute: string; disputeOutcome?: string; proofHash: string; recordedAt: number; verifiedOnChain: boolean; anchor: { network: string; transaction: string; anchoredAt: number } | null; approvals: { buyer: { address: string; signature: string; signedAt: number; nonce: string }; seller: { address: string; signature: string; signedAt: number; nonce: string } } }>;
  aiSummary?: { text: string; model: string } | null;
  aiSummaryAvailable: boolean;
};

const NETWORK_LABELS: Record<string, string> = { 'bnb:97': 'BNB Testnet', 'base:84532': 'Base Sepolia', 'solana:devnet': 'Solana Devnet' };

export default function VendorTrustPassportPage() {
  const params = useParams<{ wallet: string }>();
  const wallet = decodeURIComponent(String(params.wallet || ''));
  const [data, setData] = useState<PassportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/services/passport/${encodeURIComponent(wallet)}`, { cache: 'no-store' })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load passport'); return result; })
      .then((result) => { if (alive) setData(result); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Could not load passport'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wallet]);

  const loadAiSummary = async () => {
    setSummaryLoading(true);
    try {
      const response = await fetch(`/api/services/passport/${encodeURIComponent(wallet)}?summary=true`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Summary unavailable');
      setData(result);
    } catch (err) { setError(err instanceof Error ? err.message : 'Summary unavailable'); }
    finally { setSummaryLoading(false); }
  };

  const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

  return <div className="min-h-screen bg-[#0A0A09] text-[#F5F2E8]"><ServicesNav />
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 space-y-8">
      <Link href="/services" className="inline-flex items-center gap-2 text-sm text-[#A8A397] hover:text-[#C9A45C]"><ArrowLeft className="h-4 w-4" /> Services marketplace</Link>
      <section className="rounded-3xl border border-white/10 bg-[#151512] p-7 sm:p-10">
        <div className="flex items-start gap-4"><div className="rounded-2xl border border-[#C9A45C]/25 bg-[#C9A45C]/10 p-3"><ShieldCheck className="h-6 w-6 text-[#C9A45C]" /></div>
          <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#C9A45C]">B2B · Procurement</p><h1 className="mt-2 text-3xl font-bold">AI Vendor Trust Passport</h1><p className="mt-2 max-w-2xl text-sm text-[#A8A397]">Verifiable work history from completed service orders. Records show mutual approval and public chain anchoring as separate checks.</p><p className="mt-4 break-all font-mono text-xs text-[#A8A397]">{wallet}</p></div>
        </div>
      </section>
      {loading ? <div className="flex items-center gap-2 text-sm text-[#A8A397]"><Loader2 className="h-4 w-4 animate-spin" /> Loading verified records…</div> : error ? <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</p> : data && <>
        <section className="grid gap-4 sm:grid-cols-3">
          {[[data.stats.verifiedCompletedOrders, 'On-chain verified'], [data.stats.mutuallyApprovedOrders, 'Approved by both parties'], [data.stats.ordersWithResolvedDisputes, 'Resolved disputes disclosed']].map(([value, label]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-[#151512] p-5"><div className="text-3xl font-semibold">{value}</div><div className="mt-1 text-sm text-[#A8A397]">{label}</div></div>)}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#151512] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#C9A45C]">Evidence-based summary</p><h2 className="mt-1 text-xl font-semibold">Performance history</h2></div>
            {data.aiSummaryAvailable && <button onClick={loadAiSummary} disabled={summaryLoading} className="inline-flex items-center gap-2 rounded-xl border border-[#C9A45C]/30 px-4 py-2 text-xs font-semibold text-[#E6CC91] disabled:opacity-60">{summaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate Gemini summary</button>}
          </div>
          {data.aiSummary ? <p className="mt-4 rounded-xl border border-[#C9A45C]/20 bg-[#C9A45C]/5 p-4 text-sm text-[#D8D2C3]">{data.aiSummary.text}<span className="mt-2 block text-[11px] text-[#8E897D]">AI-generated summary of the counts below · {data.aiSummary.model}. It does not verify truth or rate the vendor.</span></p> : <p className="mt-4 text-xs text-[#8E897D]">AI summary is optional; it uses only aggregate counts and cannot alter verified records.</p>}
          <div className="mt-5 space-y-3">{data.records.length ? data.records.map((record) => <article key={record.orderId} className="rounded-xl border border-white/10 bg-black/20 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-[#C9A45C]" />{record.serviceTitle}</div><p className="mt-1 text-xs text-[#A8A397]">{NETWORK_LABELS[record.network] || record.network} · {new Date(record.recordedAt).toLocaleDateString()}</p></div><span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] ${record.verifiedOnChain ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}><BadgeCheck className="h-3.5 w-3.5" /> {record.verifiedOnChain ? 'Approved · anchored on-chain' : 'Approved · chain anchor pending'}</span></div>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-[#8E897D]">Outcome</dt><dd className="mt-1">Completed · escrow released</dd></div><div><dt className="text-[#8E897D]">Dispute record</dt><dd className="mt-1">{record.dispute === 'resolved' ? `Resolved${record.disputeOutcome ? ` · ${record.disputeOutcome}` : ''}` : record.dispute === 'cancelled' ? 'Cancelled' : 'No dispute recorded'}</dd></div><div className="sm:col-span-2"><dt className="text-[#8E897D]">Settlement transaction</dt><dd className="mt-1 break-all font-mono">{short(record.settlementReference)}</dd></div><div className="sm:col-span-2"><dt className="text-[#8E897D]">Deliverable evidence commitment</dt><dd className="mt-1 break-all font-mono">{record.evidenceHash}</dd></div><div className="sm:col-span-2"><dt className="text-[#8E897D]">Passport proof hash</dt><dd className="mt-1 break-all font-mono">{record.proofHash}</dd></div>{record.anchor && <div className="sm:col-span-2"><dt className="text-[#8E897D]">Passport anchor transaction</dt><dd className="mt-1 break-all font-mono"><a className="text-[#C9A45C] hover:underline" target="_blank" rel="noreferrer" href={record.anchor.network === 'solana:devnet' ? `https://explorer.solana.com/tx/${record.anchor.transaction}?cluster=devnet` : `${record.anchor.network === 'base:84532' ? 'https://sepolia.basescan.org' : 'https://testnet.bscscan.com'}/tx/${record.anchor.transaction}`}>{record.anchor.transaction}</a></dd></div>}</dl>
            <details className="mt-4 rounded-lg border border-white/10 p-3"><summary className="cursor-pointer text-xs text-[#C9A45C]">Show both digital signatures</summary><div className="mt-3 space-y-3 text-[11px] text-[#A8A397]">{(['buyer', 'seller'] as const).map((role) => <div key={role}><p className="font-semibold uppercase text-[#F5F2E8]">{role} · {record.approvals[role].address}</p><p className="mt-1 break-all font-mono">Signature: {record.approvals[role].signature}</p><p className="mt-1">Timestamp: {record.approvals[role].signedAt} · Nonce: {record.approvals[role].nonce}</p><p>Signed action: trust-passport-approve · signed order id: {record.orderId}:{record.proofHash}</p></div>)}</div></details>
          </article>) : <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-[#A8A397]">No mutually approved performance records yet.</div>}</div>
          <p className="mt-5 text-[11px] leading-5 text-[#777368]">A wallet signature proves agreement with this record; it cannot prove the underlying work was substantively correct. The passport shows verified chain references and participant approvals separately from AI-generated text.</p>
        </section>
      </>}
    </main>
  </div>;
}
