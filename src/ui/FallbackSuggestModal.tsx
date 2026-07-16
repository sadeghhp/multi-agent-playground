import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';

/**
 * Suggest-only temporary provider switch when the primary LLM is unreachable.
 * Never auto-switches; user must confirm. Caps are shown so cost stays visible.
 */
export function FallbackSuggestModal() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const suggest = useUiStore((s) => s.fallbackSuggest);
  const resolve = useUiStore((s) => s.resolveFallbackSuggestion);

  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');

  useEffect(() => {
    if (!suggest?.candidates.length) return;
    const first = suggest.candidates[0];
    setProviderId(first.providerId);
    setModel(first.defaultModel);
  }, [suggest]);

  const activeProvider = useMemo(
    () => suggest?.candidates.find((c) => c.providerId === providerId) ?? suggest?.candidates[0],
    [suggest, providerId],
  );
  const activeModel =
    activeProvider && activeProvider.models.includes(model)
      ? model
      : activeProvider?.defaultModel ?? '';

  if (!suggest) return null;

  return (
    <Modal
      title={t('fallback.title')}
      onClose={() => resolve(null)}
      width={520}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => resolve(null)}>
            {t('fallback.keepFailed')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!activeProvider || !activeModel}
            onClick={() => {
              if (!activeProvider || !activeModel) return;
              resolve({ providerId: activeProvider.providerId, model: activeModel });
            }}
          >
            {t('fallback.switch')}
          </button>
        </>
      }
    >
      <p dir="auto">
        {t('fallback.couldNotReach', {
          agent: suggest.agentName,
          provider: suggest.failedProviderName + (suggest.failedModel ? ` (${suggest.failedModel})` : ''),
        })}
      </p>
      <p className="muted" style={{ marginTop: 8 }} dir="auto">
        {suggest.errorSummary}
      </p>
      <p style={{ marginTop: 14 }}>
        {t('fallback.switchExplain')}
      </p>

      <label style={{ display: 'block', marginTop: 16 }}>
        {t('fallback.providerLabel')}
        <select
          value={activeProvider?.providerId ?? ''}
          onChange={(e) => {
            setProviderId(e.target.value);
            const next = suggest.candidates.find((c) => c.providerId === e.target.value);
            setModel(next?.defaultModel ?? '');
          }}
          style={{ display: 'block', width: '100%', marginTop: 4 }}
        >
          {suggest.candidates.map((c) => (
            <option key={c.providerId} value={c.providerId}>
              {c.displayName}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        {t('fallback.modelLabel')}
        <select
          value={activeModel}
          onChange={(e) => setModel(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: 4 }}
        >
          {(activeProvider?.models ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div className="muted" style={{ marginTop: 16, fontSize: 13 }}>
        {t('fallback.remainingBudget', {
          run: formatNumber(suggest.budget.remainingRun, language),
          day: formatNumber(suggest.budget.remainingDay, language),
          fallback: formatNumber(suggest.budget.remainingFallback, language),
        })}
      </div>
    </Modal>
  );
}
