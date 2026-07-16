import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUsageStore } from '../usageStore';

// F24: dayTokens() is cached as a running daily total (invalidated on bulk
// changes and midnight), incremented per new same-day entry — verify it stays
// consistent with the entries it accounts for.
describe('usageStore day-total cache (F24)', () => {
  beforeEach(async () => {
    await useUsageStore.getState().clearAll();
  });

  it('reflects new entries and resets on clear', async () => {
    expect(useUsageStore.getState().dayTokens()).toBe(0);

    await useUsageStore.getState().recordUsage({
      playgroundId: null,
      runId: null,
      providerId: 'p',
      providerName: 'P',
      model: 'm',
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      estimated: false,
      fallback: false,
    });
    expect(useUsageStore.getState().dayTokens()).toBe(140);

    await useUsageStore.getState().recordUsage({
      playgroundId: null,
      runId: null,
      providerId: 'p',
      providerName: 'P',
      model: 'm',
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      estimated: false,
      fallback: false,
    });
    // Cached running total tracks the second same-day entry without a rescan.
    expect(useUsageStore.getState().dayTokens()).toBe(160);

    await useUsageStore.getState().clearAll();
    expect(useUsageStore.getState().dayTokens()).toBe(0);
  });
});
