import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useUiStore } from '../../store/uiStore';
import { agentColor } from '../../graph/colors';
import { stopRun, continueRun } from '../../orchestrator/orchestrator';
import { hasBlockingErrors, validateForRun } from '../../orchestrator/validate';
import { addressableAgents, parseMention } from '../addressing';
import { Message } from '../transcript/Message';
import { LiveMessage } from '../transcript/LiveMessage';
import { RunIcon, StopIcon, SendIcon } from './icons';
import styles from './MobileApp.module.css';

/** The conversation surface: transcript + streaming bubble + a touch composer. */
export function MobileChat() {
  const playground = useDomainStore((s) => s.playground);
  const setPanel = useUiStore((s) => s.setPanel);
  const providers = useProviderStore((s) => s.providers);

  const status = useRuntimeStore((s) => s.status);
  const activeAgentId = useRuntimeStore((s) => s.activeAgentId);
  const liveText = useRuntimeStore((s) => (s.activeAgentId ? s.streamingText[s.activeAgentId] : undefined));
  const liveReasoning = useRuntimeStore((s) =>
    s.activeAgentId ? s.streamingReasoning[s.activeAgentId] : undefined,
  );

  const isRunning = status === 'running';
  const transcript = playground?.transcript ?? [];

  const [followUp, setFollowUp] = useState('');
  const canContinue =
    !isRunning && transcript.length > 0 && !!playground &&
    !hasBlockingErrors(validateForRun(playground, providers));

  const liveAgent =
    isRunning && activeAgentId
      ? playground?.agents.find((a) => a.id === activeAgentId) ?? null
      : null;

  const colorFor = useMemo(() => {
    const byId = new Map((playground?.agents ?? []).map((a) => [a.id, a.colorCategory]));
    return (agentId: string | null) => agentColor(agentId ? byId.get(agentId) : null);
  }, [playground?.agents]);

  // Auto-scroll to newest only when the reader is already near the bottom, so
  // scrolling up to read history isn't yanked back on every streamed token.
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
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }

  useEffect(() => {
    if (atBottom) scrollToBottom();
  }, [transcript.length, liveText, liveReasoning, atBottom]);

  const showJump = !atBottom && (transcript.length > 0 || !!liveAgent);

  function handleContinue(e: FormEvent) {
    e.preventDefault();
    const text = followUp.trim();
    if (!text || !canContinue) return;
    // Leading "@AgentName" addresses that agent directly (parse-only on mobile).
    const mention = parseMention(text, addressableAgents(playground?.agents ?? []));
    if (mention && mention.message) {
      continueRun(mention.message, { targetAgentId: mention.target.id });
    } else {
      continueRun(text);
    }
    setFollowUp('');
  }

  return (
    <div className={styles.chat}>
      <div className={styles.chatScroll} ref={contentRef} onScroll={handleScroll}>
        {transcript.length === 0 && !liveAgent ? (
          <div className={styles.chatEmpty}>
            <p className={styles.chatEmptyTitle}>No conversation yet</p>
            <p className={styles.chatEmptyText}>
              Configure your agents, then press Run to start a conversation.
            </p>
          </div>
        ) : (
          <>
            {transcript.map((msg) => (
              <Message key={msg.id} msg={msg} color={colorFor(msg.agentId)} />
            ))}
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
        )}
      </div>

      {showJump && (
        <button
          type="button"
          className={`${styles.jumpBtn} primary`}
          onClick={() => { scrollToBottom('smooth'); setAtBottom(true); }}
        >
          ↓ Jump to latest
        </button>
      )}

      <div className={styles.composer}>
        {isRunning ? (
          <button type="button" className={`${styles.composerFull} danger`} onClick={() => stopRun()}>
            <StopIcon className={styles.btnIcon} /> Stop
          </button>
        ) : transcript.length === 0 ? (
          <button
            type="button"
            className={`${styles.composerFull} primary`}
            onClick={() => setPanel('run')}
            disabled={!playground}
          >
            <RunIcon className={styles.btnIcon} /> Run conversation
          </button>
        ) : (
          <form className={styles.composerForm} onSubmit={handleContinue}>
            <input
              type="text"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Continue the conversation…"
              aria-label="Message to continue the conversation"
            />
            <button
              type="submit"
              className={`${styles.sendBtn} primary icon`}
              aria-label="Send"
              disabled={!canContinue || !followUp.trim()}
            >
              <SendIcon className={styles.btnIcon} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
