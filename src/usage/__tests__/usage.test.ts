import { describe, expect, it } from 'vitest';
import {
  assertWithinBudget,
  buildBudgetSnapshot,
  startOfLocalDay,
  sumTokensSince,
} from '../budget';
import { DEFAULT_USAGE_BUDGET, type UsageEntry } from '../../domain/usage';
import { estimateCostUsd, formatUsd } from '../pricing';
import {
  isSuggestableFailure,
  listFallbackCandidates,
  supportsStreamUsage,
} from '../fallback';
import type { Provider } from '../../domain/schema';

function entry(partial: Partial<UsageEntry> & Pick<UsageEntry, 'id' | 'at' | 'totalTokens'>): UsageEntry {
  return {
    playgroundId: null,
    runId: null,
    providerId: 'p1',
    providerName: 'P',
    model: 'm',
    promptTokens: 0,
    completionTokens: 0,
    estimatedCost: 0,
    estimated: false,
    fallback: false,
    ...partial,
  };
}

describe('budget', () => {
  it('sums tokens since a timestamp', () => {
    const day = startOfLocalDay();
    const entries = [
      entry({ id: 'a', at: day - 1, totalTokens: 100 }),
      entry({ id: 'b', at: day + 1, totalTokens: 40 }),
      entry({ id: 'c', at: day + 2, totalTokens: 10 }),
    ];
    expect(sumTokensSince(entries, day)).toBe(50);
  });

  it('blocks when run / day / fallback caps would be exceeded', () => {
    const settings = {
      ...DEFAULT_USAGE_BUDGET,
      maxTokensPerRun: 100,
      maxTokensPerDay: 200,
      maxFallbackTokensPerRun: 50,
    };

    expect(() =>
      assertWithinBudget(
        settings,
        buildBudgetSnapshot(settings, { runTokens: 90, runFallbackTokens: 40, dayTokens: 150 }),
        { estimatedTokens: 5, isFallback: false },
      ),
    ).not.toThrow();

    expect(() =>
      assertWithinBudget(
        settings,
        buildBudgetSnapshot(settings, { runTokens: 90, runFallbackTokens: 0, dayTokens: 50 }),
        { estimatedTokens: 20, isFallback: false },
      ),
    ).toThrow(/Token budget for this run/);

    expect(() =>
      assertWithinBudget(
        settings,
        buildBudgetSnapshot(settings, { runTokens: 50, runFallbackTokens: 0, dayTokens: 180 }),
        { estimatedTokens: 30, isFallback: false },
      ),
    ).toThrow(/Daily token budget/);

    expect(() =>
      assertWithinBudget(
        settings,
        buildBudgetSnapshot(settings, { runTokens: 50, runFallbackTokens: 40, dayTokens: 50 }),
        { estimatedTokens: 15, isFallback: true },
      ),
    ).toThrow(/Fallback token budget/);
  });
});

describe('pricing', () => {
  it('computes USD from per-1M rates', () => {
    expect(estimateCostUsd({ inputPer1M: 1, outputPer1M: 2 }, 1_000_000, 500_000)).toBe(2);
    expect(formatUsd(0.0012)).toBe('$0.0012');
    expect(formatUsd(1.2)).toBe('$1.20');
  });
});

describe('fallback helpers', () => {
  it('classifies suggestable failures', () => {
    expect(isSuggestableFailure('network')).toBe(true);
    expect(isSuggestableFailure('auth')).toBe(false);
  });

  it('lists other ready providers', () => {
    const providers: Provider[] = [
      {
        id: 'a',
        displayName: 'Gateway A',
        baseUrl: 'https://api.example.com',
        path: '/v1/chat/completions',
        authMethod: 'bearer',
        authHeaderName: 'Authorization',
        authPrefix: '',
        apiKey: 'k',
        credentialStorage: 'session',
        requestFormat: 'openai-chat',
        responseFormat: 'openai-chat',
        defaultModel: 'local',
        models: ['local'],
        customHeaders: {},
        timeoutMs: 60_000,
        bypassDevProxy: false,
        enabled: true,
      },
      {
        id: 'b',
        displayName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api',
        path: '/v1/chat/completions',
        authMethod: 'bearer',
        authHeaderName: 'Authorization',
        authPrefix: '',
        apiKey: 'k2',
        credentialStorage: 'session',
        requestFormat: 'openai-chat',
        responseFormat: 'openai-chat',
        defaultModel: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        customHeaders: {},
        timeoutMs: 60_000,
        bypassDevProxy: false,
        enabled: true,
      },
    ];
    const alts = listFallbackCandidates(providers, 'a');
    expect(alts).toHaveLength(1);
    expect(alts[0].providerId).toBe('b');
  });

  it('detects stream usage hosts', () => {
    expect(supportsStreamUsage('https://api.openai.com')).toBe(true);
    expect(supportsStreamUsage('https://openrouter.ai/api')).toBe(true);
    expect(supportsStreamUsage('http://localhost:11434')).toBe(false);
  });
});
