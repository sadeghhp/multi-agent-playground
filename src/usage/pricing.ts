import type { ModelPrice } from '../domain/usage';

/** Compute USD cost from token counts and a price row. Returns 0 if no price. */
export function estimateCostUsd(
  price: Pick<ModelPrice, 'inputPer1M' | 'outputPer1M'> | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  if (!price) return 0;
  const input = (promptTokens / 1_000_000) * price.inputPer1M;
  const output = (completionTokens / 1_000_000) * price.outputPer1M;
  return input + output;
}

export function formatUsd(amount: number): string {
  if (amount <= 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/** Seed prices for common OpenRouter model ids (USD per 1M tokens). */
export const DEFAULT_OPENROUTER_PRICES: Array<
  Omit<ModelPrice, 'id' | 'providerId'> & { model: string }
> = [
  { model: 'openai/gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.6 },
  { model: 'anthropic/claude-3.5-sonnet', inputPer1M: 3, outputPer1M: 15 },
  { model: 'google/gemini-2.0-flash-001', inputPer1M: 0.1, outputPer1M: 0.4 },
  { model: 'meta-llama/llama-3.3-70b-instruct', inputPer1M: 0.35, outputPer1M: 0.4 },
];

export const OPENROUTER_PRESET_MODELS = DEFAULT_OPENROUTER_PRICES.map((p) => p.model);
