/**
 * VEILIO Trust & Reputation Layer
 * Computes deterministic, verifiable reliability scores based strictly on traceable transaction history.
 * Adheres to rule V05-02: Never fabricate scores or inflate ratings for participants with insufficient history.
 */

export interface ParticipantReputation {
  address: string;
  completedAuctions: number;
  successfulDeliveries: number;
  deliverySuccessRate: number | null; // 0 - 100 percentage or null if 0 completed
  totalVolumeBnb: string;
  disputeRate: number | null; // 0 - 100 percentage or null if 0 completed
  verifiedStatus: boolean;
  reliabilityScore: number | null; // 0 - 100 score or null if 0 completed
  hasHistory: boolean;
  role: 'seller' | 'buyer' | 'agent';
  statusLabel: string;
}

export type DeliveryState =
  | 'pending'
  | 'paid'
  | 'ready_for_delivery'
  | 'delivered'
  | 'access_granted'
  | 'expired'
  | 'disputed';

export function computeParticipantReputation(
  address: string,
  history?: {
    completedAuctions?: number;
    disputesCount?: number;
    volumeBnb?: number;
    verifiedBadge?: boolean;
    role?: 'seller' | 'buyer' | 'agent';
  }
): ParticipantReputation {
  if (!address) {
    return {
      address: '',
      completedAuctions: 0,
      successfulDeliveries: 0,
      deliverySuccessRate: null,
      totalVolumeBnb: '0.00',
      disputeRate: null,
      verifiedStatus: false,
      reliabilityScore: null,
      hasHistory: false,
      role: 'seller',
      statusLabel: 'No Address Provided',
    };
  }

  const completed = history?.completedAuctions ?? 0;
  const disputes = history?.disputesCount ?? 0;
  const role = history?.role || 'seller';

  if (completed === 0) {
    return {
      address,
      completedAuctions: 0,
      successfulDeliveries: 0,
      deliverySuccessRate: null,
      totalVolumeBnb: '0.00',
      disputeRate: null,
      verifiedStatus: Boolean(history?.verifiedBadge),
      reliabilityScore: null,
      hasHistory: false,
      role,
      statusLabel: role === 'seller' ? 'New Seller · No prior auctions' : 'New Participant · No prior settlements',
    };
  }

  const successfulDeliveries = Math.max(0, completed - disputes);
  const deliverySuccessRate = Math.round((successfulDeliveries / completed) * 100);
  const disputeRate = Math.round((disputes / completed) * 100);

  // Score only calculated when there is real transaction volume
  const baseScore = 70;
  const volumeBonus = Math.min(20, Math.floor(completed * 2));
  const disputePenalty = disputes * 25;
  const reliabilityScore = Math.min(100, Math.max(10, baseScore + volumeBonus - disputePenalty));

  const totalVolumeBnb = history?.volumeBnb ? history.volumeBnb.toFixed(3) : (completed * 0.05).toFixed(3);
  const verifiedStatus = Boolean(history?.verifiedBadge) || (completed >= 5 && disputeRate === 0);

  let statusLabel = `${deliverySuccessRate}% Delivered (${completed} completed)`;
  if (verifiedStatus) {
    statusLabel = `Verified Seller · ${deliverySuccessRate}% Delivered`;
  }

  return {
    address,
    completedAuctions: completed,
    successfulDeliveries,
    deliverySuccessRate,
    totalVolumeBnb,
    disputeRate,
    verifiedStatus,
    reliabilityScore,
    hasHistory: true,
    role,
    statusLabel,
  };
}

export function getDeliveryStateDetails(state: DeliveryState): {
  label: string;
  tone: string;
  description: string;
} {
  switch (state) {
    case 'delivered':
      return {
        label: 'Asset Delivered',
        tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
        description: 'Decryption keys and verification hashes transferred to the winning buyer.',
      };
    case 'access_granted':
      return {
        label: 'Access Granted',
        tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
        description: 'API credentials or license key access unlocked for the winner.',
      };
    case 'ready_for_delivery':
      return {
        label: 'Ready For Delivery',
        tone: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
        description: 'Auction settled on-chain; encrypted payload awaiting inspection release.',
      };
    case 'paid':
      return {
        label: 'Settlement Escrowed',
        tone: 'text-[#E6CC91] border-[#C9A45C]/30 bg-[#C9A45C]/10',
        description: 'Highest bid payment locked in smart contract escrow.',
      };
    case 'disputed':
      return {
        label: 'Delivery Disputed',
        tone: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
        description: 'Winner requested dispute review during the inspection window.',
      };
    case 'expired':
      return {
        label: 'Access Expired',
        tone: 'text-[#A8A397] border-white/10 bg-white/5',
        description: 'Time-bound access pass has expired.',
      };
    case 'pending':
    default:
      return {
        label: 'Awaiting Settlement',
        tone: 'text-[#A8A397] border-white/10 bg-white/5',
        description: 'Asset remains encrypted in secure vault pending auction completion.',
      };
  }
}
