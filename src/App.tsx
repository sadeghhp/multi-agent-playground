import { useEffect } from 'react';
import { useDomainStore } from './store/domainStore';
import { useProviderStore } from './store/providerStore';
import { useUiStore } from './store/uiStore';
import { getSelectedPlaygroundId } from './store/prefs';
import { Toolbar } from './ui/Toolbar';
import { Palette } from './ui/Palette';
import { Inspector } from './ui/Inspector';
import { BottomPanel } from './ui/BottomPanel';
import { AppFooter } from './ui/AppFooter';
import { GraphCanvas } from './graph/GraphCanvas';
import { ProviderManager } from './ui/ProviderManager';
import { SkillLibraryManager } from './ui/SkillLibraryManager';
import { RunDialog } from './ui/RunDialog';
import { PlaygroundsPanel } from './ui/PlaygroundsPanel';
import { TimelinePage } from './ui/timeline/TimelinePage';
import { ConversationRunsPanel } from './ui/runs/ConversationRunsPanel';
import { AgentLibraryPanel } from './ui/AgentLibraryPanel';
import { useAgentLibraryStore } from './store/agentLibraryStore';
import { useRunPresetStore } from './store/runPresetStore';
import { CreateAgentWithAiModal } from './ui/CreateAgentWithAiModal';
import { SmartArrangeModal } from './ui/SmartArrangeModal';
import { Toast } from './ui/Toast';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { FallbackSuggestModal } from './ui/FallbackSuggestModal';
import { FailureDecisionModal } from './ui/FailureDecisionModal';
import { UsagePanel } from './ui/UsagePanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { useUsageStore } from './store/usageStore';
import { useLlmSettingsStore } from './store/llmSettingsStore';
import { setRecordDropListener } from './persistence/db';
import { useIsMobile } from './ui/useIsMobile';
import { MobileApp } from './ui/mobile/MobileApp';
import styles from './App.module.css';

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const openPanel = useUiStore((s) => s.openPanel);
  const isMobile = useIsMobile();
  const playground = useDomainStore((s) => s.playground);
  const hydrate = useDomainStore((s) => s.hydrate);
  const hydrateProviders = useProviderStore((s) => s.hydrate);
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const hydrateLlmSettings = useLlmSettingsStore((s) => s.hydrate);
  const loadPlayground = useDomainStore((s) => s.loadPlayground);
  const newPlayground = useDomainStore((s) => s.newPlayground);
  const hydrateLibrary = useAgentLibraryStore((s) => s.hydrate);
  const hydrateRunPresets = useRunPresetStore((s) => s.hydrate);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Surface dropped (corrupt/unreadable) stored records to the user, once, so a
  // silently skipped playground/run isn't visible only in the console.
  useEffect(() => {
    let warned = false;
    setRecordDropListener((detail) => {
      if (warned) return;
      warned = true;
      useUiStore.getState().showToast('warn', `${detail} See the console for details.`);
    });
    return () => setRecordDropListener(null);
  }, []);

  // On boot: load the last-selected playground, else create a starter one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Providers are application-global; load the registry before any playground
      // so agent/provider references resolve on first paint.
      await Promise.all([hydrate(), hydrateProviders(), hydrateUsage()]);
      hydrateLlmSettings();
      // Load the cross-playground agent library and run presets alongside playgrounds.
      void hydrateLibrary();
      void hydrateRunPresets();
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
      {/* Below the mobile breakpoint we swap the desktop three-column editor for a
          purpose-built touch shell. The openPanel modals and global overlays below
          are shared by both layouts (they already render full-screen). */}
      {isMobile ? (
        <MobileApp />
      ) : (
        <>
          <a href="#main" className="skip-link">Skip to canvas</a>
          <Toolbar />
          <div className={styles.body}>
            <Palette />
            <main id="main" tabIndex={-1} className={styles.center} aria-label="Graph canvas">
              {playground ? <GraphCanvas /> : <div className={styles.loading}>Loading…</div>}
            </main>
            <Inspector />
          </div>
          <BottomPanel />
        </>
      )}
      <AppFooter />

      {openPanel === 'providers' && <ProviderManager />}
      {openPanel === 'skills' && <SkillLibraryManager />}
      {openPanel === 'run' && <RunDialog />}
      {openPanel === 'playgrounds' && <PlaygroundsPanel />}
      {openPanel === 'timeline' && <TimelinePage />}
      {openPanel === 'runHistory' && <ConversationRunsPanel />}
      {openPanel === 'library' && <AgentLibraryPanel />}
      {openPanel === 'createAgentAi' && <CreateAgentWithAiModal />}
      {openPanel === 'smartArrange' && <SmartArrangeModal />}
      {openPanel === 'usage' && <UsagePanel />}
      {openPanel === 'settings' && <SettingsPanel />}
      <Toast />
      <ConfirmDialog />
      <FallbackSuggestModal />
      <FailureDecisionModal />
    </div>
  );
}
