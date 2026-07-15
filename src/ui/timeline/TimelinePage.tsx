import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Agent, TranscriptMessage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import { useDomainStore } from '../../store/domainStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useUiStore } from '../../store/uiStore';
import { agentColor } from '../../graph/colors';
import { MessageMarkdown } from '../transcript/MessageMarkdown';
import { formatDuration } from '../formatDuration';
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

  const status = useRuntimeStore((s) => s.status);
  const activeAgentId = useRuntimeStore((s) => s.activeAgentId);
  const currentTurn = useRuntimeStore((s) => s.currentTurn);
  const liveText = useRuntimeStore((s) => (s.activeAgentId ? s.streamingText[s.activeAgentId] : undefined));
  const liveReasoning = useRuntimeStore((s) =>
    s.activeAgentId ? s.streamingReasoning[s.activeAgentId] : undefined,
  );

  const transcript = playground?.transcript ?? [];
  const groups = useMemo(() => groupByTurn(transcript), [transcript]);

  const liveAgent =
    status === 'running' && activeAgentId
      ? playground?.agents.find((a) => a.id === activeAgentId) ?? null
      : null;

  const lastGroupTurn = groups[groups.length - 1]?.turn;
  const liveInLastGroup = !!liveAgent && lastGroupTurn === currentTurn;
  const needsNewLiveGroup = !!liveAgent && !liveInLastGroup;

  // Look up a message's live agent color; deleted/unknown agents fall back to slate.
  const colorFor = useMemo(() => {
    const byId = new Map((playground?.agents ?? []).map((a) => [a.id, a.colorCategory]));
    return (msg: TranscriptMessage) => agentColor(msg.agentId ? byId.get(msg.agentId) : null);
  }, [playground?.agents]);

  const liveColor = liveAgent ? agentColor(liveAgent.colorCategory) : '';

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

  // Auto-scroll to the newest content when the reader is already near the bottom.
  const contentRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    const el = contentRef.current;
    if (!el) return;
    if (behavior === 'smooth' && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  function handleScroll() {
    const el = contentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distanceFromBottom < 40);
  }

  useEffect(() => {
    if (atBottom) scrollToBottom();
  }, [transcript.length, liveText, liveReasoning, atBottom]);

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

  const showJumpToLatest = !atBottom && (transcript.length > 0 || !!liveAgent);
  const hasContent = transcript.length > 0 || !!liveAgent;

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

        <div
          className={styles.content}
          ref={contentRef}
          onScroll={handleScroll}
        >
          {!hasContent ? (
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
                  {liveInLastGroup && gi === groups.length - 1 && liveAgent && (
                    <TimelineLiveItem
                      agent={liveAgent}
                      text={liveText ?? ''}
                      reasoning={liveReasoning ?? ''}
                      color={liveColor}
                    />
                  )}
                </li>
              ))}
              {needsNewLiveGroup && liveAgent && (
                <li className={styles.turnGroup}>
                  <div className={styles.turnDivider} aria-label={`Turn ${currentTurn}`}>
                    <span className={styles.turnLabel}>Turn {currentTurn}</span>
                  </div>
                  <TimelineLiveItem
                    agent={liveAgent}
                    text={liveText ?? ''}
                    reasoning={liveReasoning ?? ''}
                    color={liveColor}
                  />
                </li>
              )}
            </ol>
          )}

          {showJumpToLatest && (
            <button
              type="button"
              className={`${styles.jumpBtn} primary`}
              onClick={() => { scrollToBottom('smooth'); setAtBottom(true); }}
            >
              ↓ Jump to latest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ msg, color }: { msg: TranscriptMessage; color: string }) {
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const failed = msg.status === 'failed';
  // Mirror the card (header + body) for RTL languages; the spine node stays put.
  const dir = dirForLanguage(msg.language);
  const [showReasoning, setShowReasoning] = useState(false);
  const split = extractInlineThinking(msg.content);
  const visibleContent = split.text;
  const reasoning = [msg.reasoning, split.reasoning].filter(Boolean).join('\n\n') || undefined;

  return (
    <div className={`${styles.item} ${failed ? styles.itemFailed : ''}`}>
      <span className={styles.node} style={{ backgroundColor: color }} aria-hidden="true" />
      <div className={styles.card} dir={dir}>
        <div className={styles.cardHeader}>
          <span className={styles.agent}>
            {msg.agentName}
            {msg.agentDeleted && <span className="chip"> deleted</span>}
          </span>
          {msg.role && <span className="chip">{msg.role}</span>}
          {msg.status === 'stopped' && <span className="chip">stopped</span>}
          {reasoning && (
            <button
              type="button"
              className="chip"
              aria-expanded={showReasoning}
              onClick={() => setShowReasoning((v) => !v)}
            >
              thinking {showReasoning ? '▾' : '▸'}
            </button>
          )}
          <span className={styles.meta}>
            {msg.model || '—'} · {time}
            {msg.durationMs != null && ` · ${formatDuration(msg.durationMs)}`}
            {msg.totalTokens != null && ` · ${msg.totalTokens} tok`}
          </span>
        </div>
        {msg.sourceAgentId && msg.connectionType && (
          <div className={styles.source}>via {msg.connectionType} connection</div>
        )}
        {showReasoning && reasoning && (
          <div className={styles.body} dir="ltr">
            <pre>{reasoning}</pre>
          </div>
        )}
        {/* No explicit dir: inherits the forced direction from the card
            above (driven by the agent's language), not a content guess. */}
        <div className={styles.body}>
          {failed ? (
            <span className={styles.errText}>Failed: {msg.error}</span>
          ) : visibleContent ? (
            <MessageMarkdown content={visibleContent} />
          ) : reasoning ? (
            <span className={styles.source}>
              No visible answer — the model only produced thinking. Expand “thinking” or raise Max
              output tokens.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * In-flight agent response on the timeline spine. Reasoning stays behind a
 * collapsed thinking chip; only answer tokens stream in the body.
 */
function TimelineLiveItem({
  agent,
  text,
  reasoning: reasoningProp = '',
  color,
}: {
  agent: Agent;
  text: string;
  reasoning?: string;
  color: string;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  const split = extractInlineThinking(text);
  const visible = split.text;
  const reasoning =
    [reasoningProp, split.reasoning].filter((s) => s && s.length > 0).join('\n\n') || undefined;
  const thinking = visible.length === 0;
  const dir = dirForLanguage(agent.language);

  return (
    <div className={`${styles.item} ${styles.itemLive}`} aria-live="polite">
      <span className={styles.node} style={{ backgroundColor: color }} aria-hidden="true" />
      <div className={styles.card} dir={dir} style={{ '--agent-color': color } as CSSProperties}>
        <div className={styles.cardHeader}>
          <span className={styles.agent}>{agent.name}</span>
          {agent.role && <span className="chip">{agent.role}</span>}
          {reasoning && (
            <button
              type="button"
              className="chip"
              aria-expanded={showReasoning}
              onClick={() => setShowReasoning((v) => !v)}
            >
              thinking {showReasoning ? '▾' : '▸'}
            </button>
          )}
          <span className={styles.liveBadge}>{thinking ? 'thinking…' : 'streaming…'}</span>
        </div>
        {showReasoning && reasoning && (
          <div className={styles.body} dir="ltr">
            <pre>{reasoning}</pre>
          </div>
        )}
        <div className={`${styles.body} ${styles.liveBody}`}>
          {visible}
          <span className={styles.caret} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
