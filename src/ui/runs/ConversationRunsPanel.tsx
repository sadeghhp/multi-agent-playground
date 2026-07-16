import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationRun } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useRunHistoryStore } from '../../store/runHistoryStore';
import { useUiStore } from '../../store/uiStore';
import { formatDateTime, formatTime } from '../../i18n/format';
import { Modal } from '../Modal';
import { RunTranscriptView } from './RunTranscriptView';
import styles from './ConversationRunsPanel.module.css';

type PanelView = 'list' | 'review' | 'compare';

function messagesAddedThisRun(run: ConversationRun): number {
  return Math.max(0, run.transcript.length - run.messageCountAtStart);
}

export function ConversationRunsPanel() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
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
      showToast('warn', t('runs.selectTwo'));
      return;
    }
    setCompareIds([ids[0]!, ids[1]!]);
    setView('compare');
  }

  async function handleDelete(run: ConversationRun) {
    if (run.status === 'running') {
      showToast('warn', t('runs.cannotDeleteRunning'));
      return;
    }
    const ok = await requestConfirm({
      title: t('runs.deleteTitle'),
      message: t('runs.deleteMessage', { version: run.version }),
      confirmLabel: t('common.delete'),
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
    showToast('info', t('runs.deletedRun', { version: run.version }));
  }

  return (
    <Modal
      title={
        view === 'list'
          ? t('runs.title')
          : view === 'review'
            ? t('runs.reviewTitle', { version: reviewRun?.version ?? '' })
            : t('runs.compareTitle')
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
            {t('runs.backToList')}
          </button>
        </div>
      )}

      {view === 'list' && (
        <>
          {playground && (
            <p className={styles.subtitle}>
              <span dir="auto">{playground.name}</span> · {t('runs.runCount', { count: runs.length })}
            </p>
          )}

          {runs.length === 0 ? (
            <p className="muted">{t('runs.noRuns')}</p>
          ) : (
            <>
              <div className={styles.compareBar}>
                <button
                  type="button"
                  className="secondary"
                  onClick={startCompare}
                  disabled={selectedForCompare.size !== 2}
                >
                  {t('runs.compareSelected', { count: selectedForCompare.size })}
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
                        aria-label={t('runs.selectForCompareAria', { version: run.version })}
                      />
                    </label>
                    <div className={styles.itemBody}>
                      <div className={styles.itemHeader}>
                        <span className={styles.version}>v{run.version}</span>
                        <span className={`${styles.status} ${styles[`status_${run.status}`]}`}>
                          {t(`runs.status.${run.status}`)}
                        </span>
                        <span className={styles.date}>
                          {formatDateTime(run.startedAt, language)}
                        </span>
                      </div>
                      <div className={styles.itemMeta}>
                        <span dir="auto">{run.conversation.subject || t('runs.noSubject')}</span>
                        <span>
                          {t('runs.messagesThisRun', {
                            count: messagesAddedThisRun(run),
                            total: run.transcript.length,
                          })}
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
                        {t('runs.review')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.deleteBtn} danger`}
                        disabled={run.status === 'running'}
                        onClick={() => void handleDelete(run)}
                        aria-label={t('runs.deleteRunAria', { version: run.version })}
                      >
                        {t('common.delete')}
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
              {t(`runs.status.${reviewRun.status}`)}
            </span>
            <span>
              {t('runs.started', { when: formatDateTime(reviewRun.startedAt, language) })}
              {reviewRun.endedAt != null &&
                t('runs.ended', { when: formatDateTime(reviewRun.endedAt, language) })}
            </span>
            {reviewRun.parentRunId && (
              <span className="muted">{t('runs.continuesFromPrevious')}</span>
            )}
          </div>

          {reviewRun.events.length > 0 && (
            <details className={styles.events}>
              <summary>{t('runs.executionPath', { count: reviewRun.events.length })}</summary>
              <ol className={styles.eventList}>
                {reviewRun.events.map((e) => (
                  <li key={e.id}>
                    <span className={styles.eventKind}>{e.kind}</span>
                    <span dir="auto">{e.message}</span>
                    <span className={styles.eventTime}>{formatTime(e.at, language)}</span>
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
                  {t(`runs.status.${run.status}`)}
                </span>
                <span className={styles.date}>{formatDateTime(run.startedAt, language)}</span>
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
