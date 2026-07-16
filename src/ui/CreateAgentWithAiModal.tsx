import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAgent } from '../domain/factories';
import {
  draftToAgentOverrides,
  generateAgentDraft,
  type GenerateAgentResult,
  type GeneratedAgentDraft,
} from '../agents/generateAgent';
import { parseGeneratedAgentDraftFromText } from '../agents/parseGeneratedAgentDraft';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import styles from './CreateAgentWithAiModal.module.css';

const CHAR_KEYS: (keyof GeneratedAgentDraft['characteristics'])[] = [
  'verbosity',
  'creativity',
  'assertiveness',
  'skepticism',
  'cooperation',
];

/**
 * "Create agent with AI": describe an agent in free text, generate a complete
 * draft via a provider (agents/generateAgent.ts), review it, then apply.
 * Mirrors AgentInspector's enhance-with-AI Apply/Discard pattern, scaled to a
 * whole agent instead of one field.
 */
export function CreateAgentWithAiModal() {
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const addAgent = useDomainStore((s) => s.addAgent);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const setPanel = useUiStore((s) => s.setPanel);
  const providers = useProviderStore((s) => s.providers);
  const enabledProviders = providers.filter((p) => p.enabled);

  const [description, setDescription] = useState('');
  const [providerId, setProviderId] = useState(enabledProviders[0]?.id ?? '');
  const selectedProvider = enabledProviders.find((p) => p.id === providerId);
  const [model, setModel] = useState(selectedProvider?.defaultModel ?? '');
  const [generating, setGenerating] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [reasoningBuffer, setReasoningBuffer] = useState('');
  const [draft, setDraft] = useState<GeneratedAgentDraft | null>(null);
  const [result, setResult] = useState<GenerateAgentResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight generation when the modal unmounts (Escape / backdrop
  // click / Cancel all route through onClose, which also aborts).
  useEffect(() => () => abortRef.current?.abort(), []);

  function nextPosition() {
    const n = playground?.agents.length ?? 0;
    return { x: 80 + (n % 4) * 60, y: 80 + Math.floor(n / 4) * 60 + (n % 4) * 30 };
  }

  const blockedReason =
    enabledProviders.length === 0
      ? t('createAgent.blocked.noProviders')
      : !providerId
        ? t('createAgent.blocked.selectProvider')
        : !model.trim()
          ? t('createAgent.blocked.selectModel')
          : !description.trim()
            ? t('createAgent.blocked.describeFirst')
            : null;
  const canGenerate = !blockedReason && !generating;

  async function handleGenerate() {
    if (!canGenerate || !selectedProvider) return;
    setGenerating(true);
    setDraft(null);
    setResult(null);
    setStreamBuffer('');
    setReasoningBuffer('');
    setShowRaw(false);
    setRecoveryError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await generateAgentDraft(description, selectedProvider, model, {
      signal: controller.signal,
      timeoutMs: selectedProvider.timeoutMs,
      onToken: (chunk) => {
        if (abortRef.current === controller) setStreamBuffer((b) => b + chunk);
      },
      onReasoningToken: (chunk) => {
        if (abortRef.current === controller) setReasoningBuffer((b) => b + chunk);
      },
    });

    // The modal may have been closed/reopened while this request was in flight —
    // drop a stale result rather than applying it to the current form state.
    if (abortRef.current !== controller) return;
    setGenerating(false);
    setResult(res);
    if (res.ok && res.draft) setDraft(res.draft);
  }

  function handleApply() {
    if (!draft || !playground) return;
    const agent = createAgent({
      ...draftToAgentOverrides(draft, { providerId, model }),
      position: nextPosition(),
    });
    addAgent(agent);
    selectAgent(agent.id);
    setPanel('none');
  }

  function handleDiscard() {
    setDraft(null);
    setResult(null);
    setRecoveryError(null);
  }

  function handleRecoverDraft() {
    if (!result?.rawText) return;
    setRecoveryError(null);
    const recovered = parseGeneratedAgentDraftFromText(result.rawText);
    if (recovered.ok) {
      setDraft(recovered.draft);
      setResult(null);
      setShowRaw(false);
      return;
    }
    setRecoveryError(
      t('createAgent.recoveryFailed', {
        detail: recovered.errorDetail ?? recovered.errorSummary,
      }),
    );
  }

  function handleClose() {
    abortRef.current?.abort();
    setPanel('none');
  }

  return (
    <Modal
      title={t('createAgent.title')}
      onClose={handleClose}
      width={560}
      footer={
        draft ? (
          <>
            <button type="button" onClick={handleDiscard}>{t('createAgent.discard')}</button>
            <button type="button" className="primary" onClick={handleApply}>{t('createAgent.apply')}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={handleClose}>{t('common.cancel')}</button>
            <button
              type="button"
              className="primary"
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
              title={blockedReason ?? t('createAgent.generateHint')}
            >
              {generating ? t('createAgent.generating') : t('createAgent.generate')}
            </button>
          </>
        )
      }
    >
      {!draft && (
        <>
          <div className="field">
            <label htmlFor="ai-desc">{t('createAgent.describeLabel')}</label>
            <textarea
              id="ai-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('createAgent.describePlaceholder')}
              disabled={generating}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="ai-provider">{t('createAgent.provider')}</label>
              <select
                id="ai-provider"
                value={providerId}
                disabled={generating}
                onChange={(e) => {
                  const p = enabledProviders.find((pv) => pv.id === e.target.value);
                  setProviderId(e.target.value);
                  setModel(p?.defaultModel ?? '');
                }}
              >
                <option value="">{t('createAgent.selectOption')}</option>
                {enabledProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ai-model">{t('createAgent.model')}</label>
              {selectedProvider && selectedProvider.models.length > 0 ? (
                <select id="ai-model" value={model} disabled={generating} onChange={(e) => setModel(e.target.value)}>
                  <option value="">{t('createAgent.selectOption')}</option>
                  {selectedProvider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="ai-model"
                  value={model}
                  disabled={generating}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t('createAgent.modelPlaceholder')}
                />
              )}
            </div>
          </div>

          {blockedReason && !generating && <p className={styles.hint}>{blockedReason}</p>}

          {generating && (
            <div className="field">
              {/* Announce state transitions (thinking → streaming), not the raw
                  token stream, so screen readers aren't spammed per token. */}
              <span className={styles.liveBadge} role="status" aria-live="polite">
                {streamBuffer.length === 0 ? t('createAgent.thinking') : t('createAgent.streaming')}
              </span>
              {streamBuffer.length === 0 && reasoningBuffer.length > 0 && (
                <pre className={styles.streamPreview}>
                  {reasoningBuffer}
                  <span className={styles.caret} aria-hidden="true" />
                </pre>
              )}
              {streamBuffer.length > 0 && (
                <pre className={styles.streamPreview}>
                  {streamBuffer}
                  <span className={styles.caret} aria-hidden="true" />
                </pre>
              )}
            </div>
          )}

          {result && !result.ok && (
            <div className={styles.err} role="alert">
              <strong>{result.errorKind ?? t('createAgent.errorLabel')}</strong> — {result.errorSummary}
              {result.errorDetail && <div>{result.errorDetail}</div>}
              {result.rawText && (
                <div className={styles.rawWrap}>
                  <button type="button" onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? t('createAgent.hideRaw') : t('createAgent.showRaw')}
                  </button>
                  {result.errorKind === 'invalid-json' && (
                    <button type="button" onClick={handleRecoverDraft}>
                      {t('createAgent.recoverDraft')}
                    </button>
                  )}
                  {showRaw && <pre className={styles.streamPreview}>{result.rawText}</pre>}
                  {recoveryError && <div className={styles.recoveryErr}>{recoveryError}</div>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {draft && (
        <div className={styles.draftPreview}>
          <p className={styles.draftHead}>{t('createAgent.reviewHead')}</p>

          <div className="field">
            <label>{t('createAgent.name')}</label>
            <div className={styles.readonlyValue} dir="auto">{draft.name}</div>
          </div>
          <div className="field">
            <label>{t('createAgent.role')}</label>
            <div className={styles.readonlyValue} dir="auto">{draft.role || '—'}</div>
          </div>
          <div className="field">
            <label>{t('createAgent.persona')}</label>
            <div className={styles.readonlyValue} dir="auto">
              {draft.personaMode === 'digital-shadow'
                ? draft.persona?.realName
                  ? t('createAgent.digitalShadowOf', { name: draft.persona.realName })
                  : t('createAgent.digitalShadow')
                : t('createAgent.roleAgent')}
            </div>
          </div>
          <div className="field">
            <label>{t('createAgent.systemInstruction')}</label>
            <pre className={styles.preview} dir="auto">{draft.systemInstruction}</pre>
          </div>
          <div className="field">
            <label>{t('createAgent.characteristics')}</label>
            <div className={styles.charList}>
              <span className="chip">{t('createAgent.tone')}: {draft.characteristics.tone}</span>
              {CHAR_KEYS.map((key) => (
                <span key={key} className="chip">{t(`createAgent.char.${key}`)}: {draft.characteristics[key]}</span>
              ))}
            </div>
          </div>
          {draft.skills.length > 0 && (
            <div className="field">
              <label>{t('createAgent.skills', { n: draft.skills.length })}</label>
              {draft.skills.map((s, i) => (
                <div key={i} className={styles.skillPreview} dir="auto">
                  <strong>{s.name}</strong>
                  {s.description && <span className={styles.skillDesc}> — {s.description}</span>}
                  <div className={styles.skillInstruction}>{s.instruction}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
