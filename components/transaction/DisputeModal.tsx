import React, { useState } from 'react';
import { X, AlertTriangle, ShieldAlert, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

interface DisputeModalProps {
  auctionId: string;
  buyerAddress: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmitOnchain: (evidenceHash: string) => Promise<void>;
}

export default function DisputeModal({
  auctionId,
  buyerAddress,
  isOpen,
  onClose,
  onSubmitOnchain,
}: DisputeModalProps) {
  const [issueCategory, setIssueCategory] = useState('listing_mismatch');
  const [expectedCondition, setExpectedCondition] = useState('');
  const [actualCondition, setActualCondition] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [requestedResolution, setRequestedResolution] = useState('Full Refund');

  const [step, setStep] = useState<'form' | 'submitting_server' | 'confirm_onchain' | 'done'>('form');
  const [computedEvidenceHash, setComputedEvidenceHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStep('submitting_server');

    try {
      const res = await fetch(`/api/transactions/${auctionId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAddress,
          issueCategory,
          expectedCondition,
          actualCondition,
          description,
          evidenceReferences: evidenceReference.trim() ? [evidenceReference.trim()] : [],
          requestedResolution,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to register dispute on server');
      }

      setComputedEvidenceHash(data.evidenceHash);
      setStep('confirm_onchain');

      // Now execute on-chain
      await onSubmitOnchain(data.evidenceHash);
      setStep('done');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to submit dispute');
      setStep('form');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151512] border border-rose-500/30 rounded-2xl max-w-xl w-full p-6 space-y-6 relative shadow-2xl my-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#A8A397] hover:text-[#F5F2E8] p-1 rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
            <ShieldAlert className="w-3.5 h-3.5" /> Pengajuan Refund & Sengketa Resmi
          </div>
          <h3 className="text-xl font-bold text-[#F5F2E8]">Formulir Dispute Lelang #{auctionId}</h3>
          <p className="text-xs text-[#A8A397]">
            Pengajuan ini akan menghasilkan hash bukti kriptografis kanonikal (SHA-256) dan mengunci dana di smart contract hingga diputuskan oleh Reviewer.
          </p>
        </div>

        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {step === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                Kategori Masalah
              </label>
              <select
                value={issueCategory}
                onChange={(e) => setIssueCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0A0A09] border border-white/10 rounded-xl text-xs text-[#F5F2E8] focus:outline-none focus:border-rose-400 transition-colors"
              >
                <option value="listing_mismatch">Kesesuaian Aset dengan Deskripsi Listing</option>
                <option value="access_failure">Kegagalan Akses / Kunci Dekripsi Rusak</option>
                <option value="asset_not_delivered">Aset Tidak Diserahkan Sama Sekali</option>
                <option value="license_mismatch">Ketentuan Lisensi Tidak Sesuai Kesepakatan</option>
                <option value="format_mismatch">Format atau Spesifikasi Teknis Tidak Cocok</option>
                <option value="other">Kendala Material Lainnya</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Kondisi Ekspektasi (Listing)
                </label>
                <input
                  type="text"
                  required
                  value={expectedCondition}
                  onChange={(e) => setExpectedCondition(e.target.value)}
                  placeholder="e.g. 10.000 Baris CSV terverifikasi"
                  className="w-full px-3.5 py-2.5 bg-[#0A0A09] border border-white/10 rounded-xl text-xs text-[#F5F2E8] placeholder-[#A8A397]/50 focus:outline-none focus:border-rose-400 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Kondisi Aktual (Diterima)
                </label>
                <input
                  type="text"
                  required
                  value={actualCondition}
                  onChange={(e) => setActualCondition(e.target.value)}
                  placeholder="e.g. Hanya 2.100 Baris data"
                  className="w-full px-3.5 py-2.5 bg-[#0A0A09] border border-white/10 rounded-xl text-xs text-[#F5F2E8] placeholder-[#A8A397]/50 focus:outline-none focus:border-rose-400 font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                Penjelasan Rinci
              </label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Jelaskan ketidaksesuaian secara objektif untuk peninjauan Reviewer..."
                className="w-full px-3.5 py-2.5 bg-[#0A0A09] border border-white/10 rounded-xl text-xs text-[#F5F2E8] placeholder-[#A8A397]/50 focus:outline-none focus:border-rose-400 leading-relaxed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                Referensi Bukti Tambahan (Opsional)
              </label>
              <input
                type="text"
                value={evidenceReference}
                onChange={(e) => setEvidenceReference(e.target.value)}
                placeholder="Link IPFS, hash dokumen, atau file referensi"
                className="w-full px-3.5 py-2.5 bg-[#0A0A09] border border-white/10 rounded-xl text-xs text-[#F5F2E8] placeholder-[#A8A397]/50 focus:outline-none focus:border-rose-400 font-mono"
              />
            </div>

            <div className="p-3 bg-[#0A0A09] rounded-xl border border-white/5 text-[11px] text-[#A8A397] leading-relaxed">
              💡 Catatan Kontrak: Sesuai aturan smart contract VeilV3, persetujuan sengketa akan mengembalikan 100% dana ke saldo penarikan Anda (<code className="text-[#C9A45C]">pendingRefunds</code>).
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="submit"
                className="flex-1 py-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2"
              >
                <span>Generate Hash & Ajukan ke Blockchain</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-3 bg-white/5 hover:bg-white/10 text-[#A8A397] hover:text-[#F5F2E8] rounded-xl text-xs font-bold transition-colors"
              >
                Batal
              </button>
            </div>
          </form>
        )}

        {(step === 'submitting_server' || step === 'confirm_onchain') && (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
            <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
            <div className="space-y-1">
              <h4 className="text-base font-bold text-[#F5F2E8]">
                {step === 'submitting_server'
                  ? 'Menghitung Bukti & Hash Kanonikal...'
                  : 'Konfirmasi Transaksi Wallet...'}
              </h4>
              <p className="text-xs text-[#A8A397] max-w-sm">
                {step === 'submitting_server'
                  ? 'AI Validator memverifikasi kelengkapan paket sengketa.'
                  : 'Silakan konfirmasi pemanggilan fungsi requestRefund pada wallet Anda.'}
              </p>
            </div>
            {computedEvidenceHash && (
              <div className="p-2.5 rounded-lg bg-[#0A0A09] border border-white/5 font-mono text-[11px] text-[#C9A45C]">
                Evidence Hash: {computedEvidenceHash.slice(0, 18)}...
              </div>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            <div className="space-y-1">
              <h4 className="text-lg font-bold text-[#F5F2E8]">Sengketa Berhasil Didaftarkan</h4>
              <p className="text-xs text-[#A8A397] max-w-sm">
                Transaksi on-chain <code className="text-[#C9A45C]">requestRefund</code> telah dikonfirmasi di BNB Chain Testnet. Status lelang kini berada dalam fase Review.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-[#C9A45C] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#E6CC91] transition-colors"
            >
              Tutup & Muat Ulang Transaksi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
