import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatIcon, AgentsIcon, MenuIcon } from './icons';
import styles from './MobileApp.module.css';

export type MobileTab = 'chat' | 'agents' | 'more';

const TABS: { key: MobileTab; labelKey: string; Icon: typeof ChatIcon }[] = [
  { key: 'chat', labelKey: 'mobile.tabChat', Icon: ChatIcon },
  { key: 'agents', labelKey: 'mobile.tabAgents', Icon: AgentsIcon },
  { key: 'more', labelKey: 'mobile.tabMore', Icon: MenuIcon },
];

/** Thumb-reachable bottom navigation. WAI-ARIA tablist with arrow-key roving focus. */
export function MobileTabBar({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  const { t } = useTranslation();

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === active);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : (i - 1 + TABS.length) % TABS.length;
    onChange(TABS[next].key);
    document.getElementById(`mtab-${TABS[next].key}`)?.focus();
  }

  return (
    <nav className={styles.tabBar} role="tablist" aria-label={t('mobile.sections')}>
      {TABS.map(({ key, labelKey, Icon }) => {
        const selected = active === key;
        return (
          <button
            key={key}
            id={`mtab-${key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`mpanel-${key}`}
            tabIndex={selected ? 0 : -1}
            className={`${styles.tab} ${selected ? styles.tabActive : ''}`}
            onClick={() => onChange(key)}
            onKeyDown={onKeyDown}
          >
            <Icon className={styles.tabIcon} />
            <span className={styles.tabLabel}>{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
