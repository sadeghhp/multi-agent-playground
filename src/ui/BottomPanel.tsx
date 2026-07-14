import { useEffect, useMemo, useRef, useState } from 'react';
import { useDomainStore } from '../store/domainStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { Message } from './transcript/Message';
import { LiveMessage } from './transcript/LiveMessage';
import styles from './BottomPanel.module.css';

type Tab = 'transcript' | 'log' | 'errors';

const TABS: Tab[] = ['transcript', 'log', 'errors'];
const tabId = (t: Tab) => `bottom-panel-tab-${t}`;
const panelId = (t: Tab) => `bottom-panel-panel-${t}`;

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
  const activeAgentId = useRuntimeStore((s) => s.activeAgentId);
  const liveText = useRuntimeStore((s) => (s.activeAgentId ? s.streamingText[s.activeAgentId] : undefined));

  const [tab, setTab] = useState<Tab>('transcript');
  const transcript = playground?.transcript ?? [];

  // The agent currently streaming an in-flight response (Prototype B), if any.
  const liveAgent =
    status === 'running' && activeAgentId && liveText
      ? playground?.agents.find((a) => a.id === activeAgentId) ?? null
      : null;

  // Aggregate run stats (spec §6 "token and latency estimates when available").
  const stats = useMemo(() => {
    let tokens = 0;
    let duration = 0;
    let hasTokens = false;
    for (const m of transcript) {
      if (m.totalTokens != null) { tokens += m.totalTokens; hasTokens = true; }
      if (m.durationMs != null) duration += m.durationMs;
    }
    return { tokens, duration, hasTokens };
  }, [transcript]);

  // Auto-scroll the transcript to the newest message as it arrives, but only
  // while the user is already at (or near) the bottom — otherwise someone
  // scrolling up to reread earlier messages mid-stream gets yanked back down
  // on every token.
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const SCROLL_BOTTOM_THRESHOLD_PX = 48;

  function handleScroll() {
    const el = contentRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX;
  }

  useEffect(() => {
    if (tab === 'transcript' && !collapsed && contentRef.current && stickToBottomRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [transcript.length, tab, collapsed, liveText]);

  return (
    <section className={styles.panel} data-collapsed={collapsed || undefined} aria-label="Execution panel">
      <header className={styles.header}>
        <div
          className={styles.tabs}
          role="tablist"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const i = TABS.indexOf(tab);
            const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
            setTab(next);
            document.getElementById(tabId(next))?.focus();
          }}
        >
          <button
            id={tabId('transcript')}
            role="tab"
            aria-selected={tab === 'transcript'}
            aria-controls={panelId('transcript')}
            tabIndex={tab === 'transcript' ? 0 : -1}
            className={tab === 'transcript' ? styles.tabActive : ''}
            onClick={() => setTab('transcript')}
          >
            Transcript ({transcript.length})
          </button>
          <button
            id={tabId('log')}
            role="tab"
            aria-selected={tab === 'log'}
            aria-controls={panelId('log')}
            tabIndex={tab === 'log' ? 0 : -1}
            className={tab === 'log' ? styles.tabActive : ''}
            onClick={() => setTab('log')}
          >
            Event log ({events.length})
          </button>
          <button
            id={tabId('errors')}
            role="tab"
            aria-selected={tab === 'errors'}
            aria-controls={panelId('errors')}
            tabIndex={tab === 'errors' ? 0 : -1}
            className={tab === 'errors' ? styles.tabActive : ''}
            onClick={() => setTab('errors')}
          >
            Errors ({errors.length})
          </button>
        </div>
        <div className={styles.headerRight}>
          {transcript.length > 0 && (
            <span className={styles.stats}>
              {stats.duration > 0 && `${(stats.duration / 1000).toFixed(1)}s`}
              {stats.hasTokens && ` · ~${stats.tokens} tok`}
            </span>
          )}
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
        <div
          className={styles.content}
          ref={contentRef}
          onScroll={handleScroll}
          data-testid="bottom-panel-content"
          role="tabpanel"
          id={panelId(tab)}
          aria-labelledby={tabId(tab)}
        >
          {tab === 'transcript' && (
            transcript.length === 0 && !liveAgent ? (
              <p className={styles.empty}>No conversation yet. Configure agents, connect them, and press Run.</p>
            ) : (
              <>
                {transcript.map((msg) => <Message key={msg.id} msg={msg} />)}
                {liveAgent && liveText && (
                  <LiveMessage agentName={liveAgent.name} role={liveAgent.role} text={liveText} />
                )}
              </>
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
              errors.map((err) => (
                <div key={err.id} className={styles.errorItem}>
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
