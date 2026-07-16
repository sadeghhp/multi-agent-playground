import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent, AgentKind, ConnectionType, PersonaCitationStyle, PersonaMode, Skill } from '../../domain/schema';
import { KIND_LABEL, isTerminalKind } from '../../domain/agentKind';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { useAgentLibraryStore } from '../../store/agentLibraryStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { newConnectionId, newSkillId } from '../../domain/ids';
import { SKILL_PRESETS } from '../../domain/factories';
import { defaultPersonaConfig } from '../../domain/persona';
import { assembleMessages, boundHistory, buildSystemPrompt, buildTaskPrompt, estimateTokens } from '../../agents/promptAssembly';
import { enhanceSystemInstruction, type EnhancePromptResult } from '../../agents/enhancePrompt';
import { enrichAgentDraft, enrichedDraftToAgentOverrides, type EnrichAgentResult } from '../../agents/enrichAgent';
import type { EnrichAgentDraft } from '../../agents/generateAgent';
import { parseEnrichAgentDraftFromText } from '../../agents/parseGeneratedAgentDraft';
import { exportSkillSet, importSkillSet } from '../../persistence/skillSets';
import { TOOLS, toolAvailable } from '../../tools/registry';
import { CONTROL_TOOL_IDS_BY_KIND, CONTROL_TOOL_META, grantedControlToolIds } from '../../tools/control';
import { setTavilyKey } from '../../tools/tavily';
import { downloadJson } from '../fileDownload';
import { validateForRun } from '../../orchestrator/validate';
import { Section } from './Section';
import { parseBoundedInt } from '../inputUtils';
import { useDebouncedValue } from '../useDebouncedValue';
import styles from './Inspector.module.css';

/** agentIssues/preview recompute (graph-wide validation, full prompt assembly)
 * only needs to track the user's edits, not their every keystroke. */
const PREVIEW_DEBOUNCE_MS = 300;

const COLORS: Agent['colorCategory'][] = ['slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal'];

