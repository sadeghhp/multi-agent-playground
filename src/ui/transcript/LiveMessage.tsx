import type { AgentLanguage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import styles from './Transcript.module.css';

/**
 * The in-flight response for the agent currently generating (spec §13 — live
 * streaming). Rendered as plain text with a blinking caret: partial Markdown is
 * often mid-token, so we don't parse it until the message finalizes into a real
 * transcript entry. Provider text is inserted as a text node, never as HTML.
 *
 * The agent's language drives the writing direction so RTL languages (Persian)
 * stream right-to-left, matching how the finalized message will render.
 */
export function LiveMessage({
  agentName,
  role,
  text,
  language,
}: {
  agentName: string;
  role: string | null;
  text: string;
  language: AgentLanguage;
}) {
  const dir = dirForLanguage(language);
  return (
    <div className={`${styles.message} ${styles.live}`} dir={dir}>
      <div className={styles.msgHeader}>
        <span className={styles.msgAgent}>{agentName}</span>
        {role && <span className="chip">{role}</span>}
        <span className={styles.liveBadge}>streaming…</span>
      </div>
      {/* No explicit dir: inherits the forced direction above. dir="auto"
          would guess from the streamed text so far, which stays LTR until
          enough RTL script has arrived — the opposite of what we want while
          a Persian agent is still typing its first few characters. */}
      <div className={`${styles.msgBody} ${styles.liveBody}`}>
        {text}
        <span className={styles.caret} aria-hidden="true" />
      </div>
    </div>
  );
}
