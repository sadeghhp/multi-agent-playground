import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';

/**
 * Failure-decision prompt shown while a run is paused after an agent failed
 * (failure policy `onFailure: 'prompt'`). Lets the user steer the flow instead
 * of the binary stop/skip: retry the turn, skip it, remove the agent from the
 * circuit for the rest of the run, or stop the run. When the auto-disable
 * threshold has been reached the "remove" action is highlighted as the
 * recommended next step (the headline "kept-failing agent" case).
 *
 * Closing the modal (Esc / backdrop) resolves to 'stop' — the safe default —
 * matching an abort landing on the pending prompt (see uiStore).
 */
export function FailureDecisionModal() {
  const decision = useUiStore((s) => s.failureDecision);
  const resolve = useUiStore((s) => s.resolveFailureDecision);

  if (!decision) return null;

  return (
    <Modal
      title="An agent failed — what next?"
      onClose={() => resolve('stop')}
      width={520}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => resolve('stop')}>
            Stop run
          </button>
          <button type="button" className="secondary" onClick={() => resolve('skip')}>
            Skip this turn
          </button>
          <button
            type="button"
            className={decision.suggestDisable ? 'primary' : 'secondary'}
            onClick={() => resolve('disable')}
          >
            Remove from circuit
          </button>
          <button
            type="button"
            className={decision.suggestDisable ? 'secondary' : 'primary'}
            onClick={() => resolve('retry')}
          >
            Retry turn
          </button>
        </>
      }
    >
      <p>
        <strong>{decision.agentName}</strong> failed
        {decision.consecutiveFailures > 1
          ? ` ${decision.consecutiveFailures} times in a row`
          : ''}
        .
      </p>
      <p className="muted" style={{ marginTop: 8 }}>
        {decision.errorSummary}
      </p>
      {decision.suggestDisable && (
        <p style={{ marginTop: 14 }}>
          This agent keeps failing. <strong>Remove it from the circuit</strong> to keep the rest of
          the run going without it — your saved agent settings stay unchanged.
        </p>
      )}
      <ul className="muted" style={{ marginTop: 14, fontSize: 13, paddingLeft: 18 }}>
        <li>
          <strong>Retry turn</strong> — attempt this agent's turn again now.
        </li>
        <li>
          <strong>Skip this turn</strong> — drop this turn and continue the run.
        </li>
        <li>
          <strong>Remove from circuit</strong> — take this agent out for the rest of the run.
        </li>
        <li>
          <strong>Stop run</strong> — end the run here.
        </li>
      </ul>
    </Modal>
  );
}
