import { useState } from 'react';
import type { ConversationRun } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useRunHistoryStore } from '../../store/runHistoryStore';
import { useUiStore } from '../../store/uiStore';
import { Modal } from '../Modal';
import { RunTranscriptView } from './RunTranscriptView';
import styles from './ConversationRunsPanel.module.css';

type PanelView = 'list' | 'review' | 'compare';

const STATUS_LABEL: Record<ConversationRun['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  stopped: 'Stopped',
  error: 'Error',
  interrupted: 'Interrupted',
};

function messagesAddedThisRun(run: ConversationRun): number {
  return Math.max(0, run.transcript.length - run.messageCountAtStart);
}

export function ConversationRunsPanel() {
  const playground = useDomainStore((s) => s.playground);
  const runs = useRunHistoryStore((s) => s.runs);
  const removeRun = useRunHistoryStore((s) => s.removeRun);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);
  const showToast = useUiStore((s) => s.showToast);

  const [view, setView] = useState<PanelView>('list');
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);
  const [selectedForCompare, setSelectedForCompare] = useState<Set<string>>(new Set());

  const close = () => setPanel('none');

  const reviewRun = runs.find((r) => r.id === reviewRunId) ?? null;
  const compareRuns = compareIds
    .map((id) => runs.find((r) => r.id === id))
    .filter((r): r is ConversationRun => !!r);

  function toggleCompareSelect(id: string) {
    setSelectedForCompare((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      } else {
        // Replace the oldest selection when a third is picked.
        const [first] = next;
        next.delete(first);
        next.add(id);
      }
      return next;
    });
  }

  function startCompare() {
    const ids = [...selectedForCompare];
    if (ids.length !== 2) {
      showToast('warn', 'Select exactly two runs to compare.');
      return;
    }
    setCompareIds([ids[0]!, ids[1]!]);
    setView('compare');
  }

  async function handleDelete(run: ConversationRun) {
    if (run.status === 'running') {
      showToast('warn', 'Cannot delete a run that is still in progress.');
      return;
    }
    const ok = await requestConfirm({
      title: 'Delete run',
      message: `Delete version ${run.version}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await removeRun(run.id);
    setSelectedForCompare((prev) => {
      const next = new Set(prev);
      next.delete(run.id);
      return next;
    });
    if (reviewRunId === run.id) {
      setReviewRunId(null);
      setView('list');
    }
    showToast('info', `Deleted run v${run.version}.`);
  }

  return (
    <Modal
      title={
        view === 'list'
          ? 'Conversation runs'
          : view === 'review'
            ? `Run v${reviewRun?.version ?? ''}`
            : 'Compare runs'
      }
      onClose={close}
      width={view === 'compare' ? 920 : 640}
    >
      {view !== 'list' && (
        <div className={styles.backRow}>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setView('list');
              setReviewRunId(null);
            }}
          >
            ← Back to list
          </button>
        </div>
      )}

      {view === 'list' && (
        <>
          {playground && (
            <p className={styles.subtitle}>
              {playground.name} · {runs.length} run{runs.length === 1 ? '' : 's'}
            </p>
          )}

          {runs.length === 0 ? (
            <p className="muted">No conversation runs yet. Start a run to create version 1.</p>
          ) : (
            <>
              <div className={styles.compareBar}>
                <button
                  type="button"
                  className="secondary"
                  onClick={startCompare}
                  disabled={selectedForCompare.size !== 2}
                >
                  Compare selected ({selectedForCompare.size}/2)
                </button>
              </div>
              <ul className={styles.list}>
                {[...runs].reverse().map((run) => (
                  <li key={run.id} className={styles.item}>
                    <label className={styles.compareCheck}>
                      <input
                        type="checkbox"
                        checked={selectedForCompare.has(run.id)}
                        onChange={() => toggleCompareSelect(run.id)}
                        aria-label={`Select run v${run.version} for compare`}
                      />
                    </label>
                    <div className={styles.itemBody}>
                      <div className={styles.itemHeader}>
                        <span className={styles.version}>v{run.version}</span>
                        <span className={`${styles.status} ${styles[`status_${run.status}`]}`}>
                          {STATUS_LABEL[run.status]}
                        </span>
                        <span className={styles.date}>
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className={styles.itemMeta}>
                        <span>{run.conversation.subject || '(no subject)'}</span>
                        <span>
                          {messagesAddedThisRun(run)} message{messagesAddedThisRun(run) === 1 ? '' : 's'} this run
                          · {run.transcript.length} total
                        </span>
                      </div>
                    </div>
                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setReviewRunId(run.id);
                          setView('review');
                        }}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        className={`${styles.deleteBtn} danger`}
                        disabled={run.status === 'running'}
                        onClick={() => void handleDelete(run)}
                        aria-label={`Delete run v${run.version}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {view === 'review' && reviewRun && (
        <div className={styles.review}>
          <div className={styles.runMeta}>
            <span className={`${styles.status} ${styles[`status_${reviewRun.status}`]}`}>
              {STATUS_LABEL[reviewRun.status]}
            </span>
            <span>
              Started {new Date(reviewRun.startedAt).toLocaleString()}
              {reviewRun.endedAt != null && ` · Ended ${new Date(reviewRun.endedAt).toLocaleString()}`}
            </span>
            {reviewRun.parentRunId && (
              <span className="muted">Continues from previous run</span>
            )}
          </div>

          {reviewRun.events.length > 0 && (
            <details className={styles.events}>
              <summary>Execution path ({reviewRun.events.length} events)</summary>
              <ol className={styles.eventList}>
                {reviewRun.events.map((e) => (
                  <li key={e.id}>
                    <span className={styles.eventKind}>{e.kind}</span>
                    <span>{e.message}</span>
                    <span className={styles.eventTime}>{new Date(e.at).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          <div className={styles.transcriptScroll}>
            <RunTranscriptView run={reviewRun} />
          </div>
        </div>
      )}

      {view === 'compare' && compareRuns.length === 2 && (
        <div className={styles.compareGrid}>
          {compareRuns.map((run) => (
            <section key={run.id} className={styles.compareCol}>
              <header className={styles.compareHeader}>
                <strong>v{run.version}</strong>
                <span className={`${styles.status} ${styles[`status_${run.status}`]}`}>
                  {STATUS_LABEL[run.status]}
                </span>
                <span className={styles.date}>{new Date(run.startedAt).toLocaleString()}</span>
              </header>
              <div className={styles.transcriptScroll}>
                <RunTranscriptView run={run} compact />
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
