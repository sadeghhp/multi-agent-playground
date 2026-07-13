import { useMemo } from 'react';
import type { Agent } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { newSkillId } from '../../domain/ids';
import { buildSystemPrompt, buildTaskPrompt } from '../../agents/promptAssembly';
import { validateForRun } from '../../orchestrator/validate';
import { Section } from './Section';
import styles from './Inspector.module.css';

const COLORS: Agent['colorCategory'][] = ['slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal'];

export function AgentInspector({ agent }: { agent: Agent }) {
  const playground = useDomainStore((s) => s.playground)!;
  const update = useDomainStore((s) => s.updateAgent);
  const duplicate = useDomainStore((s) => s.duplicateAgentById);
  const remove = useDomainStore((s) => s.removeAgent);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const isRunning = useRuntimeStore((s) => s.status === 'running');

  const providers = playground.providers;
  const selectedProvider = providers.find((p) => p.id === agent.llm.providerId);

  const agentIssues = useMemo(
    () => validateForRun(playground).filter((i) => i.agentId === agent.id),
    [playground, agent.id],
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

  function handleDuplicate() {
    const copy = duplicate(agent.id);
    if (copy) selectAgent(copy.id);
  }

  function handleDelete() {
    const hasHistory = playground.transcript.some((m) => m.agentId === agent.id);
    const hasConnections = playground.connections.some((c) => c.source === agent.id || c.target === agent.id);
    if (hasHistory || hasConnections) {
      if (!window.confirm(`Delete "${agent.name}"? Its connections will be removed. Transcript history is preserved.`)) {
        return;
      }
    }
    remove(agent.id);
    clearSelection();
  }

  const preview = useMemo(() => {
    const ctx = {
      agent,
      conversation: playground.conversation,
      history: [],
      incoming: null,
      isFirstTurn: true,
    };
    return `${buildSystemPrompt(ctx)}\n\n--- USER TURN ---\n${buildTaskPrompt(ctx)}`;
  }, [agent, playground.conversation]);

  return (
    <div className={styles.body}>
      <div className={styles.actions}>
        <label className={styles.enableToggle}>
          <input
            type="checkbox"
            checked={agent.runtime.enabled}
            onChange={(e) => patchRuntime({ enabled: e.target.checked })}
            disabled={isRunning}
          />
          Enabled
        </label>
        <div className={styles.actionButtons}>
          <button type="button" onClick={handleDuplicate} disabled={isRunning}>Duplicate</button>
          <button type="button" className="danger" onClick={handleDelete} disabled={isRunning}>Delete</button>
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
        {agent.skills.map((skill, idx) => (
          <div key={skill.id} className={styles.skill}>
            <div className={styles.skillHead}>
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={(e) => {
                  const skills = [...agent.skills];
                  skills[idx] = { ...skill, enabled: e.target.checked };
                  patch({ skills });
                }}
              />
              <input
                value={skill.name}
                placeholder="skill name"
                onChange={(e) => {
                  const skills = [...agent.skills];
                  skills[idx] = { ...skill, name: e.target.value };
                  patch({ skills });
                }}
              />
              <button type="button" className="danger" aria-label="Remove skill" onClick={() => patch({ skills: agent.skills.filter((s) => s.id !== skill.id) })}>✕</button>
            </div>
            <textarea
              rows={2}
              placeholder="Optional instruction text"
              value={skill.instruction}
              onChange={(e) => {
                const skills = [...agent.skills];
                skills[idx] = { ...skill, instruction: e.target.value };
                patch({ skills });
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            patch({ skills: [...agent.skills, { id: newSkillId(), name: 'new skill', description: '', instruction: '', enabled: true }] })
          }
        >
          + Add skill
        </button>
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
            <input id="ag-maxtok" type="number" min={1} value={agent.llm.maxOutputTokens} onChange={(e) => patchLlm({ maxOutputTokens: Number(e.target.value) })} />
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
            <input id="ag-maxresp" type="number" min={1} value={agent.runtime.maxResponsesPerRun} onChange={(e) => patchRuntime({ maxResponsesPerRun: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="ag-hist">History window</label>
            <input id="ag-hist" type="number" min={0} value={agent.runtime.historyWindow} onChange={(e) => patchRuntime({ historyWindow: Number(e.target.value) })} />
          </div>
        </div>
        <label className={styles.enableToggle}>
          <input type="checkbox" checked={agent.runtime.includeHistory} onChange={(e) => patchRuntime({ includeHistory: e.target.checked })} />
          Include conversation history
        </label>
      </Section>

      <Section title="Effective prompt (preview)">
        <p className={styles.hint}>Read-only. Shows how this agent's configuration becomes a model instruction.</p>
        <pre className={styles.preview}>{preview}</pre>
      </Section>
    </div>
  );
}
