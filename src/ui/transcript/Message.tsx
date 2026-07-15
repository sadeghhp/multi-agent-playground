import { type CSSProperties, useState } from 'react';
import type { TranscriptMessage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { MessageMarkdown } from './MessageMarkdown';
import { formatDuration } from '../formatDuration';
import styles from './Transcript.module.css';

/**
 * One transcript message (spec §13.1). Model output is rendered as sanitized
 * Markdown — rehype-sanitize strips any HTML/script so provider output can never
 * inject markup (spec §21).
 */
export function Message({ msg, color }: { msg: TranscriptMessage; color?: string }) {
  const [expanded, setExpanded] = useState(true);
  const [showRequest, setShowRequest] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const showToast = useUiStore((s) => s.showToast);
  const snapshot = useRuntimeStore((s) => s.requestSnapshots[msg.id]);

  // Safety net for older turns that stored inline think tags in `content`
  // before extraction handled Qwen's closer-only form.
  const split = extractInlineThinking(msg.content);
  const visibleContent = split.text;
  const reasoning = [msg.reasoning, split.reasoning].filter(Boolean).join('\n\n') || undefined;

  const time = new Date(msg.timestamp).toLocaleTimeString();
  // Mirror the whole message (header, alignment, body) for RTL languages so
  // Persian output reads naturally right-to-left.
  const dir = dirForLanguage(msg.language);
  const style = color ? ({ '--agent-color': color } as CSSProperties) : undefined;

  return (
    <div
      className={`${styles.message} ${msg.status === 'failed' ? styles.failed : ''}`}
      dir={dir}
      style={style}
    >
      <div className={styles.msgHeader}>
        <span className={styles.dot} style={{ backgroundColor: color }} aria-hidden="true" />
        <span className={styles.msgAgent}>
          {msg.agentName}
          {msg.agentDeleted && <span className="chip"> deleted</span>}
        </span>
        {msg.role && <span className="chip">{msg.role}</span>}
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
        <span className={styles.msgMeta}>
          turn {msg.turn} · {msg.model || '—'} · {time}
          {msg.durationMs != null && ` · ${formatDuration(msg.durationMs)}`}
          {msg.totalTokens != null && ` · ${msg.totalTokens} tok`}
        </span>
        <span className={styles.msgActions}>
          {snapshot && (
            <button
              type="button"
              aria-label="Inspect request metadata"
              title="Inspect request"
              aria-pressed={showRequest}
              onClick={() => setShowRequest((v) => !v)}
            >
              ⓘ
            </button>
          )}
          <button
            type="button"
            aria-label="Copy response"
            title="Copy"
            onClick={() => {
              if (!navigator.clipboard) {
                showToast('error', 'Clipboard is not available in this context.');
                return;
              }
              navigator.clipboard.writeText(visibleContent).then(
                () => showToast('info', 'Copied response.'),
                () => showToast('error', 'Could not copy the response.'),
              );
            }}
          >
            ⧉
          </button>
          <button type="button" aria-label={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded((e) => !e)}>
            {expanded ? '−' : '+'}
          </button>
        </span>
      </div>
      {msg.sourceAgentId && msg.connectionType && (
        <div className={styles.msgSource}>
          via {msg.connectionType} connection
        </div>
      )}
      {showReasoning && reasoning && (
        <div className={styles.request} dir="ltr">
          <pre className={styles.reqPre}>{reasoning}</pre>
        </div>
      )}
      {expanded && (
        // No explicit dir here: inherits the deterministic direction from the
        // message container above, driven by the agent's configured language.
        // dir="auto" would instead guess from content, which stays LTR until
        // enough RTL script accumulates — wrong for streaming/short replies.
        <div className={styles.msgBody}>
          {msg.status === 'failed' ? (
            <span className={styles.errText}>Failed: {msg.error}</span>
          ) : visibleContent ? (
            <MessageMarkdown content={visibleContent} />
          ) : reasoning ? (
            <span className={styles.msgSource}>
              No visible answer — the model only produced thinking. Expand “thinking” or raise Max
              output tokens.
            </span>
          ) : null}
        </div>
      )}

      {showRequest && snapshot && (
        <div className={styles.request} dir="ltr">
          <div className={styles.reqRow}><span>URL</span><code>{snapshot.url}</code></div>
          <div className={styles.reqRow}><span>Provider</span><code>{snapshot.providerName}</code></div>
          <div className={styles.reqRow}><span>Model</span><code>{snapshot.model}</code></div>
          <div className={styles.reqRow}>
            <span>Status</span>
            <code>{snapshot.status ?? '—'}{snapshot.finishReason ? ` · ${snapshot.finishReason}` : ''}</code>
          </div>
          <div className={styles.reqRow}><span>Params</span><code>{JSON.stringify(snapshot.params)}</code></div>
          {snapshot.error && <div className={styles.reqRow}><span>Error</span><code>{snapshot.error}</code></div>}
          <details>
            <summary>Prompt messages ({snapshot.messages.length})</summary>
            <pre className={styles.reqPre}>
              {snapshot.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}
            </pre>
          </details>
          {snapshot.rawExcerpt && (
            <details>
              <summary>Raw response (excerpt)</summary>
              <pre className={styles.reqPre}>{snapshot.rawExcerpt}</pre>
            </details>
          )}
          <p className={styles.reqNote}>Auth headers and credentials are excluded.</p>
        </div>
      )}
    </div>
  );
}
