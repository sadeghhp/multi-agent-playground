import { useLlmSettingsStore } from '../store/llmSettingsStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import styles from './SettingsPanel.module.css';

const DELAY_PRESETS = [0, 500, 1000, 2000] as const;

export function SettingsPanel() {
  const setPanel = useUiStore((s) => s.setPanel);
  const requestDelayMs = useLlmSettingsStore((s) => s.settings.requestDelayMs);
  const setRequestDelayMs = useLlmSettingsStore((s) => s.setRequestDelayMs);

  function onDelayChange(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setRequestDelayMs(Math.max(0, Math.min(60_000, Math.round(n))));
  }

  return (
    <Modal title="Settings" onClose={() => setPanel('none')} width={520}>
      <section className={styles.section}>
        <h3 className={styles.h3}>LLM</h3>
        <p className="muted">
          Minimum wait after each LLM API call completes before the next one
          starts. Helps avoid provider rate limits (HTTP 429). Default 0 means no
          delay.
        </p>
        <div className={styles.fieldGrid}>
          <label>
            Request delay (ms)
            <input
              type="number"
              min={0}
              max={60_000}
              step={100}
              value={requestDelayMs}
              onChange={(e) => onDelayChange(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.presets} role="group" aria-label="Delay presets">
          {DELAY_PRESETS.map((ms) => (
            <button
              key={ms}
              type="button"
              className={`secondary ${requestDelayMs === ms ? styles.presetActive : ''}`}
              onClick={() => setRequestDelayMs(ms)}
            >
              {ms === 0 ? 'None' : `${ms} ms`}
            </button>
          ))}
        </div>
      </section>
    </Modal>
  );
}
