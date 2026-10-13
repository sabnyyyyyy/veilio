import {
  getOrderNetwork,
  normalizeServiceNetwork,
  OrderStateConflictError,
  type ServiceNetworkId,
  type ServiceOrder,
} from './servicesDb';

export type OrderNetworkResolution =
  | { ok: true; network: ServiceNetworkId; chainId: number | null }
  | { ok: false; status: number; error: string };

/**
 * Resolves the settlement network of an order for an API request.
 *
 * The network is always taken from the stored order (see getOrderNetwork). A `network`
 * supplied in the request body is never trusted: it is accepted only when it names the
 * same network, and a mismatching value is rejected so a client cannot steer
 * verification to a different chain (e.g. claim a BNB order was paid on Solana).
 */
export function resolveOrderNetworkForRequest(order: ServiceOrder, requestedNetwork: unknown): OrderNetworkResolution {
  const network = getOrderNetwork(order);
  if (requestedNetwork !== undefined && requestedNetwork !== null && requestedNetwork !== '') {
    const requested = normalizeServiceNetwork(requestedNetwork);
    if (requested !== network) {
      return {
        ok: false,
        status: 400,
        error: `Network mismatch: order ${order.id} settles on ${network}, request specified ${String(requestedNetwork)}`,
      };
    }
  }
  const chainId = network === 'base:84532' ? 84532 : network === 'bnb:97' ? 97 : null;
  return { ok: true, network, chainId };
}

export function networkDisplayName(network: ServiceNetworkId): string {
  if (network === 'base:84532') return 'Base Sepolia';
  if (network === 'solana:devnet') return 'Solana Devnet';
  return 'BNB Chain Testnet';
}

/** Maps errors thrown by servicesDb into an HTTP status (409 for invalid transitions). */
export function servicesErrorStatus(err: unknown, fallback = 500): number {
  if (err instanceof OrderStateConflictError) return 409;
  const message = err instanceof Error ? err.message : '';
  if (message.startsWith('Unauthorized')) return 403;
  if (message.includes('not found')) return 404;
  return fallback;
}
