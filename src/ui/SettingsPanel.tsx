import { useTranslation } from 'react-i18next';
import { useLlmSettingsStore } from '../store/llmSettingsStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import type { Language } from '../store/prefs';
import { Modal } from './Modal';
import styles from './SettingsPanel.module.css';

const DELAY_PRESETS = [0, 500, 1000, 2000] as const;
const LANGUAGES: readonly Language[] = ['en', 'fa'] as const;

export function SettingsPanel() {
  const { t } = useTranslation();
  const setPanel = useUiStore((s) => s.setPanel);
  const language = useUiStore((s) => s.language);
  const setLanguage = useUiStore((s) => s.setLanguage);
  const requestDelayMs = useLlmSettingsStore((s) => s.settings.requestDelayMs);
  const setRequestDelayMs = useLlmSettingsStore((s) => s.setRequestDelayMs);
  const insightProviderId = useLlmSettingsStore((s) => s.settings.insightProviderId);
  const insightModel = useLlmSettingsStore((s) => s.settings.insightModel);
  const setInsightTarget = useLlmSettingsStore((s) => s.setInsightTarget);
  const providers = useProviderStore((s) => s.providers);
  const insightProvider = providers.find((p) => p.id === insightProviderId) ?? null;

  function onDelayChange(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setRequestDelayMs(Math.max(0, Math.min(60_000, Math.round(n))));
  }

  return (
    <Modal title={t('settings.title')} onClose={() => setPanel('none')} width={520}>
      <section className={styles.section}>
        <h3 className={styles.h3}>{t('settings.appearanceHeading')}</h3>
        <div className={styles.presets} role="group" aria-label={t('settings.languageLabel')}>
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              lang={lang}
              className={`secondary ${language === lang ? styles.presetActive : ''}`}
              aria-pressed={language === lang}
              onClick={() => setLanguage(lang)}
            >
              {lang === 'fa' ? t('common.persian') : t('common.english')}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.h3}>{t('settings.llmHeading')}</h3>
        <p className="muted">{t('settings.requestDelayHelp')}</p>
        <div className={styles.fieldGrid}>
          <label>
            {t('settings.requestDelayLabel')}
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
        <div className={styles.presets} role="group" aria-label={t('settings.delayPresetsLabel')}>
          {DELAY_PRESETS.map((ms) => (
            <button
              key={ms}
              type="button"
              className={`secondary ${requestDelayMs === ms ? styles.presetActive : ''}`}
              onClick={() => setRequestDelayMs(ms)}
            >
              {ms === 0 ? t('settings.delayNone') : t('settings.delayMs', { ms })}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.h3}>{t('settings.insightHeading')}</h3>
        <p className="muted">{t('settings.insightHelp')}</p>
        <div className={styles.fieldGrid}>
          <label>
            {t('settings.insightProviderLabel')}
            <select
              value={insightProviderId}
              onChange={(e) => setInsightTarget(e.target.value, insightModel)}
            >
              <option value="">{t('settings.insightProviderAuto')}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {!p.enabled ? t('settings.providerDisabledSuffix') : ''}
                </option>
              ))}
            </select>
          </label>
          {insightProvider && (
            <label>
              {t('settings.insightModelLabel')}
              {insightProvider.models.length > 0 ? (
                <select
                  value={insightModel}
                  onChange={(e) => setInsightTarget(insightProviderId, e.target.value)}
                >
                  <option value="">{t('settings.insightModelSelect')}</option>
                  {insightProvider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={insightModel}
                  onChange={(e) => setInsightTarget(insightProviderId, e.target.value)}
                  placeholder={t('settings.insightModelPlaceholder')}
                />
              )}
            </label>
          )}
        </div>
      </section>
    </Modal>
  );
}
