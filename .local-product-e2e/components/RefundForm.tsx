import React, { useState } from 'react';

interface RefundFormProps {
  auctionId: string;
  listingCriteria: {
    format?: string;
    recordCount?: number;
    columnCount?: number;
  };
  onSubmit: (evidenceHash: string) => Promise<void>;
  onCancel: () => void;
}

export default function RefundForm({ auctionId, listingCriteria, onSubmit, onCancel }: RefundFormProps) {
  const [criterion, setCriterion] = useState('recordCount');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expected || !actual || !reason) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      // Mock uploading evidence and generating hash
      const mockEvidenceHash = `0x${crypto.randomUUID().replace(/-/g, '')}`;
      
      // In a real app, we would upload the form data to an off-chain DB and get an evidence hash
      await onSubmit(mockEvidenceHash);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit refund request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-[#151512] border border-rose-500/30 space-y-6">
      <div className="mb-2">
        <h3 className="text-xl font-bold text-[#F5F2E8] uppercase tracking-wider text-rose-400">Request Refund</h3>
        <p className="text-[#A8A397] text-xs mt-1">Submit a dispute if the dataset materially fails to meet the stated listing criteria.</p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Mismatched Criterion</label>
          <select 
            value={criterion} 
            onChange={(e) => setCriterion(e.target.value)}
            className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-rose-400 transition-colors text-sm"
          >
            <option value="recordCount">Record Count</option>
            <option value="columnCount">Column Count</option>
            <option value="format">File Format</option>
            <option value="category">Category / Content</option>
            <option value="other">Other Objective Criteria</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Expected Value (Listing)</label>
            <input
              type="text"
              required
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="e.g. 10000"
              className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-rose-400 transition-colors text-sm font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Actual Value (Delivered)</label>
            <input
              type="text"
              required
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder="e.g. 2143"
              className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-rose-400 transition-colors text-sm font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Detailed Reason</label>
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain the material mismatch..."
            className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-rose-400 transition-colors text-sm"
          />
        </div>

        <div className="pt-4 flex gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-4 text-xs font-bold uppercase tracking-widest rounded-none bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/30 transition-all duration-200 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Evidence & Request Refund'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-6 py-4 text-xs font-bold uppercase tracking-widest rounded-none bg-white/[0.04] text-[#A8A397] hover:text-[#F5F2E8] transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
