import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationRun, TranscriptMessage } from '../../domain/schema';
import { dirForLanguage } from '../../domain/language';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import { useDomainStore } from '../../store/domainStore';
import { useUiStore } from '../../store/uiStore';
import { formatTime } from '../../i18n/format';
import { agentColor } from '../../graph/colors';
import { MessageMarkdown } from '../transcript/MessageMarkdown';
import styles from './RunTranscriptView.module.css';

interface RunTranscriptViewProps {
  run: ConversationRun;
  /** When set, messages at or after this index are marked as added in this version. */
  highlightFromIndex?: number;
  compact?: boolean;
}

/**
 * Read-only transcript for a stored conversation run snapshot.
 */
export function RunTranscriptView({ run, highlightFromIndex, compact }: RunTranscriptViewProps) {
  const { t } = useTranslation();
  const agents = useDomainStore((s) => s.playground?.agents ?? []);

  const colorFor = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a.colorCategory]));
    return (msg: TranscriptMessage) => agentColor(msg.agentId ? byId.get(msg.agentId) : null);
  }, [agents]);

  const startIdx = highlightFromIndex ?? run.messageCountAtStart;

  if (run.transcript.length === 0) {
    return <p className="muted">{t('runs.noMessages')}</p>;
  }

  return (
    <ol className={`${styles.list} ${compact ? styles.compact : ''}`}>
      {run.transcript.map((msg, i) => (
        <RunMessageItem
          key={msg.id}
          msg={msg}
          color={colorFor(msg)}
          isNewThisVersion={i >= startIdx}
        />
      ))}
    </ol>
  );
}

function RunMessageItem({
  msg,
  color,
  isNewThisVersion,
}: {
  msg: TranscriptMessage;
  color: string;
  isNewThisVersion: boolean;
}) {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const time = formatTime(msg.timestamp, language);
  const failed = msg.status === 'failed';
  const dir = dirForLanguage(msg.language);
  const split = extractInlineThinking(msg.content);
  const visibleContent = split.text;

  return (
    <li className={`${styles.item} ${failed ? styles.failed : ''} ${isNewThisVersion ? styles.newVersion : ''}`}>
      <span className={styles.node} style={{ backgroundColor: color }} aria-hidden="true" />
      <div className={styles.card} dir={dir}>
        <div className={styles.header}>
          <span className={styles.agent}>{msg.agentName}</span>
          {isNewThisVersion && <span className={styles.versionBadge}>{t('runs.thisRun')}</span>}
          {msg.role && <span className="chip">{msg.role}</span>}
          <span className={styles.meta}>
            {msg.model || '—'} · {time}
          </span>
        </div>
        <div className={styles.body}>
          {failed ? (
            <span className={styles.err}>{t('runs.failedMessage', { error: msg.error })}</span>
          ) : (
            <MessageMarkdown content={visibleContent} />
          )}
        </div>
      </div>
    </li>
  );
}
