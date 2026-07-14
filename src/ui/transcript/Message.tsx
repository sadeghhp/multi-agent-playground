import { type CSSProperties, useState } from 'react';
import type { TranscriptMessage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { useUiStore } from '../../store/uiStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { MessageMarkdown } from './MessageMarkdown';
import styles from './Transcript.module.css';

/**
 * One transcript message (spec §13.1). Model output is rendered as sanitized
 * Markdown — rehype-sanitize strips any HTML/script so provider output can never
 * inject markup (spec §21).
 */
export function Message({ msg, color }: { msg: TranscriptMessage; color?: string }) {
  const [expanded, setExpanded] = useState(true);
  const [showRequest, setShowRequest] = useState(false);
  const showToast = useUiStore((s) => s.showToast);
  const snapshot = useRuntimeStore((s) => s.requestSnapshots[msg.id]);

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
        <span className={styles.msgMeta}>
          turn {msg.turn} · {msg.model || '—'} · {time}
          {msg.durationMs != null &&
            ` · ${msg.durationMs < 1000 ? `${msg.durationMs}ms` : `${(msg.durationMs / 1000).toFixed(1)}s`}`}
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
              void navigator.clipboard?.writeText(msg.content);
              showToast('info', 'Copied response.');
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
      {expanded && (
        <div className={styles.msgBody} dir="auto">
          {msg.status === 'failed' ? (
            <span className={styles.errText}>Failed: {msg.error}</span>
          ) : (
            <MessageMarkdown content={msg.content} />
          )}
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
