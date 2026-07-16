import { type CSSProperties, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptMessage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { MessageMarkdown } from './MessageMarkdown';
import { FailureDiagnostics } from './FailureDiagnostics';
import { formatDuration, formatNumber, formatTime } from '../../i18n/format';
import styles from './Transcript.module.css';

/**
 * One transcript message (spec §13.1). Model output is rendered as sanitized
 * Markdown — rehype-sanitize strips any HTML/script so provider output can never
 * inject markup (spec §21).
 */
// Memoized: a committed transcript message never changes, and its snapshot
// selector is keyed by msg.id, so during an active stream (which re-renders the
// parent BottomPanel on every token) unaffected messages skip re-rendering
// instead of re-parsing their Markdown and inline-thinking on each token.
export const Message = memo(function Message({ msg, color }: { msg: TranscriptMessage; color?: string }) {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const failed = msg.status === 'failed';
  const [expanded, setExpanded] = useState(true);
  const [showRequest, setShowRequest] = useState(failed);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const showToast = useUiStore((s) => s.showToast);
  const snapshot = useRuntimeStore((s) => s.requestSnapshots[msg.id]);

  // Safety net for older turns that stored inline think tags in `content`
  // before extraction handled Qwen's closer-only form.
  const split = useMemo(() => extractInlineThinking(msg.content), [msg.content]);
  const visibleContent = split.text;
  const reasoning = [msg.reasoning, split.reasoning].filter(Boolean).join('\n\n') || undefined;

  const time = formatTime(msg.timestamp, language);
  // Mirror the whole message (header, alignment, body) for RTL languages so
  // Persian output reads naturally right-to-left.
  const dir = dirForLanguage(msg.language);
  const style = color ? ({ '--agent-color': color } as CSSProperties) : undefined;

  return (
    <div
      className={`${styles.message} ${failed ? styles.failed : ''}`}
      dir={dir}
      style={style}
    >
      <div className={styles.msgHeader}>
        <span className={styles.dot} style={{ backgroundColor: color }} aria-hidden="true" />
        <span className={styles.msgAgent}>
          {msg.agentName}
          {msg.agentDeleted && <span className="chip"> {t('transcript.deleted')}</span>}
        </span>
        {msg.role && <span className="chip">{msg.role}</span>}
        {msg.targetAgentName && (
          <span className="chip" title={t('transcript.directsQuestionAt', { name: msg.targetAgentName })}>
            → {msg.targetAgentName}
          </span>
        )}
        {msg.answeringTo && (
          <span className="chip" title={t('transcript.outOfTurnReply', { name: msg.answeringTo })}>
            {t('transcript.answering', { name: msg.answeringTo })}
          </span>
        )}
        {reasoning && (
          <button
            type="button"
            className="chip"
            aria-expanded={showReasoning}
            onClick={() => setShowReasoning((v) => !v)}
          >
            {t('transcript.thinking')} {showReasoning ? '▾' : '▸'}
          </button>
        )}
        {msg.toolTrace && msg.toolTrace.length > 0 && (
          <button
            type="button"
            className="chip"
            aria-expanded={showTools}
            onClick={() => setShowTools((v) => !v)}
          >
            {t('transcript.toolsCount', { n: msg.toolTrace.length })} {showTools ? '▾' : '▸'}
          </button>
        )}
        <span className={styles.msgMeta}>
          {t('transcript.turnLabel', { n: msg.turn })} · {msg.model || '—'} · {time}
          {msg.durationMs != null && ` · ${formatDuration(msg.durationMs, language)}`}
          {msg.totalTokens != null && ` · ${t('transcript.tokens', { n: msg.totalTokens })}`}
        </span>
        <span className={styles.msgActions}>
          {snapshot && (
            <button
              type="button"
              aria-label={t('transcript.inspectRequestMetadata')}
              title={t('transcript.inspectRequest')}
              aria-pressed={showRequest}
              onClick={() => setShowRequest((v) => !v)}
            >
              ⓘ
            </button>
          )}
          <button
            type="button"
            aria-label={t('transcript.copyResponse')}
            title={t('transcript.copy')}
            onClick={() => {
              if (!navigator.clipboard) {
                showToast('error', t('transcript.clipboardUnavailable'));
                return;
              }
              navigator.clipboard.writeText(visibleContent).then(
                () => showToast('info', t('transcript.copiedResponse')),
                () => showToast('error', t('transcript.couldNotCopyResponse')),
              );
            }}
          >
            ⧉
          </button>
          <button type="button" aria-label={expanded ? t('transcript.collapse') : t('transcript.expand')} onClick={() => setExpanded((e) => !e)}>
            {expanded ? '−' : '+'}
          </button>
        </span>
      </div>
      {msg.sourceAgentId && msg.connectionType && (
        <div className={styles.msgSource}>
          {t('transcript.viaConnection', { type: msg.connectionType })}
        </div>
      )}
      {msg.topicChange && (
        <div className={styles.msgSource}>
          {t('transcript.topicRedirected', { topic: msg.topicChange })}
        </div>
      )}
      {showReasoning && reasoning && (
        <div className={styles.request} dir="ltr">
          <pre className={styles.reqPre}>{reasoning}</pre>
        </div>
      )}
      {showTools && msg.toolTrace && msg.toolTrace.length > 0 && (
        <div className={styles.request} dir="ltr">
          <pre className={styles.reqPre}>
            {msg.toolTrace
              .map(
                (t) =>
                  `→ ${t.tool} ${t.input}${t.durationMs != null ? ` (${formatDuration(t.durationMs, language)})` : ''}\n${t.result}`,
              )
              .join('\n\n')}
          </pre>
        </div>
      )}
      {expanded && (
        // No explicit dir here: inherits the deterministic direction from the
        // message container above, driven by the agent's configured language.
        // dir="auto" would instead guess from content, which stays LTR until
        // enough RTL script accumulates — wrong for streaming/short replies.
        <div className={styles.msgBody}>
          {failed ? (
            <FailureDiagnostics
              snapshot={snapshot}
              fallbackError={msg.error}
              showRequest={showRequest}
              onToggleRequest={() => setShowRequest((v) => !v)}
            />
          ) : visibleContent ? (
            <MessageMarkdown content={visibleContent} />
          ) : reasoning ? (
            <span className={styles.msgSource}>
              {t('transcript.noVisibleAnswer')}
            </span>
          ) : null}
        </div>
      )}

      {showRequest && snapshot && (
        <div className={styles.request} dir="ltr">
          <div className={styles.reqRow}><span>{t('transcript.reqUrl')}</span><code>{snapshot.url}</code></div>
          <div className={styles.reqRow}><span>{t('transcript.reqProvider')}</span><code>{snapshot.providerName}</code></div>
          <div className={styles.reqRow}><span>{t('transcript.reqModel')}</span><code>{snapshot.model}</code></div>
          <div className={styles.reqRow}>
            <span>{t('transcript.reqStatus')}</span>
            <code>{snapshot.status ?? '—'}{snapshot.finishReason ? ` · ${snapshot.finishReason}` : ''}{snapshot.streamedError ? ` · ${t('transcript.midStream')}` : ''}</code>
          </div>
          {snapshot.errorKind && (
            <div className={styles.reqRow}><span>{t('transcript.reqKind')}</span><code>{snapshot.errorKind}</code></div>
          )}
          {snapshot.errorType && (
            <div className={styles.reqRow}><span>{t('transcript.reqType')}</span><code>{snapshot.errorType}</code></div>
          )}
          {snapshot.rawUpstream && (
            <div className={styles.reqRow}><span>{t('transcript.reqUpstream')}</span><code>{snapshot.rawUpstream}</code></div>
          )}
          {(snapshot.promptMessages != null || snapshot.promptChars != null) && (
            <div className={styles.reqRow}>
              <span>{t('transcript.reqPrompt')}</span>
              <code>
                {t('transcript.reqPromptMessages', { n: snapshot.promptMessages ?? '—' })}
                {snapshot.promptChars != null ? ` · ${t('transcript.reqPromptChars', { n: formatNumber(snapshot.promptChars, language) })}` : ''}
                {snapshot.partialOutputChars ? ` · ${t('transcript.reqPromptStreamed', { n: snapshot.partialOutputChars })}` : ''}
              </code>
            </div>
          )}
          <div className={styles.reqRow}><span>{t('transcript.reqParams')}</span><code>{JSON.stringify(snapshot.params)}</code></div>
          {snapshot.error && <div className={styles.reqRow}><span>{t('transcript.reqError')}</span><code>{snapshot.error}</code></div>}
          <details>
            <summary>{t('transcript.promptMessagesDetails', { n: snapshot.messages.length })}</summary>
            <pre className={styles.reqPre}>
              {snapshot.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}
            </pre>
          </details>
          {snapshot.rawExcerpt && (
            <details>
              <summary>{t('transcript.rawResponseExcerpt')}</summary>
              <pre className={styles.reqPre}>{snapshot.rawExcerpt}</pre>
            </details>
          )}
          <p className={styles.reqNote}>{t('transcript.authExcluded')}</p>
        </div>
      )}
    </div>
  );
});
