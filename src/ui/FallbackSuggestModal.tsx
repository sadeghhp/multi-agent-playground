import { useEffect, useMemo, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';

/**
 * Suggest-only temporary provider switch when the primary LLM is unreachable.
 * Never auto-switches; user must confirm. Caps are shown so cost stays visible.
 */
export function FallbackSuggestModal() {
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
      title="Provider unavailable — switch temporarily?"
      onClose={() => resolve(null)}
      width={520}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => resolve(null)}>
            Keep failed
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
            Switch for this run
          </button>
        </>
      }
    >
      <p>
        <strong>{suggest.agentName}</strong> could not reach{' '}
        <strong>{suggest.failedProviderName}</strong>
        {suggest.failedModel ? ` (${suggest.failedModel})` : ''}.
      </p>
      <p className="muted" style={{ marginTop: 8 }}>
        {suggest.errorSummary}
      </p>
      <p style={{ marginTop: 14 }}>
        Switch to another configured provider for the <em>rest of this run only</em>? Your saved
        agent settings stay unchanged.
      </p>

      <label style={{ display: 'block', marginTop: 16 }}>
        Fallback provider
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
        Model
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
        Remaining budget — run: {suggest.budget.remainingRun.toLocaleString()} tok · day:{' '}
        {suggest.budget.remainingDay.toLocaleString()} tok · fallback:{' '}
        {suggest.budget.remainingFallback.toLocaleString()} tok
      </div>
    </Modal>
  );
}
