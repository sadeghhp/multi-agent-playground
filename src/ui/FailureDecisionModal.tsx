import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const decision = useUiStore((s) => s.failureDecision);
  const resolve = useUiStore((s) => s.resolveFailureDecision);

  if (!decision) return null;

  return (
    <Modal
      title={t('failure.title')}
      onClose={() => resolve('stop')}
      width={520}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => resolve('stop')}>
            {t('failure.stopRun')}
          </button>
          <button type="button" className="secondary" onClick={() => resolve('skip')}>
            {t('failure.skipTurn')}
          </button>
          <button
            type="button"
            className={decision.suggestDisable ? 'primary' : 'secondary'}
            onClick={() => resolve('disable')}
          >
            {t('failure.removeFromCircuit')}
          </button>
          <button
            type="button"
            className={decision.suggestDisable ? 'secondary' : 'primary'}
            onClick={() => resolve('retry')}
          >
            {t('failure.retryTurn')}
          </button>
        </>
      }
    >
      <p dir="auto">
        {decision.consecutiveFailures > 1
          ? t('failure.failedTimes', {
              agent: decision.agentName,
              n: decision.consecutiveFailures,
            })
          : t('failure.failed', { agent: decision.agentName })}
      </p>
      <p className="muted" style={{ marginTop: 8 }} dir="auto">
        {decision.errorSummary}
      </p>
      {decision.suggestDisable && (
        <p style={{ marginTop: 14 }}>
          {t('failure.suggestDisable')}
        </p>
      )}
      <ul className="muted" style={{ marginTop: 14, fontSize: 13, paddingInlineStart: 18 }}>
        <li>
          <strong>{t('failure.retryTurn')}</strong> — {t('failure.retryTurnDesc')}
        </li>
        <li>
          <strong>{t('failure.skipTurn')}</strong> — {t('failure.skipTurnDesc')}
        </li>
        <li>
          <strong>{t('failure.removeFromCircuit')}</strong> — {t('failure.removeFromCircuitDesc')}
        </li>
        <li>
          <strong>{t('failure.stopRun')}</strong> — {t('failure.stopRunDesc')}
        </li>
      </ul>
    </Modal>
  );
}
