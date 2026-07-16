import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Agent, TranscriptMessage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import {
  generateConversationInsight,
  resolveInsightTarget,
  type InsightKind,
} from '../../agents/conversationInsights';
import { continueRun, startRun } from '../../orchestrator/orchestrator';
import { hasBlockingErrors, validateForRun } from '../../orchestrator/validate';
import { addressableAgents, parseMention } from '../addressing';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useLlmSettingsStore } from '../../store/llmSettingsStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useUiStore } from '../../store/uiStore';
import { agentColor } from '../../graph/colors';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../store/prefs';
import { formatDuration, formatNumber, formatTime } from '../../i18n/format';
import { MessageMarkdown } from '../transcript/MessageMarkdown';
import { downloadText } from '../fileDownload';
import {
  conversationToJson,
  conversationToMarkdown,
  conversationToPlainText,
  exportBaseName,
} from './exportConversation';
import { groupByTurn, isInterjectionGroup } from './turnGroups';
import styles from './Timeline.module.css';

/** First grapheme-ish character of the agent's name for the spine disc. */
function agentInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}

/** Compact token count for the header stats (e.g. 12.4k). */
function formatTokens(n: number, lang: Language): string {
  return n >= 10_000 ? `${formatNumber(Math.round(n / 100) / 10, lang)}k` : formatNumber(n, lang);
}

const EXPORT_FORMATS = [
  { key: 'md', label: 'Markdown (.md)', mime: 'text/markdown' },
  { key: 'txt', label: 'Plain text (.txt)', mime: 'text/plain' },
  { key: 'json', label: 'JSON (.json)', mime: 'application/json' },
] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number]['key'];

/** Extra-turn choices for "Continue"; the playground's own limit is merged in. */
const BASE_TURN_OPTIONS = [1, 2, 3, 4, 6, 8, 12];

interface InsightState {
  kind: InsightKind;
  status: 'loading' | 'done' | 'error';
  text?: string;
  model?: string;
  error?: string;
}

/**
 * Full-screen conversation timeline (spec §13). Renders the entire transcript
 * as a vertical spine grouped by turn, with header export tools and a footer
 * for continuing/steering the conversation. Opened from the toolbar via
 * `openPanel === 'timeline'`; the live BottomPanel transcript is untouched.
 */
