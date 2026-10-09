import React from 'react';
import {
  FileCheck2,
  Cpu,
  KeyRound,
  ShieldCheck,
  Coins,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Lock,
} from 'lucide-react';

export interface DeliverableInfo {
  fileName?: string;
  size?: number;
  mimeType?: string;
  assetType?: string;
  deliveryMethod?: string;
  manifest?: {
    format?: string;
    recordCount?: number;
    columnCount?: number;
    columns?: string[];
  };
  professionalMetadata?: {
    licenseType?: string;
    usageRights?: string;
    format?: string;
    region?: string;
    language?: string;
    dataPeriod?: string;
    updateFrequency?: string;
    schemaOrSpecification?: string;
    [key: string]: unknown;
  };
  nftAsset?: {
    tokenContract?: string;
    tokenId?: string;
    standard?: string;
    escrowed?: boolean;
    delivered?: boolean;
  };
}

interface DeliveryReviewPanelProps {
  auctionId: string;
  assetType: string;
  isWinner: boolean;
  deliverable: DeliverableInfo | null;
  deliveryStatus: string;
  onConfirmDelivery: () => void;
  onOpenChat: () => void;
  onRequestRefund: () => void;
  isInspectionActive: boolean;
}

export default function DeliveryReviewPanel({
  auctionId,
  assetType,
  isWinner,
  deliverable,
  deliveryStatus,
  onConfirmDelivery,
  onOpenChat,
  onRequestRefund,
  isInspectionActive,
}: DeliveryReviewPanelProps) {
  const formatBytes = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getAssetIcon = () => {
    switch (assetType) {
      case 'ai-model':
        return <Cpu className="w-5 h-5 text-[#C9A45C]" />;
      case 'api-license':
      case 'api_access':
        return <KeyRound className="w-5 h-5 text-[#C9A45C]" />;
      case 'software-license':
        return <ShieldCheck className="w-5 h-5 text-[#C9A45C]" />;
      case 'nft':
        return <Coins className="w-5 h-5 text-[#C9A45C]" />;
      default:
        return <FileCheck2 className="w-5 h-5 text-[#C9A45C]" />;
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-[#151512] border border-white/10 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/20 flex items-center justify-center">
            {getAssetIcon()}
          </div>
          <div>
            <h3 className="text-base font-bold text-[#F5F2E8] uppercase tracking-wider">
              Verifikasi Delivery & Hak Akses
            </h3>
            <p className="text-xs text-[#A8A397]">
              Pemeriksaan deliverables berdasarkan kategori: <span className="text-[#C9A45C] font-semibold">{assetType.toUpperCase()}</span>
            </p>
          </div>
        </div>
        <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-mono text-[#F5F2E8]">
          Status: <span className="text-[#C9A45C] font-bold">{deliveryStatus}</span>
        </div>
      </div>

      {/* Specification Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Deliverable Specifications */}
        <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-3">
          <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
            Spesifikasi Aset Terkirim
          </span>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#A8A397]">Nama File/Aset</span>
              <span className="font-mono text-[#F5F2E8] truncate max-w-[200px]">
                {deliverable?.fileName || 'Encrypted Delivery Package'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#A8A397]">Ukuran File</span>
              <span className="font-mono text-[#F5F2E8]">{formatBytes(deliverable?.size)}</span>
            </div>
            {deliverable?.manifest?.recordCount !== undefined && (
              <div className="flex justify-between">
                <span className="text-[#A8A397]">Jumlah Record</span>
                <span className="font-mono text-[#F5F2E8]">
                  {deliverable.manifest.recordCount.toLocaleString()} Baris
                </span>
              </div>
            )}
            {deliverable?.manifest?.format && (
              <div className="flex justify-between">
                <span className="text-[#A8A397]">Format Data</span>
                <span className="font-mono text-[#C9A45C]">{deliverable.manifest.format}</span>
              </div>
            )}
            {deliverable?.nftAsset && (
              <div className="flex justify-between">
                <span className="text-[#A8A397]">NFT Custody</span>
                <span className="text-emerald-400 font-bold">
                  {deliverable.nftAsset.escrowed ? 'Verified in Escrow' : 'Pending Transfer'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* License & Rights Scope */}
        <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-3">
          <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
            Ketentuan Lisensi & Hak Penggunaan
          </span>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#A8A397]">Tipe Lisensi</span>
              <span className="font-semibold text-[#F5F2E8]">
                {deliverable?.professionalMetadata?.licenseType || 'Commercial Use Standard'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#A8A397]">Hak Penggunaan</span>
              <span className="text-[#F5F2E8] text-right truncate max-w-[220px]">
                {deliverable?.professionalMetadata?.usageRights || 'Sesuai ketentuan lelang VEILIO'}
              </span>
            </div>
            {deliverable?.professionalMetadata?.region && (
              <div className="flex justify-between">
                <span className="text-[#A8A397]">Wilayah/Region</span>
                <span className="text-[#F5F2E8]">{deliverable.professionalMetadata.region}</span>
              </div>
            )}
            <div className="pt-2 border-t border-white/5 flex items-center gap-1.5 text-[11px] text-[#A8A397]">
              <Lock className="w-3.5 h-3.5 text-[#C9A45C]" />
              <span>Akses dekripsi hanya tersedia bagi pemenang terverifikasi</span>
            </div>
          </div>
        </div>
      </div>

      {/* Post-Auction Actions */}
      {isWinner && isInspectionActive && (
        <div className="pt-4 border-t border-white/5 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-[#F5F2E8]">Tindakan Pasca-Lelang</h4>
              <p className="text-xs text-[#A8A397]">
                Periksa aset sebelum masa inspeksi berakhir. Anda dapat mengonfirmasi penerimaan, berkoordinasi di chat, atau langsung mengajukan refund.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {/* 1. Confirm Delivery */}
            {assetType !== 'nft' && (
              <button
                onClick={onConfirmDelivery}
                className="flex-1 py-3 px-4 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" /> Konfirmasi Penerimaan Sesuai
              </button>
            )}

            {/* 2. Chat with Seller (Post-auction Action 1) */}
            <button
              onClick={onOpenChat}
              className="flex-1 py-3 px-4 bg-white/[0.04] hover:bg-white/[0.08] text-[#F5F2E8] border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4 text-[#C9A45C]" /> Chat dengan Penjual
            </button>

            {/* 3. Direct Refund (Post-auction Action 2) */}
            <button
              onClick={onRequestRefund}
              className="py-3 px-5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
            >
              <AlertTriangle className="w-4 h-4" /> Ajukan Refund
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
