import { create } from 'zustand';
import type { LlmSettings } from '../domain/llmSettings';
import { setRequestDelayMs as applyThrottleDelay } from '../providers/requestThrottle';
import { getLlmSettings, setLlmSettings } from './prefs';

interface LlmSettingsState {
  settings: LlmSettings;
  hydrated: boolean;

  hydrate: () => void;
  setSettings: (settings: LlmSettings) => void;
  setRequestDelayMs: (ms: number) => void;
  /** Set the default provider/model for timeline insights (both empty = borrow from an agent). */
  setInsightTarget: (providerId: string, model: string) => void;
}

function syncThrottle(settings: LlmSettings): void {
  applyThrottleDelay(settings.requestDelayMs);
}

const initialSettings = getLlmSettings();
syncThrottle(initialSettings);

export const useLlmSettingsStore = create<LlmSettingsState>((set, get) => ({
  settings: initialSettings,
  hydrated: false,

  hydrate() {
    const settings = getLlmSettings();
    syncThrottle(settings);
    set({ settings, hydrated: true });
  },

  setSettings(settings) {
    setLlmSettings(settings);
    syncThrottle(settings);
    set({ settings });
  },

  setRequestDelayMs(ms) {
    const requestDelayMs = Math.max(0, Math.min(60_000, Math.floor(Number(ms) || 0)));
    const settings = { ...get().settings, requestDelayMs };
    get().setSettings(settings);
  },

  setInsightTarget(providerId, model) {
    // Clearing the provider clears the model too — an orphan model is meaningless.
    const insightProviderId = providerId.trim();
    const settings = {
      ...get().settings,
      insightProviderId,
      insightModel: insightProviderId ? model : '',
    };
    get().setSettings(settings);
  },
}));