export function TimelinePage() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
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
  const providers = useProviderStore((s) => s.providers);
  const llmSettings = useLlmSettingsStore((s) => s.settings);

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

  // ---------------------------------------------------------------------------
  // Footer tools: continue N more turns / summarize / review / interject.
  // ---------------------------------------------------------------------------

  // Same gate the Run paths use: a playground whose graph validates clean.
  const graphOk = useMemo(
    () => !!playground && !hasBlockingErrors(validateForRun(playground, providers)),
    [playground, providers],
  );
  const idle = status !== 'running' && status !== 'paused';
  // Continue re-enters via startRun, which no-ops while running OR paused.
  const canRunMore = idle && transcript.length > 0 && graphOk;
  // Interjection mirrors BottomPanel's follow-up gate (paused runs pick the
  // message up as a pending user directive when they resume).
  const canInterject = status !== 'running' && transcript.length > 0 && graphOk;

  const [moreTurns, setMoreTurns] = useState(2);
  // Surface the actual blocker rather than a single canned line.
  const continueTitle = canRunMore
    ? t('timeline.continueTitle', { count: moreTurns })
    : !idle
      ? t('timeline.continueBlockedRunning')
      : !graphOk
        ? t('timeline.continueBlockedConfig')
        : t('timeline.continueBlockedEmpty');

  const turnOptions = useMemo(() => {
    const opts = new Set(BASE_TURN_OPTIONS);
    if (playground) opts.add(playground.conversation.maxTotalTurns);
    return [...opts].sort((a, b) => a - b);
  }, [playground]);

  const [interjectOpen, setInterjectOpen] = useState(false);
  const [interjectText, setInterjectText] = useState('');

  function handleInterject(e: FormEvent) {
    e.preventDefault();
    const text = interjectText.trim();
    if (!text || !canInterject) return;
    // Leading "@AgentName" addresses that agent directly — it answers next.
    const mention = parseMention(text, addressableAgents(playground?.agents ?? []));
    if (mention && mention.message) {
      continueRun(mention.message, { targetAgentId: mention.target.id });
    } else {
      continueRun(text);
    }
    setInterjectText('');
    setAtBottom(true);
  }

  // On-demand summary/review: runs against the provider/model configured in
  // Settings, or (when unset) borrows a suitable agent's. Never touches the
  // transcript. Recomputed when the settings target changes so the buttons and
  // the actual call always agree on where the insight will run.
  const insightTarget = useMemo(
    () => (playground ? resolveInsightTarget(playground, providers, llmSettings) : null),
    [playground, providers, llmSettings],
  );
  const canInsight = transcript.length > 0 && !!insightTarget;

  const [insight, setInsight] = useState<InsightState | null>(null);
  const insightAbort = useRef<AbortController | null>(null);
  useEffect(() => () => insightAbort.current?.abort(), []);

  async function runInsight(kind: InsightKind) {
    if (!playground || !insightTarget) return;
    insightAbort.current?.abort();
    const controller = new AbortController();
    insightAbort.current = controller;
    setInsight({ kind, status: 'loading' });
    const res = await generateConversationInsight(kind, playground, insightTarget, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    setInsight(
      res.ok
        ? { kind, status: 'done', text: res.text, model: res.model }
        : { kind, status: 'error', error: res.errorSummary },
    );
  }

  function closeInsight() {
    insightAbort.current?.abort();
    setInsight(null);
  }

  // ---------------------------------------------------------------------------
  // Header export menu.
  // ---------------------------------------------------------------------------

  const [exportOpen, setExportOpen] = useState(false);
  const exportOpenRef = useRef(false);
  exportOpenRef.current = exportOpen;
  const exportWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportWrapRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  // 'ok'/'fail' drive a transient chip; null hides it. Reports the real result
  // of the clipboard write rather than always claiming success.
  const [copyState, setCopyState] = useState<'ok' | 'fail' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  async function copyToClipboard(text: string) {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    // navigator.clipboard is undefined in insecure contexts; treat as failure.
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    setCopyState(ok ? 'ok' : 'fail');
    copiedTimer.current = setTimeout(() => setCopyState(null), 1800);
  }

  function handleExport(format: ExportFormat) {
    if (!playground) return;
    const def = EXPORT_FORMATS.find((f) => f.key === format)!;
    const content =
      format === 'md'
        ? conversationToMarkdown(playground)
        : format === 'txt'
          ? conversationToPlainText(playground)
          : conversationToJson(playground);
    downloadText(exportBaseName(playground), content, def.key, def.mime);
    setExportOpen(false);
  }

  function handleCopyMarkdown() {
    if (!playground) return;
    setExportOpen(false);
    void copyToClipboard(conversationToMarkdown(playground));
  }

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

  // Escape closes (the export menu first, if open); restore focus to whatever
  // was focused before opening (spec §22).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (exportOpenRef.current) setExportOpen(false);
      else close();
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
      aria-label={t('timeline.eyebrow')}
      onMouseDown={(e) => {
        // Backdrop click (only when the press starts on the overlay itself) closes.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.panel} ref={panelRef} tabIndex={-1}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>{t('timeline.eyebrow')}</span>
            <h1 className={styles.title} dir="auto">{playground?.name || t('timeline.untitledPlayground')}</h1>
          </div>
          <div className={styles.headerRight}>
            {transcript.length > 0 && (
              <div className={styles.stats}>
                <span className={styles.stat}>
                  <strong>{formatNumber(stats.turns, language)}</strong>{' '}
                  {t('timeline.turnsLabel', { count: stats.turns })}
                </span>
                <span className={styles.stat}>
                  <strong>{formatNumber(stats.messages, language)}</strong>{' '}
                  {t('timeline.messagesLabel', { count: stats.messages })}
                </span>
                {stats.duration > 0 && (
                  <span className={styles.stat}>
                    <strong>{formatDuration(stats.duration, language)}</strong>
                  </span>
                )}
                {stats.hasTokens && (
                  <span className={styles.stat}>
                    <strong>~{formatTokens(stats.tokens, language)}</strong>{' '}
                    {t('timeline.tokensLabel')}
                  </span>
                )}
              </div>
            )}
            {copyState && (
              <span className="chip">{copyState === 'ok' ? t('timeline.copied') : t('timeline.copyFailed')}</span>
            )}
            <div className={styles.exportWrap} ref={exportWrapRef}>
              <button
                type="button"
                className="secondary"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                disabled={transcript.length === 0}
                onClick={() => setExportOpen((v) => !v)}
              >
                {t('timeline.export')}
              </button>
              {exportOpen && (
                <div className={styles.exportMenu} role="menu" aria-label={t('timeline.exportMenuLabel')}>
                  {EXPORT_FORMATS.map((f) => (
                    <button key={f.key} type="button" role="menuitem" onClick={() => handleExport(f.key)}>
                      {t(`timeline.exportFormat.${f.key}`)}
                    </button>
                  ))}
                  <div className={styles.exportSep} role="separator" />
                  <button type="button" role="menuitem" onClick={handleCopyMarkdown}>
                    {t('timeline.copyAsMarkdown')}
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="icon ghost" onClick={close} aria-label={t('timeline.closeTimeline')}>
              ✕
            </button>
          </div>
        </header>

        <div
          className={styles.content}
          ref={contentRef}
          onScroll={handleScroll}
        >
          {!hasContent ? (
            <div className={styles.empty}>
              <div className={styles.emptySpine} aria-hidden="true">
                <span /><span /><span />
              </div>
              <p className={styles.emptyTitle}>{t('timeline.emptyTitle')}</p>
              <p className={styles.emptyHint}>{t('timeline.emptyHint')}</p>
            </div>
          ) : (
            <ol className={styles.timeline}>
              {groups.map((group, gi) => (
                <li key={gi} className={styles.turnGroup}>
                  {isInterjectionGroup(group) ? (
                    <div className={styles.interjectDivider} aria-label={t('timeline.interjectionAria')}>
                      <span className={styles.interjectLabel}>{t('timeline.interjectionLabel')}</span>
                    </div>
                  ) : (
                    <div className={styles.turnDivider} aria-label={t('timeline.turn', { turn: group.turn })}>
                      <span className={styles.turnLabel}>{t('timeline.turn', { turn: group.turn })}</span>
                    </div>
                  )}
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
                  <div className={styles.turnDivider} aria-label={t('timeline.turn', { turn: currentTurn })}>
                    <span className={styles.turnLabel}>{t('timeline.turn', { turn: currentTurn })}</span>
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
              {t('timeline.jumpToLatest')}
            </button>
          )}
        </div>

        {hasContent && (
          <footer className={styles.footer}>
            {insight && (
              <section
                className={styles.insight}
                aria-label={insight.kind === 'summary' ? t('timeline.summaryAria') : t('timeline.reviewAria')}
              >
                <div className={styles.insightHeader}>
                  <strong>{insight.kind === 'summary' ? t('timeline.summary') : t('timeline.review')}</strong>
                  {insight.model && <span className={styles.insightMeta} dir="auto">{insight.model}</span>}
                  <span className={styles.insightSpacer} />
                  {insight.status === 'done' && insight.text && (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void copyToClipboard(insight.text!)}
                      >
                        {t('timeline.copy')}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          playground &&
                          downloadText(
                            `${playground.name || 'conversation'}-${insight.kind}`,
                            insight.text!,
                            'md',
                            'text/markdown',
                          )
                        }
                      >
                        {t('timeline.download')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="icon ghost"
                    onClick={closeInsight}
                    aria-label={insight.kind === 'summary' ? t('timeline.closeSummary') : t('timeline.closeReview')}
                  >
                    ✕
                  </button>
                </div>
                <div className={styles.insightBody}>
                  {insight.status === 'loading' && (
                    <span className={styles.insightLoading}>
                      {insight.kind === 'summary'
                        ? t('timeline.generatingSummary')
                        : t('timeline.generatingReview')}
                    </span>
                  )}
                  {insight.status === 'error' && (
                    <span className={styles.errText} dir="auto">{insight.error ?? t('timeline.generationFailed')}</span>
                  )}
                  {insight.status === 'done' && insight.text && <MessageMarkdown content={insight.text} />}
                </div>
              </section>
            )}

            <div className={styles.footerBar}>
              <div className={styles.footerGroup}>
                <button
                  type="button"
                  className="primary"
                  disabled={!canRunMore}
                  title={continueTitle}
                  // Continue re-opens the discussion from the starting agent (like
                  // the follow-up box, minus an injected user message) for `maxTurns`
                  // more turns, then re-runs the wrap-up so the transcript ends with
                  // a fresh, current summary/finalizer. Non-destructive: prior
                  // wrap-up output stays as an intermediate snapshot. Turn numbers
                  // continue monotonically (see orchestrator startTurn).
                  onClick={() => void startRun({ maxTurns: moreTurns })}
                >
                  {t('timeline.continue')}
                </button>
                <select
                  value={moreTurns}
                  onChange={(e) => setMoreTurns(Number(e.target.value))}
                  disabled={!canRunMore}
                  aria-label={t('timeline.moreTurnsAria')}
                >
                  {turnOptions.map((n) => (
                    <option key={n} value={n}>
                      {t('timeline.turnOption', { count: n })}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.footerGroup}>
                <button
                  type="button"
                  className="secondary"
                  disabled={!canInsight || insight?.status === 'loading'}
                  title={canInsight ? t('timeline.summarizeTitle') : t('timeline.insightBlocked')}
                  onClick={() => void runInsight('summary')}
                >
                  {t('timeline.summarize')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!canInsight || insight?.status === 'loading'}
                  title={canInsight ? t('timeline.reviewTitle') : t('timeline.insightBlocked')}
                  onClick={() => void runInsight('review')}
                >
                  {t('timeline.review')}
                </button>
              </div>
              <button
                type="button"
                className={`ghost ${styles.interjectToggle}`}
                aria-expanded={interjectOpen}
                onClick={() => setInterjectOpen((v) => !v)}
              >
                {t('timeline.interject')} {interjectOpen ? '▾' : '▸'}
              </button>
            </div>

            {interjectOpen && (
              <form className={styles.interject} onSubmit={handleInterject}>
                <textarea
                  value={interjectText}
                  rows={2}
                  onChange={(e) => setInterjectText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleInterject(e);
                  }}
                  placeholder={t('timeline.interjectPlaceholder')}
                  aria-label={t('timeline.interjectAria')}
                />
                <button type="submit" className="primary" disabled={!canInterject || !interjectText.trim()}>
                  {t('timeline.send')}
                </button>
              </form>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function TimelineItem({ msg, color }: { msg: TranscriptMessage; color: string }) {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const time = formatTime(msg.timestamp, language);
  const failed = msg.status === 'failed';
  // Mirror the card (header + body) for RTL languages; the spine node stays put.
  const dir = dirForLanguage(msg.language);
  const [showReasoning, setShowReasoning] = useState(false);
  const split = extractInlineThinking(msg.content);
  const visibleContent = split.text;
  const reasoning = [msg.reasoning, split.reasoning].filter(Boolean).join('\n\n') || undefined;

  return (
    <div
      className={`${styles.item} ${failed ? styles.itemFailed : ''}`}
      style={{ '--agent-color': color } as CSSProperties}
    >
      <span className={styles.node} aria-hidden="true">
        {agentInitial(msg.agentName)}
      </span>
      <div className={styles.card} dir={dir}>
        <div className={styles.cardHeader}>
          <span className={styles.agent}>
            {msg.agentName}
            {msg.agentDeleted && <span className="chip">{t('timeline.deleted')}</span>}
          </span>
          {msg.role && <span className="chip">{msg.role}</span>}
          {msg.targetAgentName && <span className="chip">→ {msg.targetAgentName}</span>}
          {msg.answeringTo && (
            <span className="chip">{t('timeline.answering', { name: msg.answeringTo })}</span>
          )}
          {msg.status === 'stopped' && <span className="chip">{t('timeline.stopped')}</span>}
          {reasoning && (
            <button
              type="button"
              className="chip"
              aria-expanded={showReasoning}
              onClick={() => setShowReasoning((v) => !v)}
            >
              {t('timeline.thinking')} {showReasoning ? '▾' : '▸'}
            </button>
          )}
          <span className={styles.meta}>
            {msg.model || '—'} · {time}
            {msg.durationMs != null && ` · ${formatDuration(msg.durationMs, language)}`}
            {msg.totalTokens != null && ` · ${formatNumber(msg.totalTokens, language)} ${t('timeline.tokensLabel')}`}
          </span>
        </div>
        {msg.sourceAgentId && msg.connectionType && (
          <div className={styles.source}>{t('timeline.viaConnection', { type: msg.connectionType })}</div>
        )}
        {msg.topicChange && (
          <div className={styles.source}>{t('timeline.topicRedirected', { topic: msg.topicChange })}</div>
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
            <span className={styles.errText}>{t('timeline.failedPrefix')}{msg.error}</span>
          ) : visibleContent ? (
            <MessageMarkdown content={visibleContent} />
          ) : reasoning ? (
            <span className={styles.source}>
              {t('timeline.noVisibleAnswer')}
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
  const { t } = useTranslation();
  const [showReasoning, setShowReasoning] = useState(false);
  const split = extractInlineThinking(text);
  const visible = split.text;
  const reasoning =
    [reasoningProp, split.reasoning].filter((s) => s && s.length > 0).join('\n\n') || undefined;
  const thinking = visible.length === 0;
  const dir = dirForLanguage(agent.language);

  return (
    <div
      className={`${styles.item} ${styles.itemLive}`}
      aria-live="polite"
      style={{ '--agent-color': color } as CSSProperties}
    >
      <span className={styles.node} aria-hidden="true">
        {agentInitial(agent.name)}
      </span>
      <div className={styles.card} dir={dir}>
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
              {t('timeline.thinking')} {showReasoning ? '▾' : '▸'}
            </button>
          )}
          <span className={styles.liveBadge}>{thinking ? t('timeline.thinkingBadge') : t('timeline.streamingBadge')}</span>
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
