import { useEffect, useMemo, useState } from 'react';
import type { Provider } from '../domain/schema';
import { deriveAuthMethod } from './providerAuth';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { createProvider } from '../domain/factories';
import { clearCredential, saveCredential } from '../persistence/credentialStore';
import { validateEndpoint } from '../providers/url';
import { listModels, type ListedModel } from '../providers/listModels';
import { testConnection, type TestConnectionResult } from '../providers/testConnection';
import { DEFAULT_OPENROUTER_PRICES, formatUsd } from '../usage/pricing';
import { useUsageStore } from '../store/usageStore';
import { Modal } from './Modal';
import styles from './ProviderManager.module.css';

/**
 * Quick-start presets for common OpenAI-compatible endpoints. Selecting one only
 * prefills the connection fields — the user still supplies the key and picks
 * models — so no preset locks the provider into a fixed shape.
 */
interface Preset {
  label: string;
  displayName: string;
  baseUrl: string;
  path: string;
  /** Optional model ids to prefill when applying the preset. */
  models?: string[];
}

const PRESETS: Preset[] = [
  { label: 'OpenAI', displayName: 'OpenAI', baseUrl: 'https://api.openai.com', path: '/v1/chat/completions' },
  {
    label: 'OpenRouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    path: '/v1/chat/completions',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-001',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  },
  { label: 'Groq', displayName: 'Groq', baseUrl: 'https://api.groq.com/openai', path: '/v1/chat/completions' },
  { label: 'Together', displayName: 'Together AI', baseUrl: 'https://api.together.xyz', path: '/v1/chat/completions' },
  { label: 'Ollama', displayName: 'Ollama (local)', baseUrl: 'http://localhost:11434', path: '/v1/chat/completions' },
  { label: 'LM Studio', displayName: 'LM Studio (local)', baseUrl: 'http://localhost:1234', path: '/v1/chat/completions' },
];

