import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { formatDateTime } from '../i18n/format';
import {
  PLAYGROUND_SAMPLES,
  SAMPLE_DOMAIN_ORDER,
  getPlaygroundSample,
  type SampleDomain,
} from '../domain/samples';
import { isAppOnLocalhost } from '../providers/url';
import { Modal } from './Modal';
import styles from './PlaygroundsPanel.module.css';

export function PlaygroundsPanel() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const index = useDomainStore((s) => s.index);
  const current = useDomainStore((s) => s.playground);
  const loadPlayground = useDomainStore((s) => s.loadPlayground);
  const deletePlayground = useDomainStore((s) => s.deletePlayground);
  const duplicatePlayground = useDomainStore((s) => s.duplicatePlayground);
  const newPlayground = useDomainStore((s) => s.newPlayground);
  const loadPlaygroundSample = useDomainStore((s) => s.loadPlaygroundSample);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);

  const samplesByDomain = useMemo(() => {
    const map = new Map<SampleDomain, typeof PLAYGROUND_SAMPLES>();
    for (const domain of SAMPLE_DOMAIN_ORDER) map.set(domain, []);
    for (const sample of PLAYGROUND_SAMPLES) {
      map.get(sample.domain)!.push(sample);
    }
    return SAMPLE_DOMAIN_ORDER.filter((d) => (map.get(d)?.length ?? 0) > 0).map((domain) => ({
      domain,
      samples: map.get(domain)!,
    }));
  }, []);

  async function loadSample(id: string) {
    const sample = getPlaygroundSample(id);
    if (!sample) return;

    const hasWork =
      (current?.agents.length ?? 0) > 0 || (current?.transcript.length ?? 0) > 0;
    if (hasWork) {
      const ok = await requestConfirm({
        title: t('playgrounds.loadSampleTitle'),
        message: t('playgrounds.loadSampleMessage', { name: sample.name }),
        confirmLabel: t('playgrounds.loadSampleConfirm'),
      });
      if (!ok) return;
    }

    if (loadPlaygroundSample(id)) setPanel('none');
  }

  return (
    <Modal title={t('playgrounds.title')} onClose={() => setPanel('none')} width={560}>
      <section className={styles.section} aria-labelledby="sample-playgrounds-heading">
        <h3 id="sample-playgrounds-heading" className={styles.sectionTitle}>
          {t('playgrounds.samplePlaygrounds')}
        </h3>
        <p className={styles.sectionHint}>
          {t('playgrounds.sampleHint')}
          {!isAppOnLocalhost(window.location.origin) && (
            <>
              {' '}
              <Trans i18nKey="playgrounds.sampleHintRemote">
                Samples default to Ollama on localhost — run the app with <code>npm run dev</code>, or switch agents to a public HTTPS provider.
              </Trans>
            </>
          )}
        </p>
        {samplesByDomain.map(({ domain, samples }) => (
          <div key={domain} className={styles.domainGroup}>
            <h4 className={styles.domainLabel} dir="auto">{domain}</h4>
            <ul className={styles.sampleList}>
              {samples.map((sample) => (
                <li key={sample.id}>
                  <button
                    type="button"
                    className={styles.sampleCard}
                    onClick={() => loadSample(sample.id)}
                  >
                    <span className={styles.sampleName} dir="auto">{sample.name}</span>
                    <span className={styles.sampleDesc} dir="auto">{sample.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <hr className={styles.divider} />

      <section className={styles.section} aria-labelledby="your-playgrounds-heading">
        <div className={styles.yourHeader}>
          <h3 id="your-playgrounds-heading" className={styles.sectionTitle}>
            {t('playgrounds.yourPlaygrounds')}
          </h3>
          <div className={styles.actions}>
            <button
              type="button"
              className="primary"
              onClick={() => {
                newPlayground('Untitled Playground');
                setPanel('none');
              }}
            >
              {t('playgrounds.newPlayground')}
            </button>
            {current && (
              <button type="button" onClick={() => duplicatePlayground()}>
                {t('playgrounds.duplicateCurrent')}
              </button>
            )}
          </div>
        </div>

        {index.length === 0 ? (
          <p className="muted">{t('playgrounds.noSaved')}</p>
        ) : (
          <ul className={styles.list}>
            {index.map((p) => (
              <li
                key={p.id}
                className={`${styles.item} ${p.id === current?.id ? styles.active : ''}`}
              >
                <button
                  type="button"
                  className={styles.open}
                  onClick={() => {
                    void loadPlayground(p.id);
                    setPanel('none');
                  }}
                >
                  <span className={styles.name} dir="auto">{p.name}</span>
                  <span className={styles.date}>{formatDateTime(p.updatedAt, language)}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.deleteBtn} danger`}
                  aria-label={t('playgrounds.deleteAria', { name: p.name })}
                  onClick={async () => {
                    const ok = await requestConfirm({
                      title: t('playgrounds.deleteTitle'),
                      message: t('playgrounds.deleteMessage', { name: p.name }),
                      confirmLabel: t('common.delete'),
                      danger: true,
                    });
                    if (ok) void deletePlayground(p.id);
                  }}
                >
                  {t('common.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
