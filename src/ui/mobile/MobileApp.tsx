import { useState } from 'react';
import { useDomainStore } from '../../store/domainStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { MobileChat } from './MobileChat';
import { MobileAgents } from './MobileAgents';
import { MobileMenu } from './MobileMenu';
import styles from './MobileApp.module.css';

const RUN_STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running…',
  stopped: 'Stopped',
  completed: 'Completed',
  error: 'Error',
  interrupted: 'Interrupted',
};

/**
 * Touch-first shell shown below the mobile breakpoint (see useIsMobile). A compact
 * app bar + a Chat/Agents/More content area + a thumb-reachable bottom tab bar. It
 * composes existing components (transcript, inspectors, run flow) rather than
 * reimplementing them; the desktop three-column editor is never mounted here.
 */
export function MobileApp() {
  const [tab, setTab] = useState<MobileTab>('chat');
  const playgroundName = useDomainStore((s) => s.playground?.name);
  const status = useRuntimeStore((s) => s.status);
  const currentTurn = useRuntimeStore((s) => s.currentTurn);

  return (
    <div className={styles.shell}>
      <header className={styles.appBar}>
        <span className={styles.title}>{playgroundName ?? 'Playground'}</span>
        <span className={`${styles.statusPill} ${styles[`status_${status}`] ?? ''}`}>
          {RUN_STATUS_LABEL[status]}
          {status === 'running' ? ` · turn ${currentTurn}` : ''}
        </span>
      </header>

      <main
        id={`mpanel-${tab}`}
        role="tabpanel"
        aria-labelledby={`mtab-${tab}`}
        className={styles.content}
      >
        {tab === 'chat' && <MobileChat />}
        {tab === 'agents' && <MobileAgents />}
        {tab === 'more' && <MobileMenu />}
      </main>

      <MobileTabBar active={tab} onChange={setTab} />
    </div>
  );
}