export function ProviderManager() {
  const addProvider = useProviderStore((s) => s.addProvider);
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const removeProvider = useProviderStore((s) => s.removeProvider);
  const setPanel = useUiStore((s) => s.setPanel);
  const requestConfirm = useUiStore((s) => s.requestConfirm);

  const providers = useProviderStore((s) => s.providers);
  const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null);
  const selected = providers.find((p) => p.id === selectedId) ?? null;

  function handleAdd() {
    const p = createProvider({ displayName: 'New provider', models: [] });
    addProvider(p);
    setSelectedId(p.id);
  }

  function handleDuplicate(p: Provider) {
    const { id: _id, apiKey: _key, ...rest } = p;
    const copy = createProvider({ ...rest, displayName: `${p.displayName} (copy)` });
    addProvider(copy);
    setSelectedId(copy.id);
  }

  async function handleDelete(p: Provider) {
    const ok = await requestConfirm({
      title: 'Delete provider',
      message: `Delete provider "${p.displayName}"? Agents using it will be unassigned.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    clearCredential(p.id);
    removeProvider(p.id);
    setSelectedId(providers.find((x) => x.id !== p.id)?.id ?? null);
  }

  return (
    <Modal title="LLM providers" onClose={() => setPanel('none')} width={900}>
      <p className={styles.intro}>
        Connect any OpenAI-compatible endpoint. Providers are shared across every playground in this
        browser. API keys are stored locally on this device — never use unrestricted production keys.
      </p>

      <div className={styles.layout}>
        <aside className={styles.list} aria-label="Provider list">
          <button type="button" className={`primary ${styles.addBtn}`} onClick={handleAdd}>
            + Add provider
          </button>

          {providers.length === 0 ? (
            <p className={styles.listEmpty}>No providers yet. Add one to get started.</p>
          ) : (
            <div className={styles.listItems}>
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.listItem} ${p.id === selectedId ? styles.listActive : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span
                    className={`${styles.statusDot} ${p.enabled ? styles.statusOn : styles.statusOff}`}
                    aria-hidden="true"
                  />
                  <span className={styles.listMeta}>
                    <span className={styles.listName}>{p.displayName}</span>
                    <span className={styles.listSub}>
                      {providerHost(p.baseUrl)}
                      {p.models.length > 0 && ` · ${p.models.length} model${p.models.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className={styles.editor}>
          {selected ? (
            <ProviderEditor
              key={selected.id}
              provider={selected}
              onChange={(patch) => updateProvider(selected.id, patch)}
              onDuplicate={() => handleDuplicate(selected)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <div className={styles.editorEmpty}>
              <p className={styles.editorEmptyTitle}>No provider selected</p>
              <p className="muted">Choose a provider from the list or add a new one.</p>
              <button type="button" className="primary" onClick={handleAdd}>+ Add provider</button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function providerHost(baseUrl: string): string {
  if (!baseUrl) return 'No URL';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

type Banner = { kind: 'ok' | 'err' | 'info'; text: string } | null;

function ProviderEditor({
  provider,
  onChange,
  onDuplicate,
  onDelete,
}: {
  provider: Provider;
  onChange: (patch: Partial<Provider>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'fetch' | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [fetchedModels, setFetchedModels] = useState<ListedModel[] | null>(null);
  const [testModel, setTestModel] = useState(provider.defaultModel || provider.models[0] || '');
  const [manualModel, setManualModel] = useState('');
  const [showKey, setShowKey] = useState(false);

  const urlValidation = validateEndpoint(provider.baseUrl);
  const hasUrl = Boolean(provider.baseUrl.trim());
  const canQuery = hasUrl && urlValidation.ok;

  function applyPreset(preset: Preset) {
    const patch: Partial<Provider> = {
      displayName:
        !provider.displayName || provider.displayName === 'New provider'
          ? preset.displayName
          : provider.displayName,
      baseUrl: preset.baseUrl,
      path: preset.path,
    };
    if (preset.models?.length) {
      patch.models = preset.models;
      patch.defaultModel = preset.models[0];
      setTestModel(preset.models[0]);
    }
    onChange(patch);
    if (preset.label === 'OpenRouter' && preset.models?.length) {
      const upsertPrice = useUsageStore.getState().upsertPrice;
      for (const seed of DEFAULT_OPENROUTER_PRICES) {
        if (!preset.models.includes(seed.model)) continue;
        upsertPrice({
          providerId: provider.id,
          model: seed.model,
          inputPer1M: seed.inputPer1M,
          outputPer1M: seed.outputPer1M,
        });
      }
    }
    setBanner(null);
    setTestResult(null);
    setFetchedModels(null);
  }

  function setKey(apiKey: string) {
    // The form exposes a single API-key credential: a non-empty key means bearer
    // auth, empty means none. Header/prefix stay at their canonical defaults.
    onChange({
      apiKey,
      authMethod: deriveAuthMethod(apiKey),
      authHeaderName: 'Authorization',
      authPrefix: '',
    });
    saveCredential(provider.id, apiKey, provider.credentialStorage);
  }

  function clearKey() {
    onChange({ apiKey: '', authMethod: 'none' });
    clearCredential(provider.id);
  }

  function setRemember(remember: boolean) {
    const mode = remember ? 'local' : 'session';
    onChange({ credentialStorage: mode });
    if (provider.apiKey) saveCredential(provider.id, provider.apiKey, mode);
  }

  function addModel(model: string) {
    const id = model.trim();
    if (!id || provider.models.includes(id)) return;
    const models = [...provider.models, id];
    onChange({ models, defaultModel: provider.defaultModel || id });
    setManualModel('');
  }

  function removeModel(model: string) {
    const models = provider.models.filter((m) => m !== model);
    const defaultModel =
      provider.defaultModel === model ? (models[0] ?? '') : provider.defaultModel;
    onChange({ models, defaultModel });
    if (testModel === model) setTestModel(defaultModel);
  }

  function applyImport(selected: ListedModel[], defaultModel: string) {
    const models = selected.map((m) => m.id);
    onChange({ models, defaultModel });
    const upsertPrice = useUsageStore.getState().upsertPrice;
    for (const m of selected) {
      if (m.inputPer1M === undefined && m.outputPer1M === undefined) continue;
      upsertPrice({
        providerId: provider.id,
        model: m.id,
        inputPer1M: m.inputPer1M ?? 0,
        outputPer1M: m.outputPer1M ?? 0,
      });
    }
    if (!testModel.trim() || !models.includes(testModel)) setTestModel(defaultModel);
    setFetchedModels(null);
    setBanner({ kind: 'ok', text: `${models.length} model${models.length === 1 ? '' : 's'} configured.` });
  }

  async function handleFetchModels() {
    if (!canQuery) return;
    setBusy('fetch');
    setBanner(null);
    setFetchedModels(null);
    try {
      const result = await listModels(provider);
      if (result.ok && result.models.length > 0) {
        setFetchedModels(result.models);
        setBanner({
          kind: 'info',
          text: `${result.models.length} model${result.models.length === 1 ? '' : 's'} found — choose which to add.`,
        });
      } else if (result.ok) {
        setBanner({ kind: 'err', text: `Connected in ${result.durationMs}ms, but the server listed no models.` });
      } else {
        setBanner({
          kind: 'err',
          text: `Failed (${result.errorKind ?? 'error'}): ${result.errorSummary ?? 'Could not list models.'}`,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    if (!canQuery) return;
    setBusy('test');
    setTestResult(null);
    try {
      const result = await testConnection(provider, testModel.trim() || undefined);
      setTestResult(result);
      if (result.models && result.models.length > 0 && provider.models.length === 0) {
        setFetchedModels(result.models.map((id) => ({ id })));
      }
    } finally {
      setBusy(null);
    }
  }

  const showPresets = !hasUrl;

  return (
    <div className={styles.editorInner}>
      <header className={styles.editorHeader}>
        <div className={styles.editorTitle}>
          <input
            className={styles.nameInput}
            id="pv-name"
            value={provider.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
            aria-label="Display name"
            placeholder="Provider name"
          />
          <label className={styles.enableToggle}>
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            {provider.enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>
        <div className={styles.editorHeaderActions}>
          <button type="button" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="danger" onClick={onDelete}>Delete</button>
        </div>
      </header>

      {showPresets && (
        <div className={styles.presets} role="group" aria-label="Quick start">
          <span className={styles.presetsLabel}>Quick start</span>
          <div className={styles.presetChips}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={styles.presetChip}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Connection ── */}
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>Connection</h3>
        <div className="field">
          <label htmlFor="pv-url">Base URL</label>
          <input
            id="pv-url"
            value={provider.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://api.example.com"
            spellCheck={false}
          />
          {!urlValidation.ok && hasUrl && <p className={styles.err}>{urlValidation.reason}</p>}
        </div>

        <div className="field">
          <label htmlFor="pv-key">API key</label>
          <div className={styles.keyRow}>
            <input
              id="pv-key"
              type={showKey ? 'text' : 'password'}
              value={provider.apiKey ?? ''}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…  (leave empty for local servers)"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
            {provider.apiKey ? <button type="button" onClick={clearKey}>Clear</button> : null}
          </div>
          <label className={styles.rememberRow}>
            <input
              type="checkbox"
              checked={provider.credentialStorage === 'local'}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Remember key in this browser
              <span className={styles.rememberHint}>
                {provider.credentialStorage === 'local'
                  ? 'Persists in local storage until cleared. Not a secure vault.'
                  : 'Off: the key is cleared when this tab closes.'}
              </span>
            </span>
          </label>
        </div>

        <details className={styles.advanced}>
          <summary className={styles.advancedSummary}>Advanced</summary>
          <div className={styles.advancedBody}>
            <div className="field">
              <label htmlFor="pv-path">Chat completions path</label>
              <input
                id="pv-path"
                value={provider.path}
                onChange={(e) => onChange({ path: e.target.value })}
                placeholder="/v1/chat/completions"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="pv-timeout">Request timeout (ms)</label>
              <input
                id="pv-timeout"
                type="number"
                min={1000}
                step={1000}
                value={provider.timeoutMs}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 1000) onChange({ timeoutMs: next });
                }}
              />
            </div>
            <p className={styles.hint}>
              Leave the path at the default unless your host uses a custom route.
            </p>
          </div>
        </details>
      </section>

      {/* ── Models ── */}
      <section className={styles.group}>
        <div className={styles.groupHeadRow}>
          <h3 className={styles.groupTitle}>
            Models
            {provider.models.length > 0 && <span className={styles.countBadge}>{provider.models.length}</span>}
          </h3>
          <button
            type="button"
            onClick={handleFetchModels}
            disabled={busy !== null || !canQuery}
            title={canQuery ? undefined : 'Enter a valid base URL first'}
          >
            {busy === 'fetch' ? 'Fetching…' : 'Fetch from provider'}
          </button>
        </div>

        {banner && (
          <p
            className={banner.kind === 'err' ? styles.err : styles.hint}
            role="status"
            aria-live="polite"
          >
            {banner.text}
          </p>
        )}

        {fetchedModels && fetchedModels.length > 0 && (
          <ModelImportPanel
            models={fetchedModels}
            existingModels={provider.models}
            currentDefault={provider.defaultModel}
            onApply={applyImport}
            onCancel={() => setFetchedModels(null)}
          />
        )}

        {provider.models.length > 0 ? (
          <ul className={styles.modelCatalog} aria-label="Configured models">
            {provider.models.map((model) => (
              <li key={model} className={styles.modelRow}>
                <label className={styles.modelDefault}>
                  <input
                    type="radio"
                    name={`default-${provider.id}`}
                    checked={provider.defaultModel === model}
                    onChange={() => onChange({ defaultModel: model })}
                    aria-label={`Set ${model} as default`}
                  />
                  <span className={styles.modelDefaultLabel}>
                    {provider.defaultModel === model ? 'Default' : 'Set default'}
                  </span>
                </label>
                <code className={styles.modelId}>{model}</code>
                <button
                  type="button"
                  className={styles.modelRemove}
                  onClick={() => removeModel(model)}
                  aria-label={`Remove ${model}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !fetchedModels && (
            <p className={styles.modelsEmpty}>
              No models yet. Fetch them from your provider or add a model ID below.
            </p>
          )
        )}

        <form
          className={styles.manualAdd}
          onSubmit={(e) => {
            e.preventDefault();
            addModel(manualModel);
          }}
        >
          <input
            value={manualModel}
            onChange={(e) => setManualModel(e.target.value)}
            placeholder="Add model ID manually"
            aria-label="Model ID to add"
            spellCheck={false}
          />
          <button type="submit" disabled={!manualModel.trim()}>Add</button>
        </form>
      </section>

      {/* ── Test ── */}
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>Test connection</h3>
        <div className={styles.testRow}>
          {provider.models.length > 0 ? (
            <select
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
              aria-label="Model to test"
            >
              <option value="">Default / auto-detect</option>
              {provider.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
              placeholder="Model to test (optional)"
              aria-label="Model to test"
              spellCheck={false}
            />
          )}
          <button
            type="button"
            className="primary"
            onClick={handleTest}
            disabled={busy !== null || !canQuery}
          >
            {busy === 'test' ? 'Testing…' : 'Run test'}
          </button>
        </div>
        <p className={styles.hint}>
          Sends a minimal chat completion to verify the endpoint, key, and response format.
        </p>

        {testResult && <TestResultView result={testResult} />}
      </section>
    </div>
  );
}

function TestResultView({ result }: { result: TestConnectionResult }) {
  return (
    <div
      className={result.ok ? styles.testOk : styles.testFail}
      role={result.ok ? 'status' : 'alert'}
      aria-live="polite"
    >
      {result.ok ? (
        <>
          <strong>Connection successful</strong>
          <span className={styles.testMeta}>
            HTTP {result.status} · {result.durationMs}ms
          </span>
          {result.models && result.models.length > 0 && (
            <div className={styles.testDetail}>{result.models.length} model(s) available</div>
          )}
          {result.responseText && <pre className={styles.testResp}>{result.responseText}</pre>}
        </>
      ) : (
        <>
          <strong>Connection failed — {result.errorKind}</strong>
          <span className={styles.testMeta}>
            {result.status ? `HTTP ${result.status} · ` : ''}{result.durationMs}ms
          </span>
          <div>{result.errorSummary}</div>
          {result.errorDetail && <div className={styles.testDetail}>{result.errorDetail}</div>}
        </>
      )}
    </div>
  );
}

function formatModelPriceLabel(m: ListedModel): string | null {
  if (m.inputPer1M === undefined && m.outputPer1M === undefined) return null;
  const input = formatUsd(m.inputPer1M ?? 0);
  const output = formatUsd(m.outputPer1M ?? 0);
  return `${input} in / ${output} out`;
}

function ModelImportPanel({
  models,
  existingModels,
  currentDefault,
  onApply,
  onCancel,
}: {
  models: ListedModel[];
  existingModels: string[];
  currentDefault: string;
  onApply: (selected: ListedModel[], defaultModel: string) => void;
  onCancel: () => void;
}) {
  const existingSet = new Set(existingModels);
  const modelIds = useMemo(() => models.map((m) => m.id), [models]);
  const hasAnyPricing = models.some(
    (m) => m.inputPer1M !== undefined || m.outputPer1M !== undefined,
  );
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (existingModels.length > 0) {
      return new Set(modelIds.filter((id) => existingSet.has(id)));
    }
    return new Set(modelIds);
  });
  const [defaultModel, setDefaultModel] = useState(() => {
    if (currentDefault && modelIds.includes(currentDefault)) return currentDefault;
    if (existingModels.length > 0) {
      const kept = modelIds.filter((id) => existingSet.has(id));
      if (kept.length > 0) return kept[0];
    }
    return modelIds[0] ?? '';
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q));
  }, [models, filter]);

  const selectedList = models.filter((m) => selected.has(m.id));

  useEffect(() => {
    if (defaultModel && !selected.has(defaultModel)) {
      setDefaultModel(selectedList[0]?.id ?? '');
    }
  }, [selected, defaultModel, selectedList]);

  function toggle(modelId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }

  return (
    <div className={styles.importPanel} role="region" aria-label="Import models from provider">
      <div className={styles.importHeader}>
        <div>
          <strong>Import models</strong>
          <p className={styles.importSub}>
            {selectedList.length} of {models.length} selected
            {hasAnyPricing ? ' · prices USD / 1M tokens' : ''}
          </p>
        </div>
        <div className={styles.importHeaderActions}>
          <button type="button" onClick={() => setSelected(new Set(modelIds))}>Select all</button>
          <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      </div>

      <input
        className={styles.importFilter}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter models…"
        aria-label="Filter models"
      />

      <div className={styles.importList}>
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>No models match your filter.</p>
        ) : (
          filtered.map((m) => {
            const priceLabel = formatModelPriceLabel(m);
            return (
              <label key={m.id} className={styles.importItem}>
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                <span className={styles.importModelId}>{m.id}</span>
                {priceLabel && <span className={styles.importPrice}>{priceLabel}</span>}
              </label>
            );
          })
        )}
      </div>

      <div className={styles.importFooter}>
        <div className="field" style={{ margin: 0, flex: 1 }}>
          <label htmlFor="import-default-model">Default model</label>
          <select
            id="import-default-model"
            value={defaultModel}
            disabled={selectedList.length === 0}
            onChange={(e) => setDefaultModel(e.target.value)}
          >
            {selectedList.map((m) => {
              const price = formatModelPriceLabel(m);
              return (
                <option key={m.id} value={m.id}>
                  {price ? `${m.id} (${price})` : m.id}
                </option>
              );
            })}
          </select>
        </div>
        <div className={styles.importButtons}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={selectedList.length === 0}
            onClick={() => onApply(selectedList, defaultModel)}
          >
            Use {selectedList.length} model{selectedList.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
