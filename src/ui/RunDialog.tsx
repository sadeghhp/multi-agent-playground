import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useRunPresetStore } from '../store/runPresetStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import { validateForRun, hasBlockingErrors, reachableFrom } from '../orchestrator/validate';
import { startRun } from '../orchestrator/orchestrator';
import { applyRunPreset } from '../domain/factories';
import { resolveFailurePolicy, type FailureAction, type FailurePolicy } from '../domain/schema';
import { CONVERSATION_MODES, QUICK_START_PRESETS, type QuickStartPreset } from '../domain/runEnvironments';
import { parseBoundedInt } from './inputUtils';
import styles from './RunDialog.module.css';

export function RunDialog() {
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const updateConversation = useDomainStore((s) => s.updateConversation);
  const providers = useProviderStore((s) => s.providers);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);
  const presets = useRunPresetStore((s) => s.presets);
  const savePreset = useRunPresetStore((s) => s.savePreset);
  const deletePreset = useRunPresetStore((s) => s.deletePreset);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');

  const conversation = playground?.conversation;
  const policy = conversation ? resolveFailurePolicy(conversation) : null;
  // Write the policy and keep the legacy `stopOnError` boolean in sync so older
  // readers (and exports parsed by an older build) still stop on failure unless
  // the user explicitly chose to skip.
  const setPolicy = (patch: Partial<FailurePolicy>) => {
    if (!conversation) return;
    const next = { ...resolveFailurePolicy(conversation), ...patch };
    updateConversation({ failurePolicy: next, stopOnError: next.onFailure !== 'skip' });
  };
  const enabledAgents = useMemo(
    () => playground?.agents.filter((a) => a.runtime.enabled) ?? [],
    [playground],
  );

  // Suggest agents with no incoming edges as starting candidates (spec §11.5).
  const suggestedStarts = useMemo(() => {
    if (!playground) return new Set<string>();
    const withIncoming = new Set(playground.connections.filter((c) => c.enabled).map((c) => c.target));
    return new Set(enabledAgents.filter((a) => !withIncoming.has(a.id)).map((a) => a.id));
  }, [playground, enabledAgents]);

  const issues = useMemo(
    () => (playground ? validateForRun(playground, providers) : []),
    [playground, providers],
  );
  const blocking = hasBlockingErrors(issues);

  if (!playground || !conversation) return null;

  const routeCount = conversation.startingAgentId
    ? reachableFrom(playground, conversation.startingAgentId).size
    : 0;

  const activeMode = CONVERSATION_MODES.find((m) => m.value === conversation.conversationMode);

  // A quick-start is "active" when every field in its patch still matches the
  // current settings, so the chip can show what's currently in effect. Cheap to
  // recompute per render; the patches are tiny.
  const isQuickStartActive = (preset: QuickStartPreset) =>
    (Object.entries(preset.patch) as [keyof typeof preset.patch, unknown][]).every(
      ([key, value]) => conversation[key] === value,
    );

  function handleRun() {
    if (blocking) return;
    setPanel('none');
    void startRun();
  }

  return (
    <Modal
      title={t('run.title')}
      onClose={() => setPanel('none')}
      width={640}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => setPanel('none')}>{t('common.cancel')}</button>
          <button
            type="button"
            className="primary"
            onClick={handleRun}
            disabled={blocking}
            title={blocking ? t('run.startBlockedTooltip') : undefined}
          >
            {t('run.start')}
          </button>
        </>
      }
    >
      {/* ── Topic ── */}
      <section className={styles.section}>
        <div className="field">
          <label htmlFor="run-subject">{t('run.subjectLabel')}</label>
          <textarea
            id="run-subject"
            aria-required="true"
            value={conversation.subject}
            onChange={(e) => updateConversation({ subject: e.target.value })}
            placeholder={t('run.subjectPlaceholder')}
          />
        </div>

        <div className="field">
          <label htmlFor="run-objective">{t('run.objectiveLabel')}</label>
          <input
            id="run-objective"
            value={conversation.objective}
            onChange={(e) => updateConversation({ objective: e.target.value })}
            placeholder={t('run.objectivePlaceholder')}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="run-context">{t('run.contextLabel')}</label>
          <textarea
            id="run-context"
            value={conversation.initialContext}
            onChange={(e) => updateConversation({ initialContext: e.target.value })}
            placeholder={t('run.contextPlaceholder')}
          />
        </div>
      </section>

      {/* ── Presets ── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('run.presetsTitle')}</h3>
        <div className={styles.quickStart} role="group" aria-label={t('run.quickStartAria')}>
          <span className={styles.quickStartLabel}>{t('run.quickStarts')}</span>
          <div className={styles.chips}>
            {QUICK_START_PRESETS.map((preset) => {
              const active = isQuickStartActive(preset);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  title={preset.description}
                  aria-pressed={active}
                  onClick={() => updateConversation(preset.patch)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p className={styles.hint}>{t('run.quickStartHint')}</p>
        </div>

        <div className={styles.presetRow}>
          <div className="field">
            <label htmlFor="run-preset-load">{t('run.savedPresetsLabel')}</label>
            <select
              id="run-preset-load"
              value={selectedPresetId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedPresetId(id);
                const preset = presets.find((p) => p.id === id);
                if (preset) updateConversation(applyRunPreset(conversation, preset));
              }}
            >
              <option value="">
                {presets.length ? t('run.restorePreset') : t('run.noSavedPresets')}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id} dir="auto">{p.name}</option>
              ))}
            </select>
          </div>
          {selectedPresetId && (
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                const preset = presets.find((p) => p.id === selectedPresetId);
                if (!preset) return;
                const ok = await requestConfirm({
                  title: t('run.deletePresetTitle'),
                  message: t('run.deletePresetMessage', { name: preset.name }),
                  confirmLabel: t('common.delete'),
                  danger: true,
                });
                if (ok) {
                  void deletePreset(preset.id);
                  setSelectedPresetId('');
                }
              }}
            >
              {t('common.delete')}
            </button>
          )}
        </div>

        <div className={styles.presetRow} style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="run-preset-name">{t('run.savePresetLabel')}</label>
            <input
              id="run-preset-name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={t('run.savePresetPlaceholder')}
            />
          </div>
          <button
            type="button"
            className="secondary"
            disabled={!presetName.trim()}
            onClick={async () => {
              const saved = await savePreset(presetName.trim(), conversation);
              setPresetName('');
              setSelectedPresetId(saved.id);
            }}
          >
            {t('common.save')}
          </button>
        </div>
      </section>

      {/* ── Environment & style ── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('run.envStyleTitle')}</h3>

        <div className="field">
          <label htmlFor="run-mode">{t('run.conversationEnvLabel')}</label>
          <select
            id="run-mode"
            value={conversation.conversationMode}
            onChange={(e) => updateConversation({ conversationMode: e.target.value as typeof conversation.conversationMode })}
          >
            {CONVERSATION_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {activeMode && <p className={styles.hint}>{activeMode.hint}</p>}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="run-tone">{t('run.toneLabel')}</label>
            <input
              id="run-tone"
              value={conversation.toneOverride}
              onChange={(e) => updateConversation({ toneOverride: e.target.value })}
              placeholder={t('run.tonePlaceholder')}
            />
          </div>
          <div className="field">
            <label htmlFor="run-length">{t('run.responseLengthLabel')}</label>
            <select
              id="run-length"
              value={conversation.responseLength}
              onChange={(e) => updateConversation({ responseLength: e.target.value as typeof conversation.responseLength })}
            >
              <option value="agent-default">{t('run.lengthAgentDefault')}</option>
              <option value="short">{t('run.lengthShort')}</option>
              <option value="medium">{t('run.lengthMedium')}</option>
              <option value="long">{t('run.lengthLong')}</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="run-chitchat">{t('run.chitchatLabel')}</label>
            <select
              id="run-chitchat"
              value={conversation.chitchatPolicy}
              onChange={(e) => updateConversation({ chitchatPolicy: e.target.value as typeof conversation.chitchatPolicy })}
            >
              <option value="agent-default">{t('run.chitchatAllow')}</option>
              <option value="concise-factual">{t('run.chitchatDisallow')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="run-language">{t('run.languageLabel')}</label>
            <select
              id="run-language"
              value={conversation.languageOverride}
              onChange={(e) => updateConversation({ languageOverride: e.target.value as typeof conversation.languageOverride })}
            >
              <option value="agent-default">{t('run.languageAgentDefault')}</option>
              <option value="en">{t('run.languageForceEn')}</option>
              <option value="fa">{t('run.languageForceFa')}</option>
              <option value="fr">{t('run.languageForceFr')}</option>
            </select>
          </div>
        </div>

        <div className="field-row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="run-temperature">{t('run.temperatureLabel')}</label>
            <input
              id="run-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={conversation.temperatureOverride ?? ''}
              placeholder={t('run.temperaturePlaceholder')}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  updateConversation({ temperatureOverride: null });
                  return;
                }
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 0 && n <= 2) updateConversation({ temperatureOverride: n });
              }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="run-timeout">{t('run.timeoutLabel')}</label>
            <input
              id="run-timeout"
              type="number"
              min={1000}
              step={1000}
              value={conversation.responseTimeoutOverrideMs ?? ''}
              placeholder={t('run.timeoutPlaceholder')}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  updateConversation({ responseTimeoutOverrideMs: null });
                  return;
                }
                const n = parseBoundedInt(raw, 1000);
                if (n !== null) updateConversation({ responseTimeoutOverrideMs: n });
              }}
            />
          </div>
        </div>
      </section>

      {/* ── Flow & limits ── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('run.flowLimitsTitle')}</h3>

        <div className="field-row">
          <div className="field">
            <label htmlFor="run-start">{t('run.startingAgentLabel')}</label>
            <select
              id="run-start"
              value={conversation.startingAgentId ?? ''}
              onChange={(e) => updateConversation({ startingAgentId: e.target.value || null })}
            >
              <option value="">{t('run.selectPlaceholder')}</option>
              {enabledAgents.map((a) => (
                <option key={a.id} value={a.id} dir="auto">
                  {suggestedStarts.has(a.id) ? t('run.startingAgentSuggested', { name: a.name }) : a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="run-maxturns">{t('run.maxTurnsLabel')}</label>
            <input
              id="run-maxturns"
              type="number"
              min={1}
              value={conversation.maxTotalTurns}
              onChange={(e) => {
                const n = parseBoundedInt(e.target.value, 1);
                if (n !== null) updateConversation({ maxTotalTurns: n });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="run-maxper">{t('run.maxPerAgentLabel')}</label>
            <input
              id="run-maxper"
              type="number"
              min={1}
              value={conversation.maxResponsesPerAgent}
              onChange={(e) => {
                const n = parseBoundedInt(e.target.value, 1);
                if (n !== null) updateConversation({ maxResponsesPerAgent: n });
              }}
            />
          </div>
        </div>

        {policy && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="run-onfailure">{t('run.onFailureLabel')}</label>
              <select
                id="run-onfailure"
                value={policy.onFailure}
                onChange={(e) => setPolicy({ onFailure: e.target.value as FailureAction })}
              >
                <option value="stop">{t('run.failureStop')}</option>
                <option value="skip">{t('run.failureSkip')}</option>
                <option value="prompt">{t('run.failurePrompt')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="run-autoretries">{t('run.autoRetriesLabel')}</label>
              <input
                id="run-autoretries"
                type="number"
                min={0}
                max={10}
                value={policy.maxAutoRetries}
                onChange={(e) => {
                  const n = parseBoundedInt(e.target.value, 0);
                  if (n !== null) setPolicy({ maxAutoRetries: Math.min(n, 10) });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="run-autodisable">{t('run.autoDisableLabel')}</label>
              <input
                id="run-autodisable"
                type="number"
                min={0}
                value={policy.autoDisableAfterFailures}
                onChange={(e) => {
                  const n = parseBoundedInt(e.target.value, 0);
                  if (n !== null) setPolicy({ autoDisableAfterFailures: n });
                }}
              />
            </div>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {t('run.failureHelp')}
        </p>

        {conversation.startingAgentId && (
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            {t('run.reachable', { n: routeCount })}
          </p>
        )}
      </section>

      {issues.length > 0 && (
        <div className={styles.issues} role="group" aria-label={t('run.issuesAria')}>
          {blocking && <p className={styles.issuesHead}>{t('run.resolveBeforeStarting')}</p>}
          {issues.map((issue, i) => (
            <div
              key={`${issue.level}:${issue.agentId ?? ''}:${issue.message}:${i}`}
              className={issue.level === 'error' ? styles.error : styles.warning}
            >
              <span aria-hidden="true">{issue.level === 'error' ? '⛔' : '⚠'}</span> {issue.message}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
