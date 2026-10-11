import React from 'react';
import { ShieldCheck, AlertTriangle, AlertCircle, FileText, CheckCircle2, Bot } from 'lucide-react';
import type { GeminiValidationOutput, GeminiValidationFinding } from '@/lib/server/gemini';

interface AiValidatorPanelProps {
  report: GeminiValidationOutput | null;
  loading?: boolean;
  onRefresh?: () => void;
}

export default function AiValidatorPanel({ report, loading, onRefresh }: AiValidatorPanelProps) {
  if (loading) {
    return (
      <div className="p-6 rounded-2xl bg-[#151512] border border-white/10 animate-pulse space-y-4">
        <div className="h-6 w-1/3 bg-white/10 rounded"></div>
        <div className="h-4 w-2/3 bg-white/5 rounded"></div>
        <div className="h-20 bg-white/5 rounded-xl"></div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6 rounded-2xl bg-[#151512] border border-white/10 text-center space-y-3">
        <Bot className="w-10 h-10 text-[#C9A45C] mx-auto opacity-70" />
        <h4 className="text-base font-bold text-[#F5F2E8]">VEILIO AI Validator Ready</h4>
        <p className="text-xs text-[#A8A397] max-w-md mx-auto">
          Run automated validation to check consistency between listing terms, actual file metadata, delivery evidence, and license scope.
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="px-5 py-2.5 bg-[#C9A45C] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#E6CC91] transition-colors"
          >
            Run AI Validation
          </button>
        )}
      </div>
    );
  }

  const getStatusBadge = (status: GeminiValidationOutput['status']) => {
    switch (status) {
      case 'consistent':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-3.5 h-3.5" /> Sesuai (Consistent)
          </span>
        );
      case 'needs_evidence':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
            <AlertCircle className="w-3.5 h-3.5" /> Perlu Bukti Tambahan
          </span>
        );
      case 'potential_mismatch':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
            <AlertTriangle className="w-3.5 h-3.5" /> Terindikasi Tidak Sesuai
          </span>
        );
      case 'ready_for_review':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5" /> Siap Ditinjau (Ready for Review)
          </span>
        );
    }
  };

  const getSeverityBadge = (sev: GeminiValidationFinding['severity']) => {
    switch (sev) {
      case 'high':
        return <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-[10px] uppercase font-bold rounded">High</span>;
      case 'medium':
        return <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] uppercase font-bold rounded">Med</span>;
      case 'low':
        return <span className="px-2 py-0.5 bg-white/10 text-[#A8A397] text-[10px] uppercase font-bold rounded">Low</span>;
    }
  };

  const getVerificationBadge = (ver: GeminiValidationFinding['verification']) => {
    switch (ver) {
      case 'verified':
        return <span className="text-[10px] text-emerald-400 font-mono">✓ Verified Fact</span>;
      case 'user_claim':
        return <span className="text-[10px] text-amber-400 font-mono">ℹ User Claim</span>;
      case 'ai_inference':
        return <span className="text-[10px] text-blue-400 font-mono">⚙ AI Inference</span>;
      default:
        return <span className="text-[10px] text-[#A8A397] font-mono">? Unverified</span>;
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-[#151512] border border-[#C9A45C]/20 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/20 flex items-center justify-center text-[#C9A45C]">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#F5F2E8] flex items-center gap-2">
              VEILIO AI Validator
              <span className="text-[10px] text-[#A8A397] font-normal font-mono">
                {report.provider_info?.is_fallback ? '(Rule-Based Engine)' : `(Gemini ${report.provider_info?.model})`}
              </span>
            </h3>
            <p className="text-xs text-[#A8A397]">Verifikasi integritas transaksi dan kesesuaian aset</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {getStatusBadge(report.status)}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-xs text-[#C9A45C] hover:text-[#E6CC91] font-semibold underline underline-offset-4"
            >
              Re-evaluate
            </button>
          )}
        </div>
      </div>

      {/* Summary Box */}
      <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-2">
        <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block">Ringkasan Evaluasi</span>
        <p className="text-sm text-[#F5F2E8] leading-relaxed">{report.summary}</p>
        <div className="pt-2 flex flex-wrap gap-4 text-xs text-[#A8A397]">
          <span>Rekomendasi: <strong className="text-[#C9A45C]">{report.recommended_next_action}</strong></span>
          <span>Tingkat Keyakinan: <strong className="text-[#F5F2E8]">{Math.round((report.confidence || 0.9) * 100)}%</strong></span>
        </div>
      </div>

      {/* Findings List */}
      <div className="space-y-3">
        <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block">
          Temuan Pemeriksaan ({report.findings?.length || 0})
        </span>
        <div className="space-y-2.5">
          {report.findings?.map((f, i) => (
            <div key={i} className="p-3.5 rounded-xl bg-[#0A0A09] border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#C9A45C] uppercase tracking-wider">{f.category}</span>
                  {getSeverityBadge(f.severity)}
                </div>
                {getVerificationBadge(f.verification)}
              </div>
              <p className="text-xs text-[#F5F2E8]">{f.description}</p>
              {f.source_reference && (
                <div className="pt-1 flex items-center gap-1.5 text-[10px] text-[#A8A397] font-mono">
                  <FileText className="w-3 h-3 text-[#C9A45C]" />
                  <span>Sumber: {f.source_reference}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Missing Evidence Alert */}
      {report.missing_evidence && report.missing_evidence.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" /> Bukti yang Belum Tersedia:
          </span>
          <ul className="list-disc list-inside text-xs text-[#A8A397] space-y-1">
            {report.missing_evidence.map((me, i) => (
              <li key={i}>{me}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Regulatory / Guardrail Disclaimer */}
      <div className="pt-3 border-t border-white/5 text-[11px] text-[#A8A397]/80 leading-relaxed italic">
        * Catatan Keamanan: Output AI Validator bersifat advisory (penasihat). Seluruh tindakan finansial (refund, pelepasan escrow, penolakan klaim) tunduk pada aturan smart contract dan otorisasi pihak berwenang.
      </div>
    </div>
  );
}
