import { useEffect } from 'react';
import { useDomainStore } from './store/domainStore';
import { useUiStore } from './store/uiStore';
import { getSelectedPlaygroundId } from './store/prefs';
import { Toolbar } from './ui/Toolbar';
import { Palette } from './ui/Palette';
import { Inspector } from './ui/Inspector';
import { BottomPanel } from './ui/BottomPanel';
import { GraphCanvas } from './graph/GraphCanvas';
import { ProviderManager } from './ui/ProviderManager';
import { RunDialog } from './ui/RunDialog';
import { PlaygroundsPanel } from './ui/PlaygroundsPanel';
import { Toast } from './ui/Toast';
import styles from './App.module.css';

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const openPanel = useUiStore((s) => s.openPanel);
  const playground = useDomainStore((s) => s.playground);
  const hydrate = useDomainStore((s) => s.hydrate);
  const loadPlayground = useDomainStore((s) => s.loadPlayground);
  const newPlayground = useDomainStore((s) => s.newPlayground);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // On boot: load the last-selected playground, else create a starter one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrate();
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
      {openPanel === 'run' && <RunDialog />}
      {openPanel === 'playgrounds' && <PlaygroundsPanel />}
      <Toast />
    </div>
  );
}
