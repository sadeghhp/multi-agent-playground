import { useMemo, useState } from 'react';
import { useProviderStore } from '../store/providerStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { useUiStore } from '../store/uiStore';
import { useUsageStore } from '../store/usageStore';
import { formatUsd } from '../usage/pricing';
import { startOfLocalDay } from '../usage/budget';
import { Modal } from './Modal';
import styles from './UsagePanel.module.css';

type Scope = 'run' | 'today' | 'all';

export function UsagePanel() {
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
      title: 'Clear today’s usage',
      message: 'Remove all usage ledger rows from today?',
      confirmLabel: 'Clear today',
      danger: true,
    });
    if (ok) await clearToday();
  }

  async function handleClearAll() {
    const ok = await requestConfirm({
      title: 'Clear usage ledger',
      message: 'Remove all recorded usage? Prices are kept.',
      confirmLabel: 'Clear all',
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
    <Modal title="LLM usage & budget" onClose={() => setPanel('none')} width={720}>
      <section className={styles.section}>
        <h3 className={styles.h3}>Token budgets</h3>
        <p className="muted">
          Hard stops before an API call when the next request would exceed a cap. Current run:{' '}
          {runTokens.toLocaleString()} tok used.
        </p>
        <div className={styles.budgetGrid}>
          <label>
            Max tokens / run
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
            Max tokens / day
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
            Max fallback tokens / run
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
          <h3 className={styles.h3}>Usage</h3>
          <div className={styles.scopeBtns} role="group" aria-label="Usage scope">
            {(['run', 'today', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                className={scope === s ? 'primary' : 'secondary'}
                onClick={() => setScope(s)}
              >
                {s === 'run' ? 'This run' : s === 'today' ? 'Today' : 'All time'}
              </button>
            ))}
          </div>
        </div>
        <p>
          <strong>{totals.tokens.toLocaleString()}</strong> tokens · est.{' '}
          <strong>{formatUsd(totals.cost)}</strong>
          {filtered.some((e) => e.estimated) && (
            <span className="muted"> · some rows estimated</span>
          )}
        </p>
        {totals.rows.length === 0 ? (
          <p className="muted">No usage recorded for this scope yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Tokens</th>
                <th>Est. $</th>
              </tr>
            </thead>
            <tbody>
              {totals.rows.map((row) => (
                <tr key={`${row.providerName}-${row.model}`}>
                  <td>{row.providerName}</td>
                  <td>{row.model}</td>
                  <td>{row.tokens.toLocaleString()}</td>
                  <td>{formatUsd(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={styles.actions}>
          <button type="button" className="secondary" onClick={() => void handleClearToday()}>
            Clear today
          </button>
          <button type="button" className="danger" onClick={() => void handleClearAll()}>
            Clear all
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.h3}>Model prices (USD / 1M tokens)</h3>
        <p className="muted">Editable estimates for accounting — not billed by this app.</p>
        {prices.length === 0 ? (
          <p className="muted">No prices yet. Add one below.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => {
                const name = providers.find((x) => x.id === p.providerId)?.displayName ?? p.providerId;
                return (
                  <tr key={p.id}>
                    <td>{name}</td>
                    <td>{p.model}</td>
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
                        Remove
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
            aria-label="Price provider"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <input
            placeholder="model id"
            value={priceModel}
            onChange={(e) => setPriceModel(e.target.value)}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={inputPer1M}
            onChange={(e) => setInputPer1M(e.target.value)}
            aria-label="Input $/1M"
            title="Input USD per 1M tokens"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={outputPer1M}
            onChange={(e) => setOutputPer1M(e.target.value)}
            aria-label="Output $/1M"
            title="Output USD per 1M tokens"
          />
          <button type="button" className="primary" onClick={handleAddPrice}>
            Add price
          </button>
        </div>
      </section>
    </Modal>
  );
}
