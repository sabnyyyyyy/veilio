import React from 'react';
import { ShieldAlert } from 'lucide-react';

// URLs with a scheme, "www." hosts, and bare domains such as veilio-claim.xyz/airdrop.
const LINK_PATTERN = /\b(?:(?:https?|ipfs|ipns|ftp):\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|xyz|app|dev|co|me|info|link|site|online|top|finance|fi|exchange|claims?|gift|live|vercel\.app|fun)\b(?:\/\S*)?/i;

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text);
}

const COPY = {
  en: 'Contains a link — check it before opening. VEILIO never asks you to connect your wallet, sign, or pay on an outside site; payments only happen on this page.',
  id: 'Berisi link — periksa sebelum dibuka. VEILIO tidak pernah meminta kamu menghubungkan wallet, tanda tangan, atau membayar di situs luar; pembayaran hanya terjadi di halaman ini.',
} as const;

/** Phishing notice shown under messages from the other party that contain a link. */
export default function ChatLinkWarning({ text, lang = 'en' }: { text: string; lang?: keyof typeof COPY }) {
  if (!containsLink(text)) return null;
  return (
    <div role="note" className="flex max-w-md items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
      <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden="true" />
      <span>{COPY[lang]}</span>
    </div>
  );
}
