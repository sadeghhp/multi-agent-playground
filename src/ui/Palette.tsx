import { useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { createAgent, createAgentFromTemplate, templateList, type TemplateKey } from '../domain/factories';
import styles from './Palette.module.css';

export function Palette() {
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const addAgent = useDomainStore((s) => s.addAgent);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const setPanel = useUiStore((s) => s.setPanel);
  const isRunning = useRuntimeStore((s) => s.status === 'running');
  const hasEnabledProvider = useProviderStore((s) => s.providers.some((p) => p.enabled));
  const enabledAgentCount = playground?.agents.filter((a) => a.runtime.enabled).length ?? 0;

  // Stagger new nodes so they don't stack exactly on top of each other.
  function nextPosition() {
    const n = playground?.agents.length ?? 0;
    return { x: 80 + (n % 4) * 60, y: 80 + Math.floor(n / 4) * 60 + (n % 4) * 30 };
  }

  function handleAddBlank() {
    const agent = createAgent({ name: 'New Agent', position: nextPosition() });
    addAgent(agent);
    selectAgent(agent.id);
  }

  function handleAddTemplate(key: TemplateKey) {
    const agent = createAgentFromTemplate(key, { position: nextPosition() });
    addAgent(agent);
    selectAgent(agent.id);
  }

  return (
    <aside className={styles.palette} aria-label={t('palette.paletteLabel')}>
      <section className={styles.section}>
        <h3 className={styles.heading}>{t('palette.agentsHeading')}</h3>
        <button type="button" className={`primary ${styles.block}`} onClick={handleAddBlank} disabled={isRunning}>
          {t('palette.addAgent')}
        </button>
        <button
          type="button"
          className={styles.block}
          onClick={() => setPanel('createAgentAi')}
          disabled={isRunning || !hasEnabledProvider}
          title={!hasEnabledProvider ? t('palette.addProviderFirst') : undefined}
        >
          {t('palette.createWithAi')}
        </button>
        <button
          type="button"
          className={styles.block}
          onClick={() => setPanel('smartArrange')}
          disabled={isRunning || !hasEnabledProvider || enabledAgentCount < 2}
          title={
            !hasEnabledProvider
              ? t('palette.addProviderFirst')
              : enabledAgentCount < 2
                ? t('palette.addTwoAgentsFirst')
                : t('palette.smartArrangeHint')
          }
        >
          {t('palette.smartArrange')}
        </button>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>{t('palette.templatesHeading')}</h3>
        <div className={styles.templates}>
          {templateList()
            .filter((tpl) => tpl.key !== 'blank')
            .map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                className={styles.template}
                onClick={() => handleAddTemplate(tpl.key)}
                disabled={isRunning}
              >
                {tpl.label}
              </button>
            ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>{t('palette.manageHeading')}</h3>
        <button type="button" className={styles.block} onClick={() => setPanel('providers')}>
          {t('palette.providerManager')}
        </button>
        <button type="button" className={styles.block} onClick={() => setPanel('playgrounds')}>
          {t('palette.savedPlaygrounds')}
        </button>
        <button type="button" className={styles.block} onClick={() => setPanel('library')}>
          {t('palette.agentLibrary')}
        </button>
      </section>

      <div className={styles.spacer} />
      <p className={styles.warn}>
        {t('palette.credentialsWarning')}
      </p>
    </aside>
  );
}
