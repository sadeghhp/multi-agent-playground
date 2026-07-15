import { type CSSProperties, useState } from 'react';
import type { AgentLanguage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import styles from './Transcript.module.css';

/**
 * The in-flight response for the agent currently generating (spec §13 — live
 * streaming). Rendered as plain text with a blinking caret: partial Markdown is
 * often mid-token, so we don't parse it until the message finalizes into a real
 * transcript entry. Provider text is inserted as a text node, never as HTML.
 *
 * Reasoning tokens (API `reasoning_content` / inline `<think>` tags) stay behind
 * a collapsed "thinking" chip — never in the answer body. Until visible answer
 * tokens arrive the badge stays on "thinking…", then switches to "streaming…".
 */
export function LiveMessage({
  agentName,
  role,
  text,
  reasoning: reasoningProp = '',
  color,
  language,
}: {
  agentName: string;
  role: string | null;
  text: string;
  /** Live reasoning buffer from `reasoning_content` / `reasoning` deltas. */
  reasoning?: string;
  color?: string;
  language: AgentLanguage;
}) {
  const style = color ? ({ '--agent-color': color } as CSSProperties) : undefined;
  const [showReasoning, setShowReasoning] = useState(false);
  const split = extractInlineThinking(text);
  const visible = split.text;
  const reasoning =
    [reasoningProp, split.reasoning].filter((s) => s && s.length > 0).join('\n\n') || undefined;
  const thinking = visible.length === 0;
  const dir = dirForLanguage(language);
  return (
    <div className={`${styles.message} ${styles.live}`} style={style} dir={dir} aria-live="polite">
      <div className={styles.msgHeader}>
        <span className={styles.dot} style={{ backgroundColor: color }} aria-hidden="true" />
        <span className={styles.msgAgent}>{agentName}</span>
        {role && <span className="chip">{role}</span>}
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
        <div className={styles.request} dir="ltr">
          <pre className={styles.reqPre}>{reasoning}</pre>
        </div>
      )}
      {/* No explicit dir: inherits the forced direction above. dir="auto"
          would guess from the streamed text so far, which stays LTR until
          enough RTL script has arrived — the opposite of what we want while
          a Persian agent is still typing its first few characters. */}
      <div className={`${styles.msgBody} ${styles.liveBody}`}>
        {visible}
        <span className={styles.caret} aria-hidden="true" />
      </div>
    </div>
  );
}
