import { useEffect } from 'react';
import { useDomainStore } from './store/domainStore';
import { useProviderStore } from './store/providerStore';
import { useUiStore } from './store/uiStore';
import { getSelectedPlaygroundId } from './store/prefs';
import { Toolbar } from './ui/Toolbar';
import { Palette } from './ui/Palette';
import { Inspector } from './ui/Inspector';
import { BottomPanel } from './ui/BottomPanel';
import { GraphCanvas } from './graph/GraphCanvas';
import { ProviderManager } from './ui/ProviderManager';
import { SkillLibraryManager } from './ui/SkillLibraryManager';
import { RunDialog } from './ui/RunDialog';
import { PlaygroundsPanel } from './ui/PlaygroundsPanel';
import { TimelinePage } from './ui/timeline/TimelinePage';
import { AgentLibraryPanel } from './ui/AgentLibraryPanel';
import { useAgentLibraryStore } from './store/agentLibraryStore';
import { Toast } from './ui/Toast';
import styles from './App.module.css';

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const openPanel = useUiStore((s) => s.openPanel);
  const playground = useDomainStore((s) => s.playground);
  const hydrate = useDomainStore((s) => s.hydrate);
  const hydrateProviders = useProviderStore((s) => s.hydrate);
  const loadPlayground = useDomainStore((s) => s.loadPlayground);
  const newPlayground = useDomainStore((s) => s.newPlayground);
  const hydrateLibrary = useAgentLibraryStore((s) => s.hydrate);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // On boot: load the last-selected playground, else create a starter one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Providers are application-global; load the registry before any playground
      // so agent/provider references resolve on first paint.
      await Promise.all([hydrate(), hydrateProviders()]);
      // Load the cross-playground agent library alongside playgrounds.
      void hydrateLibrary();
      if (cancelled) return;
      const selected = getSelectedPlaygroundId();
      if (selected) {
        await loadPlayground(selected);
        // If the id no longer resolves, fall through to a fresh one.
        if (!useDomainStore.getState().playground) newPlayground('My Playground');
      } else {
        newPlayground('My Playground');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.app}>
      <Toolbar />
      <div className={styles.body}>
        <Palette />
        <main className={styles.center} aria-label="Graph canvas">
          {playground ? <GraphCanvas /> : <div className={styles.loading}>Loading…</div>}
        </main>
        <Inspector />
      </div>
      <BottomPanel />

      {openPanel === 'providers' && <ProviderManager />}
      {openPanel === 'skills' && <SkillLibraryManager />}
      {openPanel === 'run' && <RunDialog />}
      {openPanel === 'playgrounds' && <PlaygroundsPanel />}
      {openPanel === 'timeline' && <TimelinePage />}
      {openPanel === 'library' && <AgentLibraryPanel />}
      <Toast />
    </div>
  );
}
