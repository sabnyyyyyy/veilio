import { allowValidationRequest } from './validationRateLimit';

/**
 * Shared guards for user-typed chat text (services chat, auction transaction chat, agent messages).
 */

// Control chars, zero-width chars and bidi overrides can hide or reorder text (e.g. spoofed amounts).
const INVISIBLE_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export const MAX_CHAT_MESSAGE_LENGTH = 4000;

export function sanitizeChatText(text: string, maxLength = MAX_CHAT_MESSAGE_LENGTH): string {
  return text.replace(INVISIBLE_OR_CONTROL, '').trim().slice(0, maxLength);
}

/**
 * Server notices start with a bracketed upper-case tag ("[ESCROW FUNDED ON BNB CHAIN] ...").
 * Users may not post text shaped like that, so a buyer cannot fake "escrow funded" to a seller.
 */
const SYSTEM_TAG = /^\[[A-Z][A-Z0-9 &_.:/-]{2,60}\]/;

export function impersonatesSystemNotice(text: string): boolean {
  return SYSTEM_TAG.test(text.trim());
}

export const CHAT_RATE_LIMIT = { windowMs: 60_000, max: 30 } as const;

/**
 * Per-wallet chat rate limit. Fails open when the shared limiter is unavailable so an
 * infrastructure outage does not block conversations (AI endpoints stay fail-closed).
 */
export async function allowChatMessage(scope: string, wallet: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  try {
    const result = await allowValidationRequest(`chat:${scope}:${wallet}`, CHAT_RATE_LIMIT.windowMs, CHAT_RATE_LIMIT.max);
    return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
  } catch (err) {
    console.warn('[chat] rate limiter unavailable; allowing message', err instanceof Error ? err.message : err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
