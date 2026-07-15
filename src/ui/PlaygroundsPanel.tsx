import { useMemo } from 'react';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import {
  PLAYGROUND_SAMPLES,
  SAMPLE_DOMAIN_ORDER,
  getPlaygroundSample,
  type SampleDomain,
} from '../domain/samples';
import { Modal } from './Modal';
import styles from './PlaygroundsPanel.module.css';

export function PlaygroundsPanel() {
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
        title: 'Load sample playground',
        message: `Load "${sample.name}"? Your current playground will be replaced.`,
        confirmLabel: 'Load sample',
      });
      if (!ok) return;
    }

    if (loadPlaygroundSample(id)) setPanel('none');
  }

  return (
    <Modal title="Playgrounds" onClose={() => setPanel('none')} width={560}>
      <section className={styles.section} aria-labelledby="sample-playgrounds-heading">
        <h3 id="sample-playgrounds-heading" className={styles.sectionTitle}>
          Sample playgrounds
        </h3>
        <p className={styles.sectionHint}>
          Pre-built graphs that show how multi-agent conversations work. Confirm Local
          (Ollama) under Providers, then press Run.
        </p>
        {samplesByDomain.map(({ domain, samples }) => (
          <div key={domain} className={styles.domainGroup}>
            <h4 className={styles.domainLabel}>{domain}</h4>
            <ul className={styles.sampleList}>
              {samples.map((sample) => (
                <li key={sample.id}>
                  <button
                    type="button"
                    className={styles.sampleCard}
                    onClick={() => loadSample(sample.id)}
                  >
                    <span className={styles.sampleName}>{sample.name}</span>
                    <span className={styles.sampleDesc}>{sample.description}</span>
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
            Your playgrounds
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
              + New playground
            </button>
            {current && (
              <button type="button" onClick={() => duplicatePlayground()}>
                Duplicate current
              </button>
            )}
          </div>
        </div>

        {index.length === 0 ? (
          <p className="muted">No saved playgrounds yet.</p>
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
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.date}>{new Date(p.updatedAt).toLocaleString()}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.deleteBtn} danger`}
                  aria-label={`Delete ${p.name}`}
                  onClick={async () => {
                    const ok = await requestConfirm({
                      title: 'Delete playground',
                      message: `Delete playground "${p.name}"? This cannot be undone.`,
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (ok) void deletePlayground(p.id);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
