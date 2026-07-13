import { useState } from 'react';
import { useDomainStore } from '../store/domainStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { Message } from './transcript/Message';
import styles from './BottomPanel.module.css';

type Tab = 'transcript' | 'log' | 'errors';

const RUN_STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running…',
  stopped: 'Stopped',
  completed: 'Completed',
  error: 'Error',
  interrupted: 'Interrupted',
};

export function BottomPanel() {
  const playground = useDomainStore((s) => s.playground);
  const clearTranscript = useDomainStore((s) => s.clearTranscript);
  const collapsed = playground?.ui.bottomPanelCollapsed ?? false;
  const updateUiLayout = useDomainStore((s) => s.updateUiLayout);

  const status = useRuntimeStore((s) => s.status);
  const currentTurn = useRuntimeStore((s) => s.currentTurn);
  const events = useRuntimeStore((s) => s.events);
  const errors = useRuntimeStore((s) => s.errors);

  const [tab, setTab] = useState<Tab>('transcript');
  const transcript = playground?.transcript ?? [];

  return (
    <section className={styles.panel} data-collapsed={collapsed || undefined} aria-label="Execution panel">
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? styles.tabActive : ''} onClick={() => setTab('transcript')}>
            Transcript ({transcript.length})
          </button>
          <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? styles.tabActive : ''} onClick={() => setTab('log')}>
            Event log ({events.length})
          </button>
          <button role="tab" aria-selected={tab === 'errors'} className={tab === 'errors' ? styles.tabActive : ''} onClick={() => setTab('errors')}>
            Errors ({errors.length})
          </button>
        </div>
        <div className={styles.headerRight}>
          <span className={`${styles.status} ${styles[`status_${status}`] ?? ''}`}>
            {RUN_STATUS_LABEL[status]}{status === 'running' ? ` · turn ${currentTurn}` : ''}
          </span>
          {tab === 'transcript' && transcript.length > 0 && (
            <button type="button" onClick={() => clearTranscript()} disabled={status === 'running'}>Clear</button>
          )}
          <button
            type="button"
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={() => updateUiLayout({ bottomPanelCollapsed: !collapsed })}
          >
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className={styles.content}>
          {tab === 'transcript' && (
            transcript.length === 0 ? (
              <p className={styles.empty}>No conversation yet. Configure agents, connect them, and press Run.</p>
            ) : (
              transcript.map((msg) => <Message key={msg.id} msg={msg} />)
            )
          )}

          {tab === 'log' && (
            events.length === 0 ? (
              <p className={styles.empty}>No events yet.</p>
            ) : (
              <ul className={styles.log}>
                {events.map((e) => (
                  <li key={e.id}>
                    <span className={styles.logTime}>{new Date(e.at).toLocaleTimeString()}</span>
                    <span className="chip">{e.kind}</span>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === 'errors' && (
            errors.length === 0 ? (
              <p className={styles.empty}>No errors.</p>
            ) : (
              errors.map((err, i) => (
                <div key={i} className={styles.errorItem}>
                  <strong>[{err.level}] {err.summary}</strong>
                  {err.provider && <span className="muted"> · {err.provider}</span>}
                  {err.retryEligible && <span className="chip"> retry-eligible</span>}
                  {err.detail && <div className={styles.errorDetail}>{err.detail}</div>}
                </div>
              ))
            )
          )}
        </div>
      )}
    </section>
  );
}
