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
}));
