import { useMemo } from 'react';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import { validateForRun, hasBlockingErrors, reachableFrom } from '../orchestrator/validate';
import { startRun } from '../orchestrator/orchestrator';
import { parseBoundedInt } from './inputUtils';
import styles from './RunDialog.module.css';

export function RunDialog() {
  const playground = useDomainStore((s) => s.playground);
  const updateConversation = useDomainStore((s) => s.updateConversation);
  const providers = useProviderStore((s) => s.providers);
  const setPanel = useUiStore((s) => s.setPanel);

  const conversation = playground?.conversation;
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

  function handleRun() {
    if (blocking) return;
    setPanel('none');
    void startRun();
  }

  return (
    <Modal
      title="Run conversation"
      onClose={() => setPanel('none')}
      width={620}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => setPanel('none')}>Cancel</button>
          <button
            type="button"
            className="primary"
            onClick={handleRun}
            disabled={blocking}
            title={blocking ? 'Resolve the errors listed above before starting' : undefined}
          >
            Start conversation
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="run-subject">Subject (required)</label>
        <textarea
          id="run-subject"
          aria-required="true"
          value={conversation.subject}
          onChange={(e) => updateConversation({ subject: e.target.value })}
          placeholder="Evaluate whether the company should open-source its internal agent framework."
        />
      </div>

      <div className="field">
        <label htmlFor="run-objective">Objective</label>
        <input
          id="run-objective"
          value={conversation.objective}
          onChange={(e) => updateConversation({ objective: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="run-context">Initial context (optional)</label>
        <textarea
          id="run-context"
          value={conversation.initialContext}
          onChange={(e) => updateConversation({ initialContext: e.target.value })}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="run-tone">Tone for this run (optional)</label>
          <input
            id="run-tone"
            value={conversation.toneOverride}
            onChange={(e) => updateConversation({ toneOverride: e.target.value })}
            placeholder="e.g. energetic, formal, playful — leave blank to use each agent's own tone"
          />
        </div>
        <div className="field">
          <label htmlFor="run-length">Response length</label>
          <select
            id="run-length"
            value={conversation.responseLength}
            onChange={(e) => updateConversation({ responseLength: e.target.value as typeof conversation.responseLength })}
          >
            <option value="agent-default">Agent default</option>
            <option value="short">Short</option>
            <option value="medium">Medium</option>
            <option value="long">Long</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="run-chitchat">Chit-chat &amp; flattery</label>
          <select
            id="run-chitchat"
            value={conversation.chitchatPolicy}
            onChange={(e) => updateConversation({ chitchatPolicy: e.target.value as typeof conversation.chitchatPolicy })}
          >
            <option value="agent-default">Allow — use each agent's own style</option>
            <option value="concise-factual">Disallow — concise, strict, and factual only</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="run-start">Starting agent</label>
          <select
            id="run-start"
            value={conversation.startingAgentId ?? ''}
            onChange={(e) => updateConversation({ startingAgentId: e.target.value || null })}
          >
            <option value="">— select —</option>
            {enabledAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {suggestedStarts.has(a.id) ? ' (no incoming — suggested)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="run-maxturns">Max total turns</label>
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
          <label htmlFor="run-maxper">Max responses / agent</label>
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

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={conversation.stopOnError}
          onChange={(e) => updateConversation({ stopOnError: e.target.checked })}
        />
        Stop the run if an agent fails
      </label>

      {conversation.startingAgentId && (
        <p className="muted" style={{ fontSize: 12 }}>
          {routeCount} agent(s) reachable from the starting agent.
        </p>
      )}

      {issues.length > 0 && (
        <div className={styles.issues} role="group" aria-label="Configuration issues">
          {blocking && <p className={styles.issuesHead}>Resolve these before starting:</p>}
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
