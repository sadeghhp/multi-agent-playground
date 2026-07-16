import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../store/providerStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { useUiStore } from '../store/uiStore';
import { useUsageStore } from '../store/usageStore';
import { formatUsd } from '../usage/pricing';
import { startOfLocalDay } from '../usage/budget';
import { formatNumber } from '../i18n/format';
import { Modal } from './Modal';
import styles from './UsagePanel.module.css';

type Scope = 'run' | 'today' | 'all';

export function UsagePanel() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);
  const entries = useUsageStore((s) => s.entries);
  const prices = useUsageStore((s) => s.prices);
  const budget = useUsageStore((s) => s.budget);
  const setBudget = useUsageStore((s) => s.setBudget);
  const upsertPrice = useUsageStore((s) => s.upsertPrice);
  const removePrice = useUsageStore((s) => s.removePrice);
  const clearAll = useUsageStore((s) => s.clearAll);
  const clearToday = useUsageStore((s) => s.clearToday);
  const providers = useProviderStore((s) => s.providers);
  const runId = useRuntimeStore((s) => s.runId);
  const runTokens = useRuntimeStore((s) => s.runTokens);

  const [scope, setScope] = useState<Scope>('today');
  const [priceProviderId, setPriceProviderId] = useState(providers[0]?.id ?? '');
  const [priceModel, setPriceModel] = useState('');
  const [inputPer1M, setInputPer1M] = useState('0');
  const [outputPer1M, setOutputPer1M] = useState('0');

  const filtered = useMemo(() => {
    const dayStart = startOfLocalDay();
    return entries.filter((e) => {
      if (scope === 'all') return true;
      if (scope === 'today') return e.at >= dayStart;
      return runId != null && e.runId === runId;
    });
  }, [entries, scope, runId]);

  const totals = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    const byKey = new Map<string, { tokens: number; cost: number; providerName: string; model: string }>();
    for (const e of filtered) {
      tokens += e.totalTokens;
      cost += e.estimatedCost;
      const key = `${e.providerId}::${e.model}`;
      const row = byKey.get(key) ?? {
        tokens: 0,
        cost: 0,
        providerName: e.providerName,
        model: e.model,
      };
      row.tokens += e.totalTokens;
      row.cost += e.estimatedCost;
      byKey.set(key, row);
    }
    return {
      tokens,
      cost,
      rows: [...byKey.values()].sort((a, b) => b.tokens - a.tokens),
    };
  }, [filtered]);

  async function handleClearToday() {
    const ok = await requestConfirm({
      title: t('usage.clearTodayTitle'),
      message: t('usage.clearTodayMessage'),
      confirmLabel: t('usage.clearToday'),
      danger: true,
    });
    if (ok) await clearToday();
  }

  async function handleClearAll() {
    const ok = await requestConfirm({
      title: t('usage.clearAllTitle'),
      message: t('usage.clearAllMessage'),
      confirmLabel: t('usage.clearAll'),
      danger: true,
    });
    if (ok) await clearAll();
  }

  function handleAddPrice() {
    const model = priceModel.trim();
    if (!priceProviderId || !model) return;
    upsertPrice({
      providerId: priceProviderId,
      model,
      inputPer1M: Number(inputPer1M) || 0,
      outputPer1M: Number(outputPer1M) || 0,
    });
    setPriceModel('');
  }

  return (
    <Modal title={t('usage.title')} onClose={() => setPanel('none')} width={720}>
      <section className={styles.section}>
        <h3 className={styles.h3}>{t('usage.tokenBudgetsTitle')}</h3>
        <p className="muted">
          {t('usage.budgetHelp', { tokens: formatNumber(runTokens, language) })}
        </p>
        <div className={styles.budgetGrid}>
          <label>
            {t('usage.maxTokensPerRun')}
            <input
              type="number"
              min={1}
              value={budget.maxTokensPerRun}
              onChange={(e) =>
                setBudget({ ...budget, maxTokensPerRun: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label>
            {t('usage.maxTokensPerDay')}
            <input
              type="number"
              min={1}
              value={budget.maxTokensPerDay}
              onChange={(e) =>
                setBudget({ ...budget, maxTokensPerDay: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label>
            {t('usage.maxFallbackTokensPerRun')}
            <input
              type="number"
              min={1}
              value={budget.maxFallbackTokensPerRun}
              onChange={(e) =>
                setBudget({
                  ...budget,
                  maxFallbackTokensPerRun: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.scopeRow}>
          <h3 className={styles.h3}>{t('usage.usageTitle')}</h3>
          <div className={styles.scopeBtns} role="group" aria-label={t('usage.scopeAria')}>
            {(['run', 'today', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                className={scope === s ? 'primary' : 'secondary'}
                onClick={() => setScope(s)}
              >
                {s === 'run' ? t('usage.scopeRun') : s === 'today' ? t('usage.scopeToday') : t('usage.scopeAll')}
              </button>
            ))}
          </div>
        </div>
        <p>
          <strong>{formatNumber(totals.tokens, language)}</strong> {t('usage.tokensUnit')} · {t('usage.estPrefix')}{' '}
          <strong>{formatUsd(totals.cost)}</strong>
          {filtered.some((e) => e.estimated) && (
            <span className="muted"> {t('usage.someEstimated')}</span>
          )}
        </p>
        {totals.rows.length === 0 ? (
          <p className="muted">{t('usage.noUsageForScope')}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage.colProvider')}</th>
                <th>{t('usage.colModel')}</th>
                <th>{t('usage.colTokens')}</th>
                <th>{t('usage.colEstDollar')}</th>
              </tr>
            </thead>
            <tbody>
              {totals.rows.map((row) => (
                <tr key={`${row.providerName}-${row.model}`}>
                  <td dir="auto">{row.providerName}</td>
                  <td dir="auto">{row.model}</td>
                  <td>{formatNumber(row.tokens, language)}</td>
                  <td>{formatUsd(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={styles.actions}>
          <button type="button" className="secondary" onClick={() => void handleClearToday()}>
            {t('usage.clearToday')}
          </button>
          <button type="button" className="danger" onClick={() => void handleClearAll()}>
            {t('usage.clearAll')}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.h3}>{t('usage.pricesTitle')}</h3>
        <p className="muted">{t('usage.pricesHelp')}</p>
        {prices.length === 0 ? (
          <p className="muted">{t('usage.noPrices')}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage.colProvider')}</th>
                <th>{t('usage.colModel')}</th>
                <th>{t('usage.colInput')}</th>
                <th>{t('usage.colOutput')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => {
                const name = providers.find((x) => x.id === p.providerId)?.displayName ?? p.providerId;
                return (
                  <tr key={p.id}>
                    <td dir="auto">{name}</td>
                    <td dir="auto">{p.model}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={p.inputPer1M}
                        onChange={(e) =>
                          upsertPrice({
                            id: p.id,
                            providerId: p.providerId,
                            model: p.model,
                            inputPer1M: Number(e.target.value) || 0,
                            outputPer1M: p.outputPer1M,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={p.outputPer1M}
                        onChange={(e) =>
                          upsertPrice({
                            id: p.id,
                            providerId: p.providerId,
                            model: p.model,
                            inputPer1M: p.inputPer1M,
                            outputPer1M: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td>
                      <button type="button" className="ghost" onClick={() => removePrice(p.id)}>
                        {t('common.remove')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className={styles.addPrice}>
          <select
            value={priceProviderId}
            onChange={(e) => setPriceProviderId(e.target.value)}
            aria-label={t('usage.priceProviderAria')}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} dir="auto">
                {p.displayName}
              </option>
            ))}
          </select>
          <input
            placeholder={t('usage.modelIdPlaceholder')}
            value={priceModel}
            onChange={(e) => setPriceModel(e.target.value)}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={inputPer1M}
            onChange={(e) => setInputPer1M(e.target.value)}
            aria-label={t('usage.inputPer1MAria')}
            title={t('usage.inputPer1MTitle')}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={outputPer1M}
            onChange={(e) => setOutputPer1M(e.target.value)}
            aria-label={t('usage.outputPer1MAria')}
            title={t('usage.outputPer1MTitle')}
          />
          <button type="button" className="primary" onClick={handleAddPrice}>
            {t('usage.addPrice')}
          </button>
        </div>
      </section>
    </Modal>
  );
}
