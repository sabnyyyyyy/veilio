import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';
import type { TransactionMessage } from '@/lib/server/transactionDb';
import { useServicesWalletAuth } from '@/components/services/useServicesWalletAuth';
import ChatLinkWarning from '@/components/ChatLinkWarning';

interface TransactionChatProps {
  transactionId: string;
  currentUserAddress: string;
  isBuyer: boolean;
  isSeller: boolean;
  onRequestValidation?: () => void;
}

export default function TransactionChat({
  transactionId,
  currentUserAddress,
  isBuyer,
  isSeller,
  onRequestValidation,
}: TransactionChatProps) {
  const [messages, setMessages] = useState<TransactionMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { getSession, getSessionHeaders } = useServicesWalletAuth();
  // Stop background polling after the user declines the sign-in prompt; Refresh retries.
  const signInDeclined = useRef(false);

  const fetchMessages = async (manual = false) => {
    if (!currentUserAddress || (signInDeclined.current && !manual)) return;
    try {
      setLoading(true);
      const headers = await getSessionHeaders(currentUserAddress);
      signInDeclined.current = false;
      const res = await fetch(`/api/transactions/${transactionId}/messages`, { headers, cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages || []);
        setAccessError(null);
      } else {
        setAccessError(data.error || 'Unable to open this chat.');
      }
    } catch (err: any) {
      signInDeclined.current = true;
      setAccessError('Sign the wallet message to open this chat (free, no transaction).');
      console.error('Failed to load transaction messages:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    signInDeclined.current = false;
    fetchMessages();
    const interval = setInterval(() => fetchMessages(), 10000);
    return () => clearInterval(interval);
  }, [transactionId, currentUserAddress]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;

    try {
      setSending(true);
      // The server derives the sender and role from the signed session and the auction contract.
      const res = await fetch(`/api/transactions/${transactionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: inputText.trim(),
          auth: await getSession(currentUserAddress),
        }),
      });

      const data = await res.json();
      if (data.success && data.message) {
        setMessages((prev) => [...prev, data.message]);
        setInputText('');
      } else {
        alert(data.error || 'Failed to send message');
      }
    } catch (err: any) {
      alert('Error sending message: ' + (err.message || String(err)));
    } finally {
      setSending(false);
    }
  };

  const handleAiClarificationRequest = async () => {
    if (!currentUserAddress || sending) return;
    try {
      setSending(true);
      // Post a system/assistant request
      const promptText = 'Meminta ringkasan status kesepakatan dan kepatuhan pengiriman aset dari AI Validator.';
      const res = await fetch(`/api/transactions/${transactionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: promptText,
          messageType: 'text',
          auth: await getSession(currentUserAddress),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages((prev) => [...prev, data.message]);
        if (onRequestValidation) {
          onRequestValidation();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[520px] rounded-2xl bg-[#151512] border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-[#0A0A09] border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#C9A45C]/10 border border-[#C9A45C]/20 flex items-center justify-center text-[#C9A45C]">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-[#F5F2E8]">Transaction Room #{transactionId}</h4>
            <p className="text-[11px] text-[#A8A397]">
              Hanya Buyer &amp; Seller lelang ini (diverifikasi on-chain) · AI Validator memberi ringkasan
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchMessages(true)}
            disabled={loading}
            className="p-1.5 text-[#A8A397] hover:text-[#F5F2E8] transition-colors rounded-lg hover:bg-white/5"
            title="Refresh messages"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleAiClarificationRequest}
            disabled={sending}
            className="px-3 py-1.5 bg-[#C9A45C]/20 hover:bg-[#C9A45C]/30 text-[#C9A45C] border border-[#C9A45C]/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Minta Evaluasi AI
          </button>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {accessError && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{accessError}</span>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-[#A8A397]">
            <Bot className="w-8 h-8 text-[#C9A45C]/50 mb-1" />
            <p className="text-xs">Belum ada percakapan untuk transaksi ini.</p>
            <p className="text-[11px] text-[#A8A397]/70 max-w-sm">
              Gunakan ruang ini untuk mengonfirmasi detail delivery, lisensi, atau menyelesaikan kendala secara langsung sebelum transaksi selesai.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderAddress.toLowerCase() === currentUserAddress.toLowerCase();
            const isAi = m.senderType === 'ai_validator';
            const isSellerSender = m.senderType === 'seller';

            return (
              <div
                key={m.id}
                className={`flex flex-col ${
                  isAi
                    ? 'items-center my-4'
                    : isMe
                    ? 'items-end'
                    : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl p-3.5 space-y-1.5 ${
                    isAi
                      ? 'w-full bg-[#0A0A09] border border-[#C9A45C]/30'
                      : isMe
                      ? 'bg-[#C9A45C] text-[#0A0A09]'
                      : 'bg-[#0A0A09] border border-white/10 text-[#F5F2E8]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-[10px] pb-1 border-b border-black/10 dark:border-white/10">
                    <span className="font-bold flex items-center gap-1">
                      {isAi ? (
                        <>
                          <Bot className="w-3 h-3 text-[#C9A45C]" />
                          <span className="text-[#C9A45C]">VEILIO AI Validator (Advisory)</span>
                        </>
                      ) : (
                        <>
                          <User className="w-3 h-3" />
                          <span>
                            {m.senderType.toUpperCase()} ({m.senderAddress.substring(0, 6)}...
                            {m.senderAddress.substring(m.senderAddress.length - 4)})
                          </span>
                        </>
                      )}
                    </span>
                    <span className="opacity-70 font-mono">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{m.content}</p>
                </div>
                {!isMe && !isAi && <div className="mt-1.5"><ChatLinkWarning text={m.content} lang="id" /></div>}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSendMessage} className="p-3 bg-[#0A0A09] border-t border-white/5 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ketik pesan atau instruksi koordinasi delivery..."
          className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] placeholder-[#A8A397] focus:outline-none focus:border-[#C9A45C] transition-colors"
        />
        <button
          type="submit"
          disabled={sending || !inputText.trim()}
          className="px-4 py-2.5 bg-[#C9A45C] text-[#0A0A09] rounded-xl text-xs font-bold hover:bg-[#E6CC91] transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" /> Kirim
        </button>
      </form>
    </div>
  );
}
