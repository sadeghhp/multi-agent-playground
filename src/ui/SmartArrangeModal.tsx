import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  generateArrangement,
  normalizeArrangement,
  parseArrangementDraftFromText,
  type ArrangeResult,
  type ArrangementPlan,
} from '../agents/smartArrange';
import { layoutArrangement } from '../graph/autoLayout';
import { newConnectionId } from '../domain/ids';
import type { AgentKind, Connection, ConversationSettings } from '../domain/schema';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import styles from './CreateAgentWithAiModal.module.css';

/** Everything applyArrangement changes, captured before apply — the revert payload. */
interface ArrangementSnapshot {
  connections: Connection[];
  agentPatches: { id: string; kind: AgentKind; position: { x: number; y: number } }[];
  conversationPatch: Partial<ConversationSettings>;
}

/**
 * "Smart Arrange": type the subject, and an LLM wires the agents already on the
 * canvas into a conversation graph (connections, types, priorities, starting
 * agent, kind corrections), which is applied INSTANTLY with a deterministic
 * layered layout — the modal then offers one-click Revert. Mirrors
 * CreateAgentWithAiModal's generate/error/recover mechanics.
 */
export function SmartArrangeModal() {
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const applyArrangement = useDomainStore((s) => s.applyArrangement);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestFitView = useUiStore((s) => s.requestFitView);
  const showToast = useUiStore((s) => s.showToast);
  const providers = useProviderStore((s) => s.providers);
  const enabledProviders = providers.filter((p) => p.enabled);

  const [subject, setSubject] = useState(playground?.conversation.subject ?? '');
  const [providerId, setProviderId] = useState(enabledProviders[0]?.id ?? '');
  const selectedProvider = enabledProviders.find((p) => p.id === providerId);
  const [model, setModel] = useState(selectedProvider?.defaultModel ?? '');
  const [generating, setGenerating] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [reasoningBuffer, setReasoningBuffer] = useState('');
  const [result, setResult] = useState<ArrangeResult | null>(null);
  const [normalizeError, setNormalizeError] = useState<string | null>(null);
  const [applied, setApplied] = useState<ArrangementPlan | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<ArrangementSnapshot | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const enabledAgentCount = playground?.agents.filter((a) => a.runtime.enabled).length ?? 0;

  const blockedReason =
    enabledProviders.length === 0
      ? t('smartArrange.blocked.noProviders')
      : enabledAgentCount < 2
        ? t('smartArrange.blocked.needAgents')
        : !providerId
          ? t('smartArrange.blocked.selectProvider')
          : !model.trim()
            ? t('smartArrange.blocked.selectModel')
            : !subject.trim()
              ? t('smartArrange.blocked.enterSubject')
              : null;
  const canGenerate = !blockedReason && !generating;

  /** Apply a normalized plan instantly (per the chosen UX) and arm Revert. */
  function applyPlan(plan: ArrangementPlan) {
    const pg = useDomainStore.getState().playground;
    if (!pg) return;

    snapshotRef.current = {
      connections: pg.connections.map((c) => ({ ...c })),
      agentPatches: pg.agents.map((a) => ({ id: a.id, kind: a.kind, position: { ...a.position } })),
      conversationPatch: {
        subject: pg.conversation.subject,
        startingAgentId: pg.conversation.startingAgentId,
        conversationMode: pg.conversation.conversationMode,
        maxTotalTurns: pg.conversation.maxTotalTurns,
        maxResponsesPerAgent: pg.conversation.maxResponsesPerAgent,
      },
    };

    const connections: Connection[] = plan.connections.map((c) => ({ ...c, id: newConnectionId() }));
    const correctedKind = new Map(plan.kindCorrections.map((c) => [c.agentId, c.kind]));
    const kindOf = (id: string): AgentKind =>
      correctedKind.get(id) ?? pg.agents.find((a) => a.id === id)?.kind ?? 'participant';
    const positions = layoutArrangement(pg.agents, connections, plan.startingAgentId, kindOf);

    applyArrangement({
      connections,
      agentPatches: pg.agents.map((a) => ({
        id: a.id,
        position: positions.get(a.id) ?? a.position,
        ...(correctedKind.has(a.id) ? { kind: correctedKind.get(a.id) } : {}),
      })),
      conversationPatch: {
        subject: subject.trim(),
        startingAgentId: plan.startingAgentId,
        ...plan.settings,
      },
    });
    requestFitView();
    setApplied(plan);
  }

  async function handleGenerate() {
    if (!canGenerate || !selectedProvider || !playground) return;
    setGenerating(true);
    setResult(null);
    setNormalizeError(null);
    setStreamBuffer('');
    setReasoningBuffer('');
    setShowRaw(false);
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await generateArrangement(
      subject,
      playground.conversation.objective,
      playground.agents,
      selectedProvider,
      model,
      {
        signal: controller.signal,
        timeoutMs: selectedProvider.timeoutMs,
        onToken: (chunk) => {
          if (abortRef.current === controller) setStreamBuffer((b) => b + chunk);
        },
        onReasoningToken: (chunk) => {
          if (abortRef.current === controller) setReasoningBuffer((b) => b + chunk);
        },
      },
    );

    // Drop stale results: the modal may have been closed/reopened mid-flight.
    if (abortRef.current !== controller) return;
    setGenerating(false);
    if (!res.ok || !res.draft) {
      setResult(res);
      return;
    }
    const normalized = normalizeArrangement(res.draft, playground.agents);
    if (!normalized.ok) {
      setResult({ ...res, ok: false, errorKind: 'invalid-arrangement', errorSummary: normalized.errorSummary, rawText: res.rawText });
      return;
    }
    applyPlan(normalized.plan);
  }

  function handleRecover() {
    if (!result?.rawText || !playground) return;
    setNormalizeError(null);
    const parsed = parseArrangementDraftFromText(result.rawText);
    if (!parsed.ok) {
      setNormalizeError(
        t('smartArrange.recoveryFailed', { detail: parsed.errorDetail ?? parsed.errorSummary }),
      );
      return;
    }
    const normalized = normalizeArrangement(parsed.draft, playground.agents);
    if (!normalized.ok) {
      setNormalizeError(t('smartArrange.recoveryFailed', { detail: normalized.errorSummary }));
      return;
    }
    setResult(null);
    setShowRaw(false);
    applyPlan(normalized.plan);
  }

  function handleRevert() {
    if (!snapshotRef.current) return;
    applyArrangement(snapshotRef.current);
    snapshotRef.current = null;
    setApplied(null);
    requestFitView();
    showToast('info', t('smartArrange.reverted'));
  }

  function handleClose() {
    abortRef.current?.abort();
    setPanel('none');
  }

  const agentName = (id: string) =>
    playground?.agents.find((a) => a.id === id)?.name ?? id;

  return (
    <Modal
      title={t('smartArrange.title')}
      onClose={handleClose}
      width={560}
      footer={
        applied ? (
          <>
            <button type="button" onClick={handleRevert}>{t('smartArrange.revert')}</button>
            <button type="button" className="primary" onClick={handleClose}>{t('smartArrange.done')}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={handleClose}>{t('common.cancel')}</button>
            <button
              type="button"
              className="primary"
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
              title={blockedReason ?? t('smartArrange.arrangeHint')}
            >
              {generating ? t('smartArrange.arranging') : t('smartArrange.arrange')}
            </button>
          </>
        )
      }
    >
      {!applied && (
        <>
          <p className={styles.hint}>{t('smartArrange.intro')}</p>
          <div className="field">
            <label htmlFor="arr-subject">{t('smartArrange.subjectLabel')}</label>
            <textarea
              id="arr-subject"
              rows={2}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('smartArrange.subjectPlaceholder')}
              disabled={generating}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="arr-provider">{t('smartArrange.provider')}</label>
              <select
                id="arr-provider"
                value={providerId}
                disabled={generating}
                onChange={(e) => {
                  const p = enabledProviders.find((pv) => pv.id === e.target.value);
                  setProviderId(e.target.value);
                  setModel(p?.defaultModel ?? '');
                }}
              >
                <option value="">{t('smartArrange.selectOption')}</option>
                {enabledProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="arr-model">{t('smartArrange.model')}</label>
              {selectedProvider && selectedProvider.models.length > 0 ? (
                <select id="arr-model" value={model} disabled={generating} onChange={(e) => setModel(e.target.value)}>
                  <option value="">{t('smartArrange.selectOption')}</option>
                  {selectedProvider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="arr-model"
                  value={model}
                  disabled={generating}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t('smartArrange.modelPlaceholder')}
                />
              )}
            </div>
          </div>

          {blockedReason && !generating && <p className={styles.hint}>{blockedReason}</p>}

          {generating && (
            <div className="field">
              <span className={styles.liveBadge} role="status" aria-live="polite">
                {streamBuffer.length === 0 ? t('smartArrange.thinking') : t('smartArrange.streaming')}
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
              <strong>{result.errorKind ?? t('smartArrange.errorLabel')}</strong> — {result.errorSummary}
              {result.errorDetail && <div>{result.errorDetail}</div>}
              {result.rawText && (
                <div className={styles.rawWrap}>
                  <button type="button" onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? t('smartArrange.hideRaw') : t('smartArrange.showRaw')}
                  </button>
                  {(result.errorKind === 'invalid-json' || result.errorKind === 'invalid-arrangement') && (
                    <button type="button" onClick={handleRecover}>
                      {t('smartArrange.recoverArrangement')}
                    </button>
                  )}
                  {showRaw && <pre className={styles.streamPreview}>{result.rawText}</pre>}
                  {normalizeError && <div className={styles.recoveryErr}>{normalizeError}</div>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {applied && (
        <div className={styles.draftPreview}>
          <p className={styles.draftHead}>{t('smartArrange.appliedHead')}</p>
          {applied.rationale && <p dir="auto">{applied.rationale}</p>}
          <div className="field">
            <label>{t('smartArrange.startsWith')}</label>
            <div className={styles.readonlyValue} dir="auto">{agentName(applied.startingAgentId)}</div>
          </div>
          <div className="field">
            <label>{t('smartArrange.connections', { n: applied.connections.length })}</label>
            {applied.connections.map((c, i) => (
              <div key={i} className={styles.readonlyValue} dir="auto">
                {agentName(c.source)} → {agentName(c.target)} · {c.type}
                {c.priority !== 0 ? ` · ${t('smartArrange.priority', { n: c.priority })}` : ''}
                {c.label ? ` · ${c.label}` : ''}
              </div>
            ))}
          </div>
          {applied.kindCorrections.length > 0 && (
            <div className="field">
              <label>{t('smartArrange.kindChanges')}</label>
              {applied.kindCorrections.map((c, i) => (
                <div key={i} className={styles.readonlyValue} dir="auto">
                  {agentName(c.agentId)} → {c.kind}
                </div>
              ))}
            </div>
          )}
          {Object.keys(applied.settings).length > 0 && (
            <div className="field">
              <label>{t('smartArrange.suggestedSettings')}</label>
              <div className={styles.charList}>
                {applied.settings.conversationMode && (
                  <span className="chip">{t('smartArrange.mode', { mode: applied.settings.conversationMode })}</span>
                )}
                {applied.settings.maxTotalTurns != null && (
                  <span className="chip">{t('smartArrange.maxTurns', { n: applied.settings.maxTotalTurns })}</span>
                )}
                {applied.settings.maxResponsesPerAgent != null && (
                  <span className="chip">{t('smartArrange.perAgent', { n: applied.settings.maxResponsesPerAgent })}</span>
                )}
              </div>
            </div>
          )}
          {applied.notes.length > 0 && (
            <div className="field">
              <label>{t('smartArrange.adjustments')}</label>
              {applied.notes.map((n, i) => (
                <p key={i} className={styles.hint} dir="auto">{n}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
