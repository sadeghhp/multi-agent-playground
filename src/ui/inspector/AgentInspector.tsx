import { useMemo, useRef, useState } from 'react';
import type { Agent, ConnectionType, Skill } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { useAgentLibraryStore } from '../../store/agentLibraryStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { newConnectionId, newSkillId } from '../../domain/ids';
import { SKILL_PRESETS } from '../../domain/factories';
import { assembleMessages, boundHistory, buildSystemPrompt, buildTaskPrompt, estimateTokens } from '../../agents/promptAssembly';
import { enhanceSystemInstruction, type EnhancePromptResult } from '../../agents/enhancePrompt';
import { enrichAgentDraft, enrichedDraftToAgentOverrides, type EnrichAgentResult } from '../../agents/enrichAgent';
import type { GeneratedAgentDraft } from '../../agents/generateAgent';
import { exportSkillSet, importSkillSet } from '../../persistence/skillSets';
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
    ? 'Assign a provider to enable AI enhancement.'
    : !selectedProvider.enabled
      ? 'The assigned provider is disabled.'
      : !agent.llm.model.trim()
        ? 'Select a model to enable AI enhancement.'
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
  const [enrichProposal, setEnrichProposal] = useState<GeneratedAgentDraft | null>(null);
  const [enrichError, setEnrichError] = useState<EnrichAgentResult | null>(null);

  async function handleEnrich() {
    if (!selectedProvider || !canEnhance || !enrichInfo.trim()) return;
    setEnriching(true);
    setEnrichProposal(null);
    setEnrichError(null);
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

  function applyEnrichment() {
    if (enrichProposal) patch(enrichedDraftToAgentOverrides(agent, enrichProposal));
    setEnrichProposal(null);
    setEnrichInfo('');
  }

  function formatEnrichPreview(draft: GeneratedAgentDraft): string {
    const lines: string[] = [
      `Name: ${draft.name}`,
      `Role: ${draft.role}`,
    ];
    if (draft.description) lines.push(`Description: ${draft.description}`);
    lines.push('', 'System instruction:', draft.systemInstruction);
    lines.push('', `Skills (${draft.skills.length}):`);
    if (draft.skills.length === 0) lines.push('(none)');
    for (const s of draft.skills) lines.push(`- ${s.name}${s.description ? `: ${s.description}` : ''}`);
    return lines.join('\n');
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
      showToast('warn', 'This agent has no skills to export.');
      return;
    }
    downloadJson(`${agent.name || 'agent'}-skills`, exportSkillSet(agent.skills));
  }
  async function handleImportSkills(file: File) {
    const result = importSkillSet(await file.text());
    if (!result.ok) {
      showToast('error', result.error ?? 'Import failed.');
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
    showToast('info', `Imported ${imported.length} skill${imported.length === 1 ? '' : 's'}.`);
  }

  function handleDuplicate() {
    const copy = duplicate(agent.id);
    if (copy) selectAgent(copy.id);
  }

  async function handleSaveToLibrary() {
    // Snapshot the agent's current config into the cross-playground library.
    await saveToLibrary(agent);
    showToast('info', `Saved "${agent.name}" to the agent library.`);
  }

  async function handleDelete() {
    const hasConnections =
      playground?.connections.some((c) => c.source === agent.id || c.target === agent.id) ?? false;
    const ok = await requestConfirm({
      title: 'Delete agent',
      message: hasConnections
        ? `Delete "${agent.name}"? Its connections will be removed. Transcript history is preserved.`
        : `Delete "${agent.name}"? Transcript history is preserved.`,
      confirmLabel: 'Delete',
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
      {isRunning && <p className={styles.hint}>Editing is locked while a conversation is running.</p>}
      <div className={styles.actions}>
        <label className={styles.enableToggle}>
          <input
            type="checkbox"
            checked={agent.runtime.enabled}
            onChange={(e) => patchRuntime({ enabled: e.target.checked })}
          />
          Enabled
        </label>
        <div className={styles.actionButtons}>
          <button type="button" onClick={() => void handleSaveToLibrary()}>Save to library</button>
          <button type="button" onClick={handleDuplicate}>Duplicate</button>
          <button type="button" className="danger" onClick={handleDelete}>Delete</button>
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

      <Section title="Enrich with AI">
        <p className={styles.hint}>
          Tell the AI something new about this agent — a decision it should follow, a
          capability it turned out to need, a correction — and it will mature the role,
          instruction, characteristics, and skills to match. Review before applying.
        </p>
        <textarea
          rows={3}
          placeholder="e.g. This agent should now double-check any numeric claims against the source before repeating them."
          value={enrichInfo}
          onChange={(e) => setEnrichInfo(e.target.value)}
        />
        <div className={styles.enhanceBar}>
          <button
            type="button"
            onClick={() => void handleEnrich()}
            disabled={!canEnhance || !enrichInfo.trim() || enriching}
            title={enhanceBlockedReason ?? 'Mature this agent using the assigned provider'}
          >
            {enriching ? 'Enriching…' : '🌱 Enrich with AI'}
          </button>
          {enhanceBlockedReason && !enriching && (
            <span className={styles.enhanceStatus}>{enhanceBlockedReason}</span>
          )}
        </div>

        {enrichError && (
          <div className={styles.enhanceErr}>
            <strong>{enrichError.errorKind ?? 'error'}</strong> — {enrichError.errorSummary}
            {enrichError.errorDetail && <div>{enrichError.errorDetail}</div>}
          </div>
        )}

        {enrichProposal && (
          <div className={styles.enhanceResult}>
            <p className={styles.enhanceResultHead}>Suggested update — review before applying</p>
            <pre className={styles.preview}>{formatEnrichPreview(enrichProposal)}</pre>
            <div className={styles.enhanceActions}>
              <button type="button" className="primary" onClick={applyEnrichment}>Apply</button>
              <button type="button" onClick={() => setEnrichProposal(null)}>Discard</button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Identity" defaultOpen>
        <div className="field">
          <label htmlFor="ag-name">Name</label>
          <input id="ag-name" value={agent.name} onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ag-desc">Description</label>
          <input id="ag-desc" value={agent.description} onChange={(e) => patch({ description: e.target.value })} />
        </div>
        <div className="field">
          <label>Color</label>
          <div className={styles.colors}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={agent.colorCategory === c}
                className={`${styles.swatch} ${styles[`sw_${c}`]} ${agent.colorCategory === c ? styles.swActive : ''}`}
                onClick={() => patch({ colorCategory: c })}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Role & instruction" defaultOpen>
        <div className="field">
          <label htmlFor="ag-role">Role</label>
          <input id="ag-role" value={agent.role} onChange={(e) => patch({ role: e.target.value })} placeholder="Skeptical reviewer" />
        </div>
        <div className="field">
          <label htmlFor="ag-sys">System instruction</label>
          <textarea
            id="ag-sys"
            rows={4}
            value={agent.systemInstruction}
            onChange={(e) => patch({ systemInstruction: e.target.value })}
          />
          <div className={styles.enhanceBar}>
            <button
              type="button"
              onClick={handleEnhance}
              disabled={!canEnhance}
              title={enhanceBlockedReason ?? 'Rewrite this instruction using the assigned provider'}
            >
              {enhancing ? 'Enhancing…' : '✨ Enhance with AI'}
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
              <p className={styles.enhanceResultHead}>Suggested instruction — review before applying</p>
              <pre className={styles.preview}>{enhanceProposal}</pre>
              <div className={styles.enhanceActions}>
                <button type="button" className="primary" onClick={applyEnhancement}>Apply</button>
                <button type="button" onClick={() => setEnhanceProposal(null)}>Discard</button>
              </div>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="ag-lang">Language</label>
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

      <Section title="Characteristics">
        <div className="field">
          <label htmlFor="ag-tone">Tone</label>
          <input id="ag-tone" value={agent.characteristics.tone} onChange={(e) => patchChar({ tone: e.target.value })} />
        </div>
        {(['verbosity', 'creativity', 'assertiveness', 'skepticism', 'cooperation'] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`ag-${key}`}>
              {key[0].toUpperCase() + key.slice(1)}: {agent.characteristics[key]}
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

      <Section title={`Skills (${agent.skills.filter((s) => s.enabled).length}/${agent.skills.length})`}>
        <p className={styles.hint}>Declared capabilities merged into the prompt — not executable tools.</p>
        {agent.skills.map((skill, idx) => {
          const linked = skill.libraryId ? library.find((s) => s.id === skill.libraryId) : undefined;
          return (
            <div key={skill.id} className={styles.skill}>
              <div className={styles.skillHead}>
                <input
                  type="checkbox"
                  aria-label="Skill enabled"
                  checked={skill.enabled}
                  onChange={(e) => patchSkillAt(idx, { enabled: e.target.checked })}
                />
                <input
                  value={skill.name}
                  placeholder="skill name"
                  onChange={(e) => patchSkillAt(idx, { name: e.target.value })}
                />
                <button type="button" aria-label="Move skill up" disabled={idx === 0} onClick={() => moveSkill(idx, -1)}>↑</button>
                <button type="button" aria-label="Move skill down" disabled={idx === agent.skills.length - 1} onClick={() => moveSkill(idx, 1)}>↓</button>
                <button type="button" aria-label="Duplicate skill" onClick={() => duplicateSkill(idx)}>⧉</button>
                <button type="button" className="danger" aria-label="Remove skill" onClick={() => removeSkill(skill.id)}>✕</button>
              </div>
              {linked && (
                <div className={styles.skillLink}>
                  <span className="chip">from library: {linked.name}</span>
                  <button type="button" onClick={() => resyncSkill(idx)}>Re-sync from library</button>
                </div>
              )}
              <input
                value={skill.description}
                placeholder="Short description"
                onChange={(e) => patchSkillAt(idx, { description: e.target.value })}
              />
              <textarea
                rows={2}
                placeholder="Optional instruction text"
                value={skill.instruction}
                onChange={(e) => patchSkillAt(idx, { instruction: e.target.value })}
              />
            </div>
          );
        })}
        <div className={styles.skillActions}>
          <select
            aria-label="Add skill from library"
            value=""
            onChange={(e) => {
              addFromLibrary(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">+ Add from library…</option>
            {library.length > 0 && (
              <optgroup label="Library">
                {library.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Presets">
              {SKILL_PRESETS.filter((p) => !library.some((s) => s.name === p.name)).map((p) => (
                <option key={p.name} value={`preset:${p.name}`}>{p.name}</option>
              ))}
            </optgroup>
          </select>
          <button type="button" onClick={addBlankSkill}>+ Blank skill</button>
        </div>
        <div className={styles.skillActions}>
          <button type="button" onClick={handleExportSkills}>Export skills</button>
          <button type="button" onClick={() => skillFileInput.current?.click()}>Import skills</button>
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

      <Section title="Provider & model" defaultOpen>
        <div className="field">
          <label htmlFor="ag-provider">Provider</label>
          <select
            id="ag-provider"
            value={agent.llm.providerId ?? ''}
            onChange={(e) => patchLlm({ providerId: e.target.value || null })}
          >
            <option value="">— none —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}{!p.enabled ? ' (disabled)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ag-model">Model</label>
          {selectedProvider && selectedProvider.models.length > 0 ? (
            <select id="ag-model" value={agent.llm.model} onChange={(e) => patchLlm({ model: e.target.value })}>
              <option value="">— select —</option>
              {selectedProvider.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input id="ag-model" value={agent.llm.model} onChange={(e) => patchLlm({ model: e.target.value })} placeholder="model id" />
          )}
        </div>
      </Section>

      <Section title="Generation settings">
        <div className="field-row">
          <div className="field">
            <label htmlFor="ag-temp">Temperature: {agent.llm.temperature}</label>
            <input id="ag-temp" type="range" min={0} max={2} step={0.1} value={agent.llm.temperature} onChange={(e) => patchLlm({ temperature: Number(e.target.value) })} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ag-maxtok">Max output tokens</label>
            <input id="ag-maxtok" type="number" min={1} value={agent.llm.maxOutputTokens} onChange={(e) => { const n = parseBoundedInt(e.target.value, 1); if (n !== null) patchLlm({ maxOutputTokens: n }); }} />
          </div>
          <div className="field">
            <label htmlFor="ag-topp">Top-p (optional)</label>
            <input id="ag-topp" type="number" min={0} max={1} step={0.05} value={agent.llm.topP ?? ''} onChange={(e) => patchLlm({ topP: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
        </div>
      </Section>

      <Section title="Runtime limits">
        <div className="field-row">
          <div className="field">
            <label htmlFor="ag-maxresp">Max responses / run</label>
            <input id="ag-maxresp" type="number" min={1} value={agent.runtime.maxResponsesPerRun} onChange={(e) => { const n = parseBoundedInt(e.target.value, 1); if (n !== null) patchRuntime({ maxResponsesPerRun: n }); }} />
          </div>
          <div className="field">
            <label htmlFor="ag-hist">History window</label>
            <input id="ag-hist" type="number" min={1} value={agent.runtime.historyWindow} onChange={(e) => { const n = parseBoundedInt(e.target.value, 1); if (n !== null) patchRuntime({ historyWindow: n }); }} />
          </div>
        </div>
        <label className={styles.enableToggle}>
          <input type="checkbox" checked={agent.runtime.includeHistory} onChange={(e) => patchRuntime({ includeHistory: e.target.checked })} />
          Include conversation history
        </label>
      </Section>

      <Section title={`Connections (${outgoing.length} outgoing)`}>
        <p className={styles.hint}>Directed edges from this agent. A button alternative to dragging between nodes.</p>
        {outgoing.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No outgoing connections.</p>}
        {outgoing.map((c) => {
          const target = playground.agents.find((a) => a.id === c.target);
          return (
            <div key={c.id} className={styles.connItem}>
              <button type="button" className={styles.connLink} onClick={() => selectConnection(c.id)}>
                → {target?.name ?? 'deleted'} <span className="chip">{c.type}</span>
              </button>
              <button type="button" className="danger" aria-label="Remove connection" onClick={() => removeConnection(c.id)}>✕</button>
            </div>
          );
        })}
        {availableTargets.length > 0 && (
          <div className={styles.connAdd}>
            <select aria-label="Connection target" value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
              <option value="">Connect to…</option>
              {availableTargets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select aria-label="Connection type" value={newType} onChange={(e) => setNewType(e.target.value as ConnectionType)}>
              <option value="conversation">talk</option>
              <option value="review">review</option>
              <option value="handoff">handoff</option>
            </select>
            <button type="button" onClick={handleAddConnection} disabled={!newTarget}>Add</button>
          </div>
        )}
      </Section>

      <Section title="Effective prompt (preview)">
        <p className={styles.hint}>
          Read-only. Shows how this agent's configuration becomes a model instruction.
          {' '}Estimated context: ~{estTokens} tokens (character-based estimate).
        </p>
        <pre className={styles.preview}>{preview}</pre>
      </Section>
    </fieldset>
  );
}
