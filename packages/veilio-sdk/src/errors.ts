/**
 * VEILIO Agent SDK — Standardized Error System
 *
 * Provides typed error codes, human-readable messages, retryability metadata,
 * and contextual debugging information for external developers and autonomous agents.
 */

export type VeilioErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'CHAIN_MISMATCH'
  | 'WALLET_REQUIRED'
  | 'WALLET_DISCONNECTED'
  | 'TRANSACTION_REVERTED'
  | 'TRANSACTION_TIMEOUT'
  | 'RPC_ERROR'
  | 'CONTRACT_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED';

export interface VeilioSdkErrorDetails {
  code: VeilioErrorCode;
  message: string;
  retryable?: boolean;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class VeilioSdkError extends Error {
  public readonly code: VeilioErrorCode;
  public readonly retryable: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(details: VeilioSdkErrorDetails) {
    super(details.message, { cause: details.cause });
    this.name = 'VeilioSdkError';
    this.code = details.code;
    this.retryable = details.retryable ?? false;
    this.context = details.context;

    // Maintain proper prototype chain for ES5/ES6 environments
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

export function isVeilioSdkError(error: unknown): error is VeilioSdkError {
  return error instanceof VeilioSdkError;
}

/**
 * Wraps an unknown error into a VeilioSdkError while preserving cause and message.
 */
export function wrapAsVeilioError(
  error: unknown,
  fallbackCode: VeilioErrorCode = 'RPC_ERROR',
  fallbackMessage = 'An unexpected SDK error occurred',
  retryable = false
): VeilioSdkError {
  if (isVeilioSdkError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return new VeilioSdkError({
    code: fallbackCode,
    message,
    retryable,
    cause: error,
  });
}
