import { type CSSProperties } from 'react';
import styles from './Transcript.module.css';

/**
 * The in-flight response for the agent currently generating (spec §13 — live
 * streaming). Rendered as plain text with a blinking caret: partial Markdown is
 * often mid-token, so we don't parse it until the message finalizes into a real
 * transcript entry. Provider text is inserted as a text node, never as HTML.
 */
export function LiveMessage({
  agentName,
  role,
  text,
  color,
}: {
  agentName: string;
  role: string | null;
  text: string;
  color?: string;
}) {
  const style = color ? ({ '--agent-color': color } as CSSProperties) : undefined;
  const thinking = text.length === 0;
  return (
    <div className={`${styles.message} ${styles.live}`} style={style} aria-live="polite">
      <div className={styles.msgHeader}>
        <span className={styles.dot} style={{ backgroundColor: color }} aria-hidden="true" />
        <span className={styles.msgAgent}>{agentName}</span>
        {role && <span className="chip">{role}</span>}
        <span className={styles.liveBadge}>{thinking ? 'thinking…' : 'streaming…'}</span>
      </div>
      <div className={`${styles.msgBody} ${styles.liveBody}`}>
        {text}
        <span className={styles.caret} aria-hidden="true" />
      </div>
    </div>
  );
}
