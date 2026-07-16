import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { useUiStore } from '../store/uiStore';
import { formatDuration, formatNumber, formatTime } from '../i18n/format';
import { agentColor } from '../graph/colors';
import { continueRun, retryAgentTurn } from '../orchestrator/orchestrator';
import { hasBlockingErrors, validateForRun } from '../orchestrator/validate';
import { addressableAgents, mentionSuggestions, parseMention } from './addressing';
import { Message } from './transcript/Message';
import { LiveMessage } from './transcript/LiveMessage';
import styles from './BottomPanel.module.css';

type Tab = 'transcript' | 'log' | 'errors';

const RUN_STATUS_KEY: Record<string, string> = {
  idle: 'bottomPanel.statusIdle',
  running: 'bottomPanel.statusRunning',
  paused: 'bottomPanel.statusPaused',
  stopped: 'bottomPanel.statusStopped',
  completed: 'bottomPanel.statusCompleted',
  error: 'bottomPanel.statusError',
  interrupted: 'bottomPanel.statusInterrupted',
};

export function BottomPanel() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
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
  const liveReasoning = useRuntimeStore((s) =>
    s.activeAgentId ? s.streamingReasoning[s.activeAgentId] : undefined,
  );

  const providers = useProviderStore((s) => s.providers);

  const [tab, setTab] = useState<Tab>('transcript');
  const transcript = playground?.transcript ?? [];

  // Follow-up input: lets the user steer the conversation ("argue against this",
  // "give me the facts") after a run has stopped, without reopening Run Dialog.
  // Starting the message with "@AgentName" addresses that agent directly — it
  // answers first, out of graph order (spec extension: orchestration control).
  const [followUp, setFollowUp] = useState('');
  const canContinue =
    status !== 'running' && transcript.length > 0 && !!playground &&
    !hasBlockingErrors(validateForRun(playground, providers));

  const addressable = useMemo(() => addressableAgents(playground?.agents ?? []), [playground?.agents]);
  const mention = parseMention(followUp.trim(), addressable);
  const suggestions = mentionSuggestions(followUp, addressable);

  function handleContinue(e: FormEvent) {
    e.preventDefault();
    const text = followUp.trim();
    if (!text || !canContinue) return;
    if (mention && mention.message) {
      continueRun(mention.message, { targetAgentId: mention.target.id });
    } else {
      continueRun(text);
    }
    setFollowUp('');
  }

  // The agent currently active during a run — shown as a live bubble that reads
  // "thinking…" until the first token arrives, then streams.
  const liveAgent =
    status === 'running' && activeAgentId
      ? playground?.agents.find((a) => a.id === activeAgentId) ?? null
      : null;

  // Resolve each message's identity color from its agent (deleted → slate), so
  // the transcript shares the canvas/timeline color language.
  const colorFor = useMemo(() => {
    const byId = new Map((playground?.agents ?? []).map((a) => [a.id, a.colorCategory]));
    return (agentId: string | null) => agentColor(agentId ? byId.get(agentId) : null);
  }, [playground?.agents]);

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

  // Auto-scroll to the newest message ONLY when the reader is already near the
  // bottom, so scrolling up to read history isn't yanked back on every token.
  const contentRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    const el = contentRef.current;
    if (!el) return;
    // Smooth scrolling uses scrollTo when available; the default 'auto' path sets
    // scrollTop directly so it works in jsdom (which lacks a functional scrollTo).
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
    if (tab === 'transcript' && !collapsed && atBottom) scrollToBottom();
  }, [transcript.length, tab, collapsed, liveText, liveReasoning, atBottom]);

  const showJumpToLatest = tab === 'transcript' && !collapsed && !atBottom && (transcript.length > 0 || !!liveAgent);

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'transcript', label: t('bottomPanel.tabTranscript'), count: transcript.length },
    { key: 'log', label: t('bottomPanel.tabLog'), count: events.length },
    { key: 'errors', label: t('bottomPanel.tabErrors'), count: errors.length },
  ];

  // Arrow-key navigation across the tablist (WAI-ARIA tabs pattern).
  function onTabKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = TABS.findIndex((tb) => tb.key === tab);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : (i - 1 + TABS.length) % TABS.length;
    setTab(TABS[next].key);
    document.getElementById(`bp-tab-${TABS[next].key}`)?.focus();
  }

  return (
    <section className={styles.panel} data-collapsed={collapsed || undefined} aria-label={t('bottomPanel.panelAria')}>
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label={t('bottomPanel.tablistAria')}>
          {TABS.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              id={`bp-tab-${tb.key}`}
              aria-controls={`bp-panel-${tb.key}`}
              aria-selected={tab === tb.key}
              tabIndex={tab === tb.key ? 0 : -1}
              className={tab === tb.key ? styles.tabActive : ''}
              onClick={() => setTab(tb.key)}
              onKeyDown={onTabKeyDown}
            >
              {tb.label} ({formatNumber(tb.count, language)})
            </button>
          ))}
        </div>
        <div className={styles.headerRight}>
          {transcript.length > 0 && (
            <span className={styles.stats}>
              {stats.duration > 0 && formatDuration(stats.duration, language)}
              {stats.hasTokens && t('bottomPanel.tokensStat', { tokens: formatNumber(stats.tokens, language) })}
            </span>
          )}
          <span className={`${styles.status} ${styles[`status_${status}`] ?? ''}`}>
            {RUN_STATUS_KEY[status] ? t(RUN_STATUS_KEY[status]) : status}{status === 'running' ? t('bottomPanel.turnSuffix', { turn: currentTurn }) : ''}
          </span>
          {tab === 'transcript' && transcript.length > 0 && (
            <button type="button" onClick={() => clearTranscript()} disabled={status === 'running'}>{t('bottomPanel.clear')}</button>
          )}
          <button
            type="button"
            aria-label={collapsed ? t('bottomPanel.expand') : t('bottomPanel.collapse')}
            onClick={() => updateUiLayout({ bottomPanelCollapsed: !collapsed })}
          >
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div
          className={styles.content}
          data-testid="bottom-panel-content"
          ref={contentRef}
          onScroll={handleScroll}
          role="tabpanel"
          id={`bp-panel-${tab}`}
          aria-labelledby={`bp-tab-${tab}`}
        >
          {tab === 'transcript' && (
            transcript.length === 0 && !liveAgent ? (
              <p className={styles.empty}>{t('bottomPanel.emptyTranscript')}</p>
            ) : (
              <>
                {transcript.map((msg) => <Message key={msg.id} msg={msg} color={colorFor(msg.agentId)} />)}
                {liveAgent && (
                  <LiveMessage
                    agentName={liveAgent.name}
                    role={liveAgent.role}
                    text={liveText ?? ''}
                    reasoning={liveReasoning ?? ''}
                    color={agentColor(liveAgent.colorCategory)}
                    language={liveAgent.language}
                  />
                )}
              </>
            )
          )}

          {tab === 'log' && (
            events.length === 0 ? (
              <p className={styles.empty}>{t('bottomPanel.emptyLog')}</p>
            ) : (
              <ul className={styles.log}>
                {events.map((e) => (
                  <li key={e.id}>
                    <span className={styles.logTime}>{formatTime(e.at, language)}</span>
                    <span className="chip">{e.kind}</span>
                    <span dir="auto">{e.message}</span>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === 'errors' && (
            errors.length === 0 ? (
              <p className={styles.empty}>{t('bottomPanel.emptyErrors')}</p>
            ) : (
              errors.map((err) => (
                <div key={err.id} className={styles.errorItem}>
                  <span className={styles.logTime}>{formatTime(err.at, language)}</span>{' '}
                  <strong>[{err.level}] {err.summary}</strong>
                  {err.provider && <span className="muted"> · {err.provider}</span>}
                  {err.retryEligible && <span className="chip"> {t('bottomPanel.retryEligible')}</span>}
                  {err.errorKind && <span className="chip">{err.errorKind}</span>}
                  {err.agentId && status !== 'running' && status !== 'paused' && (
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginInlineStart: 8 }}
                      onClick={() => retryAgentTurn(err.agentId!)}
                      title={t('bottomPanel.retryTitle')}
                    >
                      {t('bottomPanel.retry')}
                    </button>
                  )}
                  {err.detail && <div className={styles.errorDetail} dir="auto">{err.detail}</div>}
                </div>
              ))
            )
          )}
        </div>
      )}

      {showJumpToLatest && (
        <button
          type="button"
          className={`${styles.jumpBtn} primary`}
          onClick={() => { scrollToBottom('smooth'); setAtBottom(true); }}
        >
          {t('bottomPanel.jumpToLatest')}
        </button>
      )}

      {!collapsed && tab === 'transcript' && status !== 'running' && transcript.length > 0 && (
        <form className={styles.followUp} onSubmit={handleContinue}>
          {suggestions.length > 0 && (
            <div className={styles.mentionSuggestions} role="listbox" aria-label={t('bottomPanel.addressAgentAria')}>
              {suggestions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  dir="auto"
                  onClick={() => setFollowUp(`@${a.name} `)}
                >
                  @{a.name}
                </button>
              ))}
            </div>
          )}
          {mention && (
            <span className="chip" dir="auto" title={t('bottomPanel.mentionTitle', { name: mention.target.name })}>
              {t('bottomPanel.mentionTo', { name: mention.target.name })}
            </span>
          )}
          <input
            type="text"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            placeholder={t('bottomPanel.followUpPlaceholder')}
            aria-label={t('bottomPanel.followUpAria')}
          />
          <button
            type="submit"
            className="primary"
            disabled={!canContinue || !followUp.trim() || (!!mention && !mention.message)}
          >
            {t('bottomPanel.continue')}
          </button>
        </form>
      )}
    </section>
  );
}