export function AgentInspector({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const update = useDomainStore((s) => s.updateAgent);
  const duplicate = useDomainStore((s) => s.duplicateAgentById);
  const remove = useDomainStore((s) => s.removeAgent);
  const addConnection = useDomainStore((s) => s.addConnection);
  const removeConnection = useDomainStore((s) => s.removeConnection);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const selectConnection = useUiStore((s) => s.selectConnection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const showToast = useUiStore((s) => s.showToast);
  const requestConfirm = useUiStore((s) => s.requestConfirm);
  const saveToLibrary = useAgentLibraryStore((s) => s.saveAgent);
  const isRunning = useRuntimeStore((s) => s.status === 'running');

  const [newTarget, setNewTarget] = useState('');
  const [newType, setNewType] = useState<ConnectionType>('conversation');
  // Draft only — persisted to the credential store on blur, never kept in state.
  const [tavilyKeyDraft, setTavilyKeyDraft] = useState('');
  const skillFileInput = useRef<HTMLInputElement>(null);

  const library = playground?.skillLibrary ?? [];

  // System-prompt enhancer state (in-flight flag, the proposed rewrite awaiting
  // Apply/Discard, and any sanitized provider error).
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceProposal, setEnhanceProposal] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<EnhancePromptResult | null>(null);

  const providers = useProviderStore((s) => s.providers);
  const selectedProvider = providers.find((p) => p.id === agent.llm.providerId);

  // Why the enhancer is unavailable, if it is — surfaced as a hint next to the button.
  const enhanceBlockedReason = !selectedProvider
    ? t('inspector.enhanceBlockedNoProvider')
    : !selectedProvider.enabled
      ? t('inspector.enhanceBlockedProviderDisabled')
      : !agent.llm.model.trim()
        ? t('inspector.enhanceBlockedNoModel')
        : null;
  const canEnhance = !enhanceBlockedReason && !enhancing;

  async function handleEnhance() {
    if (!selectedProvider || !canEnhance) return;
    setEnhancing(true);
    setEnhanceProposal(null);
    setEnhanceError(null);
    try {
      const result = await enhanceSystemInstruction(agent, selectedProvider, {
        timeoutMs: agent.runtime.responseTimeoutMs,
      });
      if (result.ok && result.text) {
        setEnhanceProposal(result.text);
      } else {
        setEnhanceError(result);
      }
    } finally {
      setEnhancing(false);
    }
  }

  function applyEnhancement() {
    if (enhanceProposal !== null) patch({ systemInstruction: enhanceProposal });
    setEnhanceProposal(null);
  }

  // Whole-agent enricher state: free-text "new information" the user has
  // learned about this agent, sent to the model to mature the full spec
  // (role, instruction, characteristics, skills) around it.
  const [enriching, setEnriching] = useState(false);
  const [enrichInfo, setEnrichInfo] = useState('');
  const [enrichProposal, setEnrichProposal] = useState<EnrichAgentDraft | null>(null);
  const [enrichError, setEnrichError] = useState<EnrichAgentResult | null>(null);
  const [enrichShowRaw, setEnrichShowRaw] = useState(false);
  const [enrichRecoveryError, setEnrichRecoveryError] = useState<string | null>(null);

  async function handleEnrich() {
    if (!selectedProvider || !canEnhance || !enrichInfo.trim()) return;
    setEnriching(true);
    setEnrichProposal(null);
    setEnrichError(null);
    setEnrichShowRaw(false);
    setEnrichRecoveryError(null);
    try {
      const result = await enrichAgentDraft(agent, enrichInfo, selectedProvider, {
        timeoutMs: agent.runtime.responseTimeoutMs,
      });
      if (result.ok && result.draft) {
        setEnrichProposal(result.draft);
      } else {
        setEnrichError(result);
      }
    } finally {
      setEnriching(false);
    }
  }

  function handleRecoverEnrichDraft() {
    if (!enrichError?.rawText) return;
    setEnrichRecoveryError(null);
    const recovered = parseEnrichAgentDraftFromText(enrichError.rawText);
    if (recovered.ok) {
      setEnrichProposal(recovered.draft);
      setEnrichError(null);
      setEnrichShowRaw(false);
      return;
    }
    setEnrichRecoveryError(
      t('inspector.recoveryFailed', {
        detail: recovered.errorDetail ?? recovered.errorSummary,
      }),
    );
  }

  function applyEnrichment() {
    if (enrichProposal) patch(enrichedDraftToAgentOverrides(agent, enrichProposal));
    setEnrichProposal(null);
    setEnrichInfo('');
  }

  function formatEnrichPreview(draft: EnrichAgentDraft): string {
    // Enrich preserves omitted fields; reflect that in the preview instead of
    // implying a reset. Fall back to the current agent's value where the draft
    // left a field out.
    const personaMode = draft.personaMode ?? agent.personaMode;
    const lines: string[] = [
      `Name: ${draft.name}`,
      `Role: ${draft.role}`,
      `Persona: ${personaMode}`,
    ];
    if (personaMode === 'digital-shadow' && draft.persona?.realName) {
      lines.push(`Shadow of: ${draft.persona.realName}`);
    }
    if (draft.description) lines.push(`Description: ${draft.description}`);
    lines.push('', 'System instruction:', draft.systemInstruction);
    if (draft.skills === undefined) {
      lines.push('', 'Skills: (unchanged)');
    } else {
      lines.push('', `Skills (${draft.skills.length}):`);
      if (draft.skills.length === 0) lines.push('(none)');
      for (const s of draft.skills) lines.push(`- ${s.name}${s.description ? `: ${s.description}` : ''}`);
    }
    return lines.join('\n');
  }

  function patchPersonaMode(mode: PersonaMode) {
    if (mode === 'digital-shadow') {
      const persona = agent.persona ?? defaultPersonaConfig();
      const realName = persona.realName.trim();
      const roleSuggestion =
        !agent.role.trim() || /^digital shadow/i.test(agent.role)
          ? realName
            ? `Digital shadow of ${realName}`
            : 'Digital shadow'
          : agent.role;
      patch({ personaMode: mode, persona, role: roleSuggestion });
      return;
    }
    patch({ personaMode: mode });
  }

  function patchPersona(p: Partial<NonNullable<Agent['persona']>>) {
    const persona = { ...(agent.persona ?? defaultPersonaConfig()), ...p };
    const next: Partial<Agent> = { persona };
    // Keep role label aligned when user fills in the real name and role is still the default stub.
    if (
      p.realName !== undefined &&
      (!agent.role.trim() || /^digital shadow(?: of .+)?$/i.test(agent.role))
    ) {
      next.role = persona.realName.trim()
        ? `Digital shadow of ${persona.realName.trim()}`
        : 'Digital shadow';
    }
    patch(next);
  }

  // Outgoing connections + which agents are still available as new targets.
  const outgoing = (playground?.connections ?? []).filter((c) => c.source === agent.id);
  const outgoingTargets = new Set(outgoing.map((c) => c.target));
  const availableTargets = (playground?.agents ?? []).filter(
    (a) => a.id !== agent.id && !outgoingTargets.has(a.id),
  );

  function handleAddConnection() {
    if (!newTarget) return;
    addConnection({
      id: newConnectionId(),
      source: agent.id,
      target: newTarget,
      enabled: true,
      type: newType,
      priority: 0,
    });
    setNewTarget('');
  }

  // Debounced so graph-wide validation and prompt assembly (both non-trivial
  // for larger playgrounds) run once the user pauses, not on every keystroke.
  const debouncedPlayground = useDebouncedValue(playground, PREVIEW_DEBOUNCE_MS);
  const debouncedAgent = useDebouncedValue(agent, PREVIEW_DEBOUNCE_MS);

  const agentIssues = useMemo(
    () =>
      debouncedPlayground
        ? validateForRun(debouncedPlayground, providers).filter((i) => i.agentId === agent.id)
        : [],
    [debouncedPlayground, providers, agent.id],
  );

  function patch(p: Partial<Agent>) {
    update(agent.id, p);
  }
  function patchLlm(p: Partial<Agent['llm']>) {
    update(agent.id, { llm: { ...agent.llm, ...p } });
  }
  function patchRuntime(p: Partial<Agent['runtime']>) {
    update(agent.id, { runtime: { ...agent.runtime, ...p } });
  }
  function patchChar(p: Partial<Agent['characteristics']>) {
    update(agent.id, { characteristics: { ...agent.characteristics, ...p } });
  }

  // ---- Skills -------------------------------------------------------------
  function patchSkillAt(idx: number, p: Partial<Skill>) {
    const skills = agent.skills.map((s, i) => (i === idx ? { ...s, ...p } : s));
    patch({ skills });
  }
  function removeSkill(id: string) {
    patch({ skills: agent.skills.filter((s) => s.id !== id) });
  }
  function duplicateSkill(idx: number) {
    const skill = agent.skills[idx];
    const skills = [...agent.skills];
    // Fresh id + drop the library link so the copy is an independent skill.
    skills.splice(idx + 1, 0, { ...skill, id: newSkillId(), libraryId: undefined });
    patch({ skills });
  }
  function moveSkill(idx: number, dir: -1 | 1) {
    const to = idx + dir;
    if (to < 0 || to >= agent.skills.length) return;
    const skills = [...agent.skills];
    [skills[idx], skills[to]] = [skills[to], skills[idx]];
    patch({ skills });
  }
  function addBlankSkill() {
    patch({ skills: [...agent.skills, { id: newSkillId(), name: 'new skill', description: '', instruction: '', enabled: true }] });
  }
  /** Attach a copy of a library entry (value = library id) or preset (value = `preset:<name>`). */
  function addFromLibrary(value: string) {
    if (!value) return;
    let source: { name: string; description: string; instruction: string } | undefined;
    let libraryId: string | undefined;
    if (value.startsWith('preset:')) {
      source = SKILL_PRESETS.find((p) => p.name === value.slice('preset:'.length));
    } else {
      const entry = library.find((s) => s.id === value);
      if (entry) {
        source = entry;
        libraryId = entry.id;
      }
    }
    if (!source) return;
    patch({
      skills: [
        ...agent.skills,
        { id: newSkillId(), name: source.name, description: source.description, instruction: source.instruction, enabled: true, libraryId },
      ],
    });
  }
  /** Overwrite a linked skill's content from its library entry, keeping enabled state. */
  function resyncSkill(idx: number) {
    const skill = agent.skills[idx];
    const entry = skill.libraryId ? library.find((s) => s.id === skill.libraryId) : undefined;
    if (!entry) return;
    patchSkillAt(idx, { name: entry.name, description: entry.description, instruction: entry.instruction });
  }

  function handleExportSkills() {
    if (agent.skills.length === 0) {
      showToast('warn', t('inspector.noSkillsToExport'));
      return;
    }
    downloadJson(`${agent.name || 'agent'}-skills`, exportSkillSet(agent.skills));
  }
  async function handleImportSkills(file: File) {
    const result = importSkillSet(await file.text());
    if (!result.ok) {
      showToast('error', result.error ?? t('inspector.importFailed'));
      return;
    }
    // Imported skills are enabled and unlinked (their ids come from another set).
    const imported: Skill[] = result.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      instruction: s.instruction,
      enabled: true,
    }));
    patch({ skills: [...agent.skills, ...imported] });
    showToast('info', t('inspector.importedSkills', { count: imported.length }));
  }

  function handleDuplicate() {
    const copy = duplicate(agent.id);
    if (copy) selectAgent(copy.id);
  }

  async function handleSaveToLibrary() {
    // Snapshot the agent's current config into the cross-playground library.
    await saveToLibrary(agent);
    showToast('info', t('inspector.savedToLibrary', { name: agent.name }));
  }

  async function handleDelete() {
    const hasConnections =
      playground?.connections.some((c) => c.source === agent.id || c.target === agent.id) ?? false;
    const ok = await requestConfirm({
      title: t('inspector.deleteAgentTitle'),
      message: hasConnections
        ? t('inspector.deleteAgentMessageWithConnections', { name: agent.name })
        : t('inspector.deleteAgentMessage', { name: agent.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    remove(agent.id);
    clearSelection();
  }

  const { preview, estTokens } = useMemo(() => {
    if (!debouncedPlayground) return { preview: '', estTokens: 0 };
    // Preview against the actual bounded history so the estimate reflects a real
    // request, not an empty one (spec §11.6 — clearly an estimate).
    const history = debouncedAgent.runtime.includeHistory
      ? boundHistory(debouncedPlayground.transcript, debouncedAgent.runtime.historyWindow)
      : [];
    // Mirror orchestrator.findLastUserDirective so the preview reflects a
    // pending follow-up (see continueRun) exactly as a real turn would.
    const transcript = debouncedPlayground.transcript;
    let pendingUserDirective: string | null = null;
    for (let i = transcript.length - 1; i >= 0; i--) {
      const m = transcript[i];
      if (m.agentId === null && m.role === 'user' && m.content) { pendingUserDirective = m.content; break; }
    }
    const ctx = {
      agent: debouncedAgent,
      conversation: debouncedPlayground.conversation,
      history,
      incoming: null,
      isFirstTurn: true,
      pendingUserDirective,
      // Roster for control-tool descriptions, so the preview lists the same
      // addressable agent names the live run would.
      roster: debouncedPlayground.agents.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        enabled: a.runtime.enabled,
      })),
    };
    const text = `${buildSystemPrompt(ctx)}\n\n--- USER TURN ---\n${buildTaskPrompt(ctx)}`;
    const full = assembleMessages(ctx)
      .map((m) => m.content)
      .join('\n');
    return { preview: text, estTokens: estimateTokens(full) };
    // Depend on the specific fields read (conversation, transcript), not the
    // whole debouncedPlayground object — recomputing this preview on every
    // unrelated playground change (other agents, UI layout, etc.) is exactly
    // the wasted work the debounce in this hook exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAgent, debouncedPlayground?.conversation, debouncedPlayground?.transcript]);

  // Guarded defensively (after all hooks, to satisfy the Rules of Hooks) — the
  // parent (Inspector.tsx) only ever mounts this component with an `agent`
  // resolved from the active playground, so `playground` is structurally
  // non-null whenever this renders in practice. This guard is a backstop
  // against a future caller reaching this component some other way.
  if (!playground) return null;

  return (
    <fieldset className={styles.body} disabled={isRunning}>
      {isRunning && <p className={styles.hint}>{t('inspector.editingLocked')}</p>}
      <div className={styles.actions}>
        <label className={styles.enableToggle}>
          <input
            type="checkbox"
            checked={agent.runtime.enabled}
            onChange={(e) => patchRuntime({ enabled: e.target.checked })}
          />
          {t('inspector.enabled')}
        </label>
        <div className={styles.actionButtons}>
          <button type="button" onClick={() => void handleSaveToLibrary()}>{t('inspector.saveToLibrary')}</button>
          <button type="button" onClick={handleDuplicate}>{t('inspector.duplicate')}</button>
          <button type="button" className="danger" onClick={handleDelete}>{t('common.delete')}</button>
        </div>
      </div>

      {agentIssues.length > 0 && (
        <div className={styles.issues}>
          {agentIssues.map((i, idx) => (
            <div key={idx} className={i.level === 'error' ? styles.issueError : styles.issueWarn}>
              {i.message}
            </div>
          ))}
        </div>
      )}

      <Section title={t('inspector.enrichWithAiTitle')}>
        <p className={styles.hint}>
          {t('inspector.enrichHint')}
        </p>
        <textarea
          rows={3}
          placeholder={t('inspector.enrichPlaceholder')}
          value={enrichInfo}
          onChange={(e) => setEnrichInfo(e.target.value)}
        />
        <div className={styles.enhanceBar}>
          <button
            type="button"
            onClick={() => void handleEnrich()}
            disabled={!canEnhance || !enrichInfo.trim() || enriching}
            title={enhanceBlockedReason ?? t('inspector.enrichTitle')}
          >
            {enriching ? t('inspector.enriching') : t('inspector.enrichButton')}
          </button>
          {enhanceBlockedReason && !enriching && (
            <span className={styles.enhanceStatus}>{enhanceBlockedReason}</span>
          )}
        </div>

        {enrichError && (
          <div className={styles.enhanceErr}>
            <strong>{enrichError.errorKind ?? 'error'}</strong> — {enrichError.errorSummary}
            {enrichError.errorDetail && <div>{enrichError.errorDetail}</div>}
            {enrichError.rawText && (
              <div className={styles.rawWrap}>
                <button type="button" onClick={() => setEnrichShowRaw((v) => !v)}>
                  {enrichShowRaw ? t('inspector.hideRawResponse') : t('inspector.showRawResponse')}
                </button>
                {enrichError.errorKind === 'invalid-json' && (
                  <button type="button" onClick={handleRecoverEnrichDraft}>
                    {t('inspector.recoverDraft')}
                  </button>
                )}
                {enrichShowRaw && <pre className={styles.preview} dir="auto">{enrichError.rawText}</pre>}
                {enrichRecoveryError && <div className={styles.recoveryErr}>{enrichRecoveryError}</div>}
              </div>
            )}
          </div>
        )}

        {enrichProposal && (
          <div className={styles.enhanceResult}>
            <p className={styles.enhanceResultHead}>{t('inspector.suggestedUpdate')}</p>
            <pre className={styles.preview} dir="auto">{formatEnrichPreview(enrichProposal)}</pre>
            <div className={styles.enhanceActions}>
              <button type="button" className="primary" onClick={applyEnrichment}>{t('inspector.apply')}</button>
              <button type="button" onClick={() => setEnrichProposal(null)}>{t('inspector.discard')}</button>
            </div>
          </div>
        )}
      </Section>

      <Section title={t('inspector.identityTitle')} defaultOpen>
        <div className="field">
          <label htmlFor="ag-name">{t('inspector.nameLabel')}</label>
          <input id="ag-name" value={agent.name} onChange={(e) => patch({ name: e.target.value })} dir="auto" />
        </div>
        <div className="field">
          <label htmlFor="ag-desc">{t('inspector.descriptionLabel')}</label>
          <input id="ag-desc" value={agent.description} onChange={(e) => patch({ description: e.target.value })} dir="auto" />
        </div>
        <div className="field">
          <label>{t('inspector.colorLabel')}</label>
          <div className={styles.colors}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t(`inspector.color_${c}`)}
                aria-pressed={agent.colorCategory === c}
                className={`${styles.swatch} ${styles[`sw_${c}`]} ${agent.colorCategory === c ? styles.swActive : ''}`}
                onClick={() => patch({ colorCategory: c })}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title={t('inspector.personaTitle')} defaultOpen>
        <p className={styles.hint}>
          {t('inspector.personaHint')}
        </p>
        <div className="field">
          <label htmlFor="ag-persona-mode">{t('inspector.personaModeLabel')}</label>
          <select
            id="ag-persona-mode"
            value={agent.personaMode}
            onChange={(e) => patchPersonaMode(e.target.value as PersonaMode)}
          >
            <option value="role">{t('inspector.personaRoleAgent')}</option>
            <option value="digital-shadow">{t('inspector.personaDigitalShadow')}</option>
          </select>
        </div>
        {agent.personaMode === 'digital-shadow' && (
          <>
            <div className="field">
              <label htmlFor="ag-persona-real">{t('inspector.realPersonNameLabel')}</label>
              <input
                id="ag-persona-real"
                value={agent.persona?.realName ?? ''}
                onChange={(e) => patchPersona({ realName: e.target.value })}
                placeholder={t('inspector.realPersonNamePlaceholder')}
                dir="auto"
              />
            </div>
            <div className="field">
              <label htmlFor="ag-persona-known">{t('inspector.knownForLabel')}</label>
              <input
                id="ag-persona-known"
                value={agent.persona?.knownFor ?? ''}
                onChange={(e) => patchPersona({ knownFor: e.target.value })}
                placeholder={t('inspector.knownForPlaceholder')}
                dir="auto"
              />
            </div>
            <div className="field">
              <label htmlFor="ag-persona-stance">{t('inspector.stanceNotesLabel')}</label>
              <textarea
                id="ag-persona-stance"
                rows={4}
                value={agent.persona?.stanceNotes ?? ''}
                onChange={(e) => patchPersona({ stanceNotes: e.target.value })}
                placeholder={t('inspector.stanceNotesPlaceholder')}
                dir="auto"
              />
            </div>
            <div className="field">
              <label htmlFor="ag-persona-cite">{t('inspector.citationStyleLabel')}</label>
              <select
                id="ag-persona-cite"
                value={agent.persona?.citationStyle ?? 'in-character'}
                onChange={(e) =>
                  patchPersona({ citationStyle: e.target.value as PersonaCitationStyle })
                }
              >
                <option value="in-character">{t('inspector.citationInCharacter')}</option>
                <option value="attributed">{t('inspector.citationAttributed')}</option>
              </select>
            </div>
          </>
        )}
      </Section>

      <Section title={t('inspector.roleInstructionTitle')} defaultOpen>
        <div className="field">
          <label htmlFor="ag-kind">{t('inspector.typeLabel')}</label>
          <select
            id="ag-kind"
            value={agent.kind}
            onChange={(e) => patch({ kind: e.target.value as AgentKind })}
          >
            <option value="participant">{t('inspector.kindParticipantOption', { label: KIND_LABEL.participant })}</option>
            <option value="moderator">{t('inspector.kindModeratorOption', { label: KIND_LABEL.moderator })}</option>
            <option value="summarizer">{t('inspector.kindSummarizerOption', { label: KIND_LABEL.summarizer })}</option>
            <option value="finalizer">{t('inspector.kindFinalizerOption', { label: KIND_LABEL.finalizer })}</option>
          </select>
          {isTerminalKind(agent.kind) && (
            <p className={styles.hint}>
              {agent.kind === 'finalizer'
                ? t('inspector.terminalKindHintFinalizer')
                : t('inspector.terminalKindHintSummarizer')}
            </p>
          )}
          {agent.kind === 'moderator' && (
            <p className={styles.hint}>
              {t('inspector.moderatorHint')}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="ag-role">{t('inspector.roleLabel')}</label>
          <input id="ag-role" value={agent.role} onChange={(e) => patch({ role: e.target.value })} placeholder={t('inspector.rolePlaceholder')} dir="auto" />
        </div>
        <div className="field">
          <label htmlFor="ag-sys">{t('inspector.systemInstructionLabel')}</label>
          <textarea
            id="ag-sys"
            rows={4}
            value={agent.systemInstruction}
            onChange={(e) => patch({ systemInstruction: e.target.value })}
            dir="auto"
          />
          <div className={styles.enhanceBar}>
            <button
              type="button"
              onClick={handleEnhance}
              disabled={!canEnhance}
              title={enhanceBlockedReason ?? t('inspector.enhanceTitle')}
            >
              {enhancing ? t('inspector.enhancing') : t('inspector.enhanceButton')}
            </button>
            {enhanceBlockedReason && !enhancing && (
              <span className={styles.enhanceStatus}>{enhanceBlockedReason}</span>
            )}
          </div>

          {enhanceError && (
            <div className={styles.enhanceErr}>
              <strong>{enhanceError.errorKind ?? 'error'}</strong> — {enhanceError.errorSummary}
              {enhanceError.errorDetail && <div>{enhanceError.errorDetail}</div>}
            </div>
          )}

          {enhanceProposal !== null && (
            <div className={styles.enhanceResult}>
              <p className={styles.enhanceResultHead}>{t('inspector.suggestedInstruction')}</p>
              <pre className={styles.preview} dir="auto">{enhanceProposal}</pre>
              <div className={styles.enhanceActions}>
                <button type="button" className="primary" onClick={applyEnhancement}>{t('inspector.apply')}</button>
                <button type="button" onClick={() => setEnhanceProposal(null)}>{t('inspector.discard')}</button>
              </div>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="ag-lang">{t('inspector.languageLabel')}</label>
          <select
            id="ag-lang"
            value={agent.language}
            onChange={(e) => patch({ language: e.target.value as Agent['language'] })}
          >
            <option value="en">English</option>
            <option value="fa">فارسی (Persian)</option>
            <option value="fr">Français (French)</option>
          </select>
        </div>
      </Section>

      <Section title={t('inspector.characteristicsTitle')}>
        <div className="field">
          <label htmlFor="ag-tone">{t('inspector.toneLabel')}</label>
          <input id="ag-tone" value={agent.characteristics.tone} onChange={(e) => patchChar({ tone: e.target.value })} dir="auto" />
        </div>
        {(['verbosity', 'creativity', 'assertiveness', 'skepticism', 'cooperation'] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`ag-${key}`}>
              {t(`inspector.char_${key}`, { value: agent.characteristics[key] })}
            </label>
            <input
              id={`ag-${key}`}
              type="range"
              min={0}
              max={100}
              value={agent.characteristics[key]}
              onChange={(e) => patchChar({ [key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </Section>

      <Section title={t('inspector.skillsTitle', { enabled: agent.skills.filter((s) => s.enabled).length, total: agent.skills.length })}>
        <p className={styles.hint}>{t('inspector.skillsHint')}</p>
        {agent.skills.map((skill, idx) => {
          const linked = skill.libraryId ? library.find((s) => s.id === skill.libraryId) : undefined;
          return (
            <div key={skill.id} className={styles.skill}>
              <div className={styles.skillHead}>
                <input
                  type="checkbox"
                  aria-label={t('inspector.skillEnabledAria')}
                  checked={skill.enabled}
                  onChange={(e) => patchSkillAt(idx, { enabled: e.target.checked })}
                />
                <input
                  value={skill.name}
                  aria-label={t('inspector.skillNameAria')}
                  placeholder={t('inspector.skillNamePlaceholder')}
                  onChange={(e) => patchSkillAt(idx, { name: e.target.value })}
                  dir="auto"
                />
                <button type="button" aria-label={t('inspector.moveSkillUp')} disabled={idx === 0} onClick={() => moveSkill(idx, -1)}>↑</button>
                <button type="button" aria-label={t('inspector.moveSkillDown')} disabled={idx === agent.skills.length - 1} onClick={() => moveSkill(idx, 1)}>↓</button>
                <button type="button" aria-label={t('inspector.duplicateSkill')} onClick={() => duplicateSkill(idx)}>⧉</button>
                <button type="button" className="danger" aria-label={t('inspector.removeSkill')} onClick={() => removeSkill(skill.id)}>✕</button>
              </div>
              {linked && (
                <div className={styles.skillLink}>
                  <span className="chip" dir="auto">{t('inspector.fromLibrary', { name: linked.name })}</span>
                  <button type="button" onClick={() => resyncSkill(idx)}>{t('inspector.resyncFromLibrary')}</button>
                </div>
              )}
              <input
                value={skill.description}
                aria-label={t('inspector.skillDescriptionAria')}
                placeholder={t('inspector.skillDescriptionPlaceholder')}
                onChange={(e) => patchSkillAt(idx, { description: e.target.value })}
                dir="auto"
              />
              <textarea
                rows={2}
                aria-label={t('inspector.skillInstructionAria')}
                placeholder={t('inspector.skillInstructionPlaceholder')}
                value={skill.instruction}
                onChange={(e) => patchSkillAt(idx, { instruction: e.target.value })}
                dir="auto"
              />
            </div>
          );
        })}
        <div className={styles.skillActions}>
          <select
            aria-label={t('inspector.addSkillFromLibraryAria')}
            value=""
            onChange={(e) => {
              addFromLibrary(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">{t('inspector.addFromLibraryOption')}</option>
            {library.length > 0 && (
              <optgroup label={t('inspector.libraryOptgroup')}>
                {library.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label={t('inspector.presetsOptgroup')}>
              {SKILL_PRESETS.filter((p) => !library.some((s) => s.name === p.name)).map((p) => (
                <option key={p.name} value={`preset:${p.name}`}>{p.name}</option>
              ))}
            </optgroup>
          </select>
          <button type="button" onClick={addBlankSkill}>{t('inspector.blankSkill')}</button>
        </div>
        <div className={styles.skillActions}>
          <button type="button" onClick={handleExportSkills}>{t('inspector.exportSkills')}</button>
          <button type="button" onClick={() => skillFileInput.current?.click()}>{t('inspector.importSkills')}</button>
          <input
            ref={skillFileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportSkills(file);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section
        title={t('inspector.toolsTitle', { count: agent.tools.filter((tl) => toolAvailable(tl)).length + grantedControlToolIds(agent).length })}
      >
        {CONTROL_TOOL_IDS_BY_KIND[agent.kind].length > 0 && (
          <>
            <p className={styles.hint}>
              {t('inspector.orchestrationHint', { kind: agent.kind })}
            </p>
            {CONTROL_TOOL_IDS_BY_KIND[agent.kind].map((toolId) => (
              <label key={toolId} className={styles.toolRow}>
                <input
                  type="checkbox"
                  aria-label={t('inspector.toolEnabledAria', { name: CONTROL_TOOL_META[toolId].name })}
                  checked={agent.tools.includes(toolId)}
                  onChange={(e) =>
                    patch({
                      tools: e.target.checked
                        ? [...agent.tools, toolId]
                        : agent.tools.filter((tl) => tl !== toolId),
                    })
                  }
                />
                <span>
                  <strong dir="auto">{CONTROL_TOOL_META[toolId].name}</strong>
                  <br />
                  <span className={styles.hint} dir="auto">{CONTROL_TOOL_META[toolId].description}</span>
                </span>
              </label>
            ))}
          </>
        )}
        <p className={styles.hint}>
          {t('inspector.executableToolsHint')}
        </p>
        {Object.values(TOOLS).map((tool) => (
          <label key={tool.id} className={styles.toolRow}>
            <input
              type="checkbox"
              aria-label={t('inspector.toolEnabledAria', { name: tool.name })}
              checked={agent.tools.includes(tool.id)}
              onChange={(e) =>
                patch({
                  tools: e.target.checked
                    ? [...agent.tools, tool.id]
                    : agent.tools.filter((tl) => tl !== tool.id),
                })
              }
            />
            <span>
              <strong dir="auto">{tool.name}</strong>
              {tool.id === 'web_search' && !toolAvailable('web_search') && (
                <span className="chip">{t('inspector.needsApiKey')}</span>
              )}
              <br />
              <span className={styles.hint} dir="auto">{tool.description}</span>
            </span>
          </label>
        ))}
        <div className="field">
          <label htmlFor="ag-tavily-key">{t('inspector.webSearchKeyLabel')}</label>
          <div className={styles.skillHead}>
            <input
              id="ag-tavily-key"
              type="password"
              placeholder={toolAvailable('web_search') ? t('inspector.webSearchKeySavedPlaceholder') : 'tvly-…'}
              value={tavilyKeyDraft}
              onChange={(e) => setTavilyKeyDraft(e.target.value)}
              onBlur={() => {
                // Save only a non-empty draft; blurring an untouched field must
                // never erase a previously saved key.
                if (tavilyKeyDraft.trim()) {
                  setTavilyKey(tavilyKeyDraft);
                  setTavilyKeyDraft('');
                  showToast('info', t('inspector.webSearchKeySaved'));
                }
              }}
            />
            {toolAvailable('web_search') && (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setTavilyKey('');
                  setTavilyKeyDraft('');
                  showToast('info', t('inspector.webSearchKeyCleared'));
                }}
              >
                {t('inspector.clear')}
              </button>
            )}
          </div>
          <p className={styles.hint}>
            {t('inspector.webSearchKeyHint')}
          </p>
        </div>
      </Section>

      <Section title={t('inspector.providerModelTitle')} defaultOpen>
        <div className="field">
          <label htmlFor="ag-provider">{t('inspector.providerLabel')}</label>
          <select
            id="ag-provider"
            value={agent.llm.providerId ?? ''}
            onChange={(e) => patchLlm({ providerId: e.target.value || null })}
          >
            <option value="">{t('inspector.providerNoneOption')}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.enabled ? p.displayName : t('inspector.providerDisabledOption', { name: p.displayName })}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ag-model">{t('inspector.modelLabel')}</label>
          {selectedProvider && selectedProvider.models.length > 0 ? (
            <select id="ag-model" value={agent.llm.model} onChange={(e) => patchLlm({ model: e.target.value })}>
              <option value="">{t('inspector.modelSelectOption')}</option>
              {selectedProvider.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input id="ag-model" value={agent.llm.model} onChange={(e) => patchLlm({ model: e.target.value })} placeholder={t('inspector.modelPlaceholder')} dir="auto" />
          )}
        </div>
      </Section>

      <Section title={t('inspector.generationSettingsTitle')}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ag-temp">{t('inspector.temperatureLabel', { value: agent.llm.temperature })}</label>
            <input id="ag-temp" type="range" min={0} max={2} step={0.1} value={agent.llm.temperature} onChange={(e) => patchLlm({ temperature: Number(e.target.value) })} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ag-maxtok">{t('inspector.maxOutputTokensLabel')}</label>
            <input id="ag-maxtok" type="number" min={1} value={agent.llm.maxOutputTokens} onChange={(e) => { const n = parseBoundedInt(e.target.value, 1); if (n !== null) patchLlm({ maxOutputTokens: n }); }} />
          </div>
          <div className="field">
            <label htmlFor="ag-topp">{t('inspector.topPLabel')}</label>
            <input id="ag-topp" type="number" min={0} max={1} step={0.05} value={agent.llm.topP ?? ''} onChange={(e) => { if (e.target.value === '') { patchLlm({ topP: undefined }); return; } const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= 1) patchLlm({ topP: n }); }} />
          </div>
        </div>
      </Section>

      <Section title={t('inspector.runtimeLimitsTitle')}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ag-maxresp">{t('inspector.maxResponsesLabel')}</label>
            <input id="ag-maxresp" type="number" min={1} value={agent.runtime.maxResponsesPerRun} onChange={(e) => { const n = parseBoundedInt(e.target.value, 1); if (n !== null) patchRuntime({ maxResponsesPerRun: n }); }} />
          </div>
          <div className="field">
            <label htmlFor="ag-hist">{t('inspector.historyWindowLabel')}</label>
            <input id="ag-hist" type="number" min={1} value={agent.runtime.historyWindow} onChange={(e) => { const n = parseBoundedInt(e.target.value, 1); if (n !== null) patchRuntime({ historyWindow: n }); }} />
          </div>
        </div>
        <label className={styles.enableToggle}>
          <input type="checkbox" checked={agent.runtime.includeHistory} onChange={(e) => patchRuntime({ includeHistory: e.target.checked })} />
          {t('inspector.includeHistoryLabel')}
        </label>
      </Section>

      <Section title={t('inspector.connectionsTitle', { count: outgoing.length })}>
        <p className={styles.hint}>{t('inspector.connectionsHint')}</p>
        {outgoing.length === 0 && <p className="muted" style={{ fontSize: 12 }}>{t('inspector.noOutgoingConnections')}</p>}
        {outgoing.map((c) => {
          const target = playground.agents.find((a) => a.id === c.target);
          return (
            <div key={c.id} className={styles.connItem}>
              <button type="button" className={styles.connLink} onClick={() => selectConnection(c.id)}>
                → <span dir="auto">{target?.name ?? t('inspector.deleted')}</span> <span className="chip">{c.type}</span>
              </button>
              <button type="button" className="danger" aria-label={t('inspector.removeConnection')} onClick={() => removeConnection(c.id)}>✕</button>
            </div>
          );
        })}
        {availableTargets.length > 0 && (
          <div className={styles.connAdd}>
            <select aria-label={t('inspector.connectionTargetAria')} value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
              <option value="">{t('inspector.connectToOption')}</option>
              {availableTargets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select aria-label={t('inspector.connectionType')} value={newType} onChange={(e) => setNewType(e.target.value as ConnectionType)}>
              <option value="conversation">{t('inspector.connTypeTalk')}</option>
              <option value="review">{t('inspector.connTypeReview')}</option>
              <option value="handoff">{t('inspector.connTypeHandoff')}</option>
            </select>
            <button type="button" onClick={handleAddConnection} disabled={!newTarget}>{t('common.add')}</button>
          </div>
        )}
      </Section>

      <Section title={t('inspector.effectivePromptTitle')}>
        <p className={styles.hint}>
          {t('inspector.effectivePromptHint', { tokens: estTokens })}
        </p>
        <pre className={styles.preview} dir="auto">{preview}</pre>
      </Section>
    </fieldset>
  );
}
