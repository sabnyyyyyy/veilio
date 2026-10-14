import { getOrderById, getOrdersBySeller } from './servicesDb';

export interface VerifiableSellerReputation {
  sellerAddress: string;
  totalOrders: number;
  completedOrders: number;
  disputedOrders: number;
  cancelledOrders: number;
  totalVolumeBnb: string;
  completionRatePercent: number;
  disputeRatePercent: number;
  hasVerifiableHistory: boolean;
  reputationBadge: 'Unrated New Seller' | 'Active Specialist' | 'Top Rated Provider';
  reputationNotes: string;
}

/**
 * Calculates deterministic, verifiable reputation signals strictly from confirmed
 * order settlement and escrow records. Does NOT invent ratings, completed orders, or revenue.
 */
export function calculateSellerReputation(sellerAddress: string): VerifiableSellerReputation {
  const normSeller = sellerAddress.toLowerCase().trim();

  let orders: ReturnType<typeof getOrdersBySeller> = [];
  try {
    orders = getOrdersBySeller(normSeller);
  } catch (err) {
    console.error('Error loading orders for reputation calculation:', err);
  }

  const totalOrders = orders.length;
  const completedOrders = orders.filter((o) => o.status === 'Completed').length;
  const disputedOrders = orders.filter((o) => o.status === 'Disputed').length;
  const cancelledOrders = orders.filter((o) => o.status === 'Cancelled' || o.status === 'Refunded').length;

  // Calculate volume from completed orders only
  const totalVolume = orders
    .filter((o) => o.status === 'Completed')
    .reduce((sum, o) => sum + (parseFloat(o.priceSnapshot) || 0), 0);

  const completionRatePercent =
    totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
  const disputeRatePercent =
    totalOrders > 0 ? Math.round((disputedOrders / totalOrders) * 100) : 0;

  const hasVerifiableHistory = completedOrders > 0;

  let reputationBadge: VerifiableSellerReputation['reputationBadge'] = 'Unrated New Seller';
  let reputationNotes = 'No confirmed on-chain escrow settlements yet. Wallet ownership is not proof of professional competence.';

  if (completedOrders >= 5 && disputeRatePercent <= 10) {
    reputationBadge = 'Top Rated Provider';
    reputationNotes = `Proven history with ${completedOrders} completed escrow orders (${totalVolume.toFixed(2)} BNB volume) and ${completionRatePercent}% completion rate.`;
  } else if (completedOrders >= 1) {
    reputationBadge = 'Active Specialist';
    reputationNotes = `${completedOrders} successfully completed escrow orders on-chain (${totalVolume.toFixed(2)} BNB volume).`;
  }

  return {
    sellerAddress: normSeller,
    totalOrders,
    completedOrders,
    disputedOrders,
    cancelledOrders,
    totalVolumeBnb: totalVolume.toFixed(4),
    completionRatePercent,
    disputeRatePercent,
    hasVerifiableHistory,
    reputationBadge,
    reputationNotes,
  };
}
