import { useEffect, useMemo, useRef } from 'react';
import type { TranscriptMessage } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useUiStore } from '../../store/uiStore';
import { agentColor } from '../../graph/colors';
import { MessageMarkdown } from '../transcript/MessageMarkdown';
import styles from './Timeline.module.css';

/** Consecutive messages sharing a turn number, in chronological order. */
interface TurnGroup {
  turn: number;
  messages: TranscriptMessage[];
}

/**
 * Group the (already chronological) transcript into contiguous runs by turn
 * number. A new turn value starts a new group; the same turn repeated later
 * (which shouldn't normally happen) starts a fresh group rather than merging.
 */
function groupByTurn(transcript: TranscriptMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const msg of transcript) {
    const last = groups[groups.length - 1];
    if (last && last.turn === msg.turn) {
      last.messages.push(msg);
    } else {
      groups.push({ turn: msg.turn, messages: [msg] });
    }
  }
  return groups;
}

/**
 * Full-screen, read-only conversation timeline (spec §13). Renders the entire
 * transcript as a vertical spine grouped by turn. Opened from the toolbar via
 * `openPanel === 'timeline'`; the live BottomPanel transcript is untouched.
 */
export function TimelinePage() {
  const playground = useDomainStore((s) => s.playground);
  const setPanel = useUiStore((s) => s.setPanel);
  const close = () => setPanel('none');

  const transcript = playground?.transcript ?? [];
  const groups = useMemo(() => groupByTurn(transcript), [transcript]);

  // Look up a message's live agent color; deleted/unknown agents fall back to slate.
  const colorFor = useMemo(() => {
    const byId = new Map((playground?.agents ?? []).map((a) => [a.id, a.colorCategory]));
    return (msg: TranscriptMessage) => agentColor(msg.agentId ? byId.get(msg.agentId) : null);
  }, [playground?.agents]);

  // Aggregate stats (mirrors BottomPanel): total tokens + duration across messages.
  const stats = useMemo(() => {
    let tokens = 0;
    let duration = 0;
    let hasTokens = false;
    for (const m of transcript) {
      if (m.totalTokens != null) { tokens += m.totalTokens; hasTokens = true; }
      if (m.durationMs != null) duration += m.durationMs;
    }
    return { tokens, duration, hasTokens, turns: groups.length, messages: transcript.length };
  }, [transcript, groups.length]);

  // Escape closes; restore focus to whatever was focused before opening (spec §22).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Conversation timeline"
      onMouseDown={(e) => {
        // Backdrop click (only when the press starts on the overlay itself) closes.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.panel} ref={panelRef} tabIndex={-1}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Conversation Timeline</h1>
            {playground && <span className={styles.subtitle}>{playground.name}</span>}
          </div>
          <div className={styles.headerRight}>
            {transcript.length > 0 && (
              <span className={styles.stats}>
                {stats.turns} turn{stats.turns === 1 ? '' : 's'} · {stats.messages} message
                {stats.messages === 1 ? '' : 's'}
                {stats.duration > 0 && ` · ${(stats.duration / 1000).toFixed(1)}s`}
                {stats.hasTokens && ` · ~${stats.tokens} tok`}
              </span>
            )}
            <button type="button" onClick={close} aria-label="Close timeline">
              Close
            </button>
          </div>
        </header>

        <div className={styles.content}>
          {transcript.length === 0 ? (
            <p className={styles.empty}>
              No conversation yet. Configure agents, connect them, and press Run.
            </p>
          ) : (
            <ol className={styles.timeline}>
              {groups.map((group, gi) => (
                <li key={gi} className={styles.turnGroup}>
                  <div className={styles.turnDivider} aria-label={`Turn ${group.turn}`}>
                    <span className={styles.turnLabel}>Turn {group.turn}</span>
                  </div>
                  {group.messages.map((msg) => (
                    <TimelineItem key={msg.id} msg={msg} color={colorFor(msg)} />
                  ))}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ msg, color }: { msg: TranscriptMessage; color: string }) {
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const failed = msg.status === 'failed';

  return (
    <div className={`${styles.item} ${failed ? styles.itemFailed : ''}`}>
      <span className={styles.node} style={{ backgroundColor: color }} aria-hidden="true" />
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.agent}>
            {msg.agentName}
            {msg.agentDeleted && <span className="chip"> deleted</span>}
          </span>
          {msg.role && <span className="chip">{msg.role}</span>}
          {msg.status === 'stopped' && <span className="chip">stopped</span>}
          <span className={styles.meta}>
            {msg.model || '—'} · {time}
            {msg.durationMs != null && ` · ${msg.durationMs}ms`}
            {msg.totalTokens != null && ` · ${msg.totalTokens} tok`}
          </span>
        </div>
        {msg.sourceAgentId && msg.connectionType && (
          <div className={styles.source}>via {msg.connectionType} connection</div>
        )}
        <div className={styles.body}>
          {failed ? (
            <span className={styles.errText}>Failed: {msg.error}</span>
          ) : (
            <MessageMarkdown content={msg.content} />
          )}
        </div>
      </div>
    </div>
  );
}
