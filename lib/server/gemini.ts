import { GoogleGenAI } from '@google/genai';

/**
 * Server-only Gemini provider adapter for VEILIO.
 * Ensures API keys stay server-side and never leak into client bundles.
 * Provides resilient call handling with timeout, retry, structured output validation,
 * and deterministic fallback when Gemini is unavailable.
 */

export interface GeminiValidationFinding {
  category: 'listing' | 'license' | 'delivery' | 'agreement' | 'evidence';
  description: string;
  severity: 'low' | 'medium' | 'high';
  source_reference: string;
  verification: 'verified' | 'user_claim' | 'ai_inference' | 'unverified';
}

export interface GeminiValidationOutput {
  status: 'consistent' | 'needs_evidence' | 'potential_mismatch' | 'ready_for_review';
  summary: string;
  findings: GeminiValidationFinding[];
  missing_evidence: string[];
  recommended_next_action: string;
  requires_human_review: boolean;
  confidence: number;
  limitations: string;
  provider_info?: {
    model: string;
    is_fallback: boolean;
    timestamp: number;
  };
}

export interface GeminiAdapterConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Validates whether the Gemini server environment is configured.
 */
export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

/**
 * Resolves the configured model identifier.
 */
export function getGeminiModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Executes a structured prompt against Gemini with timeout and retry protection.
 * Returns null if the provider is unavailable, allowing callers to use deterministic local fallback.
 */
export async function callGeminiStructured<T>(
  systemInstruction: string,
  prompt: string,
  responseSchema?: Record<string, unknown>,
  customConfig?: GeminiAdapterConfig
): Promise<{ data: T; model: string } | null> {
  const apiKey = customConfig?.apiKey || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const modelName = customConfig?.model || getGeminiModelName();
  const timeoutMs = customConfig?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = customConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;

  const ai = new GoogleGenAI({ apiKey });

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      const callPromise = ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          ...(responseSchema ? { responseSchema } : {}),
        },
      });

      // Wrap in timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini request timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const response = await Promise.race([callPromise, timeoutPromise]);
      const responseText = response.text?.trim();

      if (!responseText) {
        throw new Error('Gemini returned an empty response text');
      }

      const parsed = JSON.parse(responseText) as T;
      return { data: parsed, model: modelName };
    } catch (err: unknown) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      
      // Check for transient 429/503/timeout
      const isTransient =
        errMsg.includes('429') ||
        errMsg.includes('ResourceExhausted') ||
        errMsg.includes('503') ||
        errMsg.includes('timed out') ||
        errMsg.includes('fetch failed');

      if (attempt <= maxRetries && isTransient) {
        // Exponential backoff
        await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
        continue;
      }

      // Permanent error or retries exhausted
      console.warn(`[Gemini Adapter] Call failed (attempt ${attempt}/${maxRetries + 1}): ${errMsg}`);
      break;
    }
  }

  return null;
}
