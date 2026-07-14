import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CredentialStorage, Provider } from '../domain/schema';
import { deriveAuthMethod } from './providerAuth';
import { useProviderStore } from '../store/providerStore';
import { useUiStore } from '../store/uiStore';
import { createProvider } from '../domain/factories';
import { clearCredential, saveCredential } from '../persistence/credentialStore';
import { validateEndpoint } from '../providers/url';
import { listModels } from '../providers/listModels';
import { testConnection, type TestConnectionResult } from '../providers/testConnection';
import { Modal } from './Modal';
import styles from './ProviderManager.module.css';

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
    const p = createProvider({
      displayName: 'Local (Ollama)',
      baseUrl: 'http://localhost:11434',
      path: '/v1/chat/completions',
      authMethod: 'none',
      models: [],
    });
    addProvider(p);
    setSelectedId(p.id);
  }

  function handleDuplicate(p: Provider) {
    const { id: _id, apiKey: _key, ...rest } = p;
    const copy = createProvider({ ...rest, authMethod: 'none', displayName: `${p.displayName} (copy)` });
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
    <Modal title="LLM providers" onClose={() => setPanel('none')} width={920}>
      <p className={styles.intro}>
        Configure OpenAI-compatible endpoints shared across all playgrounds in this browser.
        Keys are stored locally — do not use unrestricted production credentials.
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
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [testModel, setTestModel] = useState(provider.defaultModel || provider.models[0] || '');
  const [manualModel, setManualModel] = useState('');
  const [showKey, setShowKey] = useState(false);

  const urlValidation = validateEndpoint(provider.baseUrl);
  const canQueryProvider = Boolean(provider.baseUrl) && urlValidation.ok;

  function setKey(apiKey: string) {
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

  function setStorage(mode: CredentialStorage) {
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

  function applyModels(models: string[], defaultModel: string) {
    onChange({ models, defaultModel });
    if (!testModel.trim() || !models.includes(testModel)) setTestModel(defaultModel);
    setFetchedModels(null);
    setFetchStatus({ kind: 'ok', text: `${models.length} model${models.length === 1 ? '' : 's'} configured.` });
  }

  function showImportPanel(models: string[]) {
    setFetchedModels(models);
    setFetchStatus({
      kind: 'ok',
      text: `${models.length} model${models.length === 1 ? '' : 's'} found — choose which to add below.`,
    });
  }

  async function handleFetchModels() {
    if (!canQueryProvider) return;
    setFetchingModels(true);
    setFetchStatus(null);
    setFetchedModels(null);
    try {
      const result = await listModels(provider);
      if (result.ok) {
        if (result.models.length > 0) {
          showImportPanel(result.models);
        } else {
          setFetchStatus({
            kind: 'err',
            text: `Connected in ${result.durationMs}ms, but /v1/models returned no models.`,
          });
        }
      } else {
        setFetchStatus({
          kind: 'err',
          text: `Failed (${result.errorKind ?? 'error'}): ${result.errorSummary ?? 'Could not list models.'}`,
        });
      }
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleTest() {
    if (!canQueryProvider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(provider, testModel.trim() || undefined);
      setTestResult(result);
      if (result.models && result.models.length > 0) showImportPanel(result.models);
    } finally {
      setTesting(false);
    }
  }

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

      <EditorSection title="Connection" defaultOpen>
        <div className={styles.fieldGrid}>
          <div className="field">
            <label htmlFor="pv-url">Base URL</label>
            <input
              id="pv-url"
              value={provider.baseUrl}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
            {!urlValidation.ok && provider.baseUrl && (
              <p className={styles.err}>{urlValidation.reason}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="pv-path">Chat path</label>
            <input
              id="pv-path"
              value={provider.path}
              onChange={(e) => onChange({ path: e.target.value })}
              placeholder="/v1/chat/completions"
            />
          </div>
          <div className="field">
            <label htmlFor="pv-timeout">Timeout (ms)</label>
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
        </div>
        <p className={styles.hint}>
          OpenAI-compatible servers only. Leave the path at the default unless your host uses a custom route.
        </p>
      </EditorSection>

      <EditorSection title="Authentication">
        <div className="field">
          <label htmlFor="pv-key">API key</label>
          <div className={styles.keyRow}>
            <input
              id="pv-key"
              type={showKey ? 'text' : 'password'}
              value={provider.apiKey ?? ''}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Leave empty for local servers (Ollama, LM Studio)"
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button type="button" onClick={clearKey}>Clear</button>
          </div>
        </div>

        <div className="field">
          <span className={styles.fieldLabel}>Credential storage</span>
          <div className={styles.segmented} role="radiogroup" aria-label="Credential storage">
            <button
              type="button"
              role="radio"
              aria-checked={provider.credentialStorage === 'session'}
              className={provider.credentialStorage === 'session' ? styles.segmentActive : ''}
              onClick={() => setStorage('session')}
            >
              Session only
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={provider.credentialStorage === 'local'}
              className={provider.credentialStorage === 'local' ? styles.segmentActive : ''}
              onClick={() => setStorage('local')}
            >
              Remember in browser
            </button>
          </div>
          <p className={styles.hint}>
            {provider.credentialStorage === 'session'
              ? 'Cleared when this tab closes.'
              : 'Persists in local storage until you clear it. Not a secure vault.'}
          </p>
        </div>
      </EditorSection>

      <EditorSection title="Models" defaultOpen badge={provider.models.length || undefined}>
        <ModelsSection
          provider={provider}
          manualModel={manualModel}
          onManualModelChange={setManualModel}
          onAddModel={addModel}
          onRemoveModel={removeModel}
          onDefaultChange={(defaultModel) => onChange({ defaultModel })}
          fetchingModels={fetchingModels}
          canQueryProvider={canQueryProvider}
          onFetch={handleFetchModels}
          fetchStatus={fetchStatus}
          fetchedModels={fetchedModels}
          onApplyImport={applyModels}
          onCancelImport={() => setFetchedModels(null)}
        />
      </EditorSection>

      {import.meta.env.DEV && (
        <EditorSection title="Developer">
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={provider.bypassDevProxy}
              onChange={(e) => onChange({ bypassDevProxy: e.target.checked })}
            />
            <span>
              <strong>Bypass dev proxy</strong>
              <span className={styles.checkHint}>
                Send requests directly from the browser instead of through the Vite dev-server proxy.
                Use when the endpoint is only reachable from your browser (VPN, etc.) and supports CORS.
              </span>
            </span>
          </label>
        </EditorSection>
      )}

      <EditorSection title="Test connection" defaultOpen>
        <TestSection
          provider={provider}
          testModel={testModel}
          onTestModelChange={setTestModel}
          testing={testing}
          canQueryProvider={canQueryProvider}
          onTest={handleTest}
          testResult={testResult}
        />
      </EditorSection>
    </div>
  );
}

function EditorSection({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.sectionHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.sectionCaret}>{open ? '▾' : '▸'}</span>
        <span className={styles.sectionTitle}>{title}</span>
        {badge !== undefined && badge > 0 && (
          <span className={styles.sectionBadge}>{badge}</span>
        )}
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

function ModelsSection({
  provider,
  manualModel,
  onManualModelChange,
  onAddModel,
  onRemoveModel,
  onDefaultChange,
  fetchingModels,
  canQueryProvider,
  onFetch,
  fetchStatus,
  fetchedModels,
  onApplyImport,
  onCancelImport,
}: {
  provider: Provider;
  manualModel: string;
  onManualModelChange: (v: string) => void;
  onAddModel: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onDefaultChange: (model: string) => void;
  fetchingModels: boolean;
  canQueryProvider: boolean;
  onFetch: () => void;
  fetchStatus: { kind: 'ok' | 'err'; text: string } | null;
  fetchedModels: string[] | null;
  onApplyImport: (models: string[], defaultModel: string) => void;
  onCancelImport: () => void;
}) {
  return (
    <div className={styles.modelsSection}>
      <div className={styles.modelsToolbar}>
        <button
          type="button"
          className="primary"
          onClick={onFetch}
          disabled={fetchingModels || !canQueryProvider}
        >
          {fetchingModels ? 'Fetching…' : 'Fetch from provider'}
        </button>
        <form
          className={styles.manualAdd}
          onSubmit={(e) => {
            e.preventDefault();
            onAddModel(manualModel);
          }}
        >
          <input
            value={manualModel}
            onChange={(e) => onManualModelChange(e.target.value)}
            placeholder="Add model ID manually"
            aria-label="Model ID to add"
          />
          <button type="submit" disabled={!manualModel.trim()}>Add</button>
        </form>
      </div>

      {fetchStatus && (
        <p
          className={fetchStatus.kind === 'err' ? styles.err : styles.hint}
          role="status"
          aria-live="polite"
        >
          {fetchStatus.text}
        </p>
      )}

      {fetchedModels && fetchedModels.length > 0 && (
        <ModelImportPanel
          models={fetchedModels}
          existingModels={provider.models}
          currentDefault={provider.defaultModel}
          onApply={onApplyImport}
          onCancel={onCancelImport}
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
                  onChange={() => onDefaultChange(model)}
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
                onClick={() => onRemoveModel(model)}
                aria-label={`Remove ${model}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.modelsEmpty}>
          No models configured. Fetch from your provider or add a model ID manually.
        </p>
      )}
    </div>
  );
}

function ModelImportPanel({
  models,
  existingModels,
  currentDefault,
  onApply,
  onCancel,
}: {
  models: string[];
  existingModels: string[];
  currentDefault: string;
  onApply: (selected: string[], defaultModel: string) => void;
  onCancel: () => void;
}) {
  const existingSet = new Set(existingModels);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (existingModels.length > 0) {
      return new Set(models.filter((m) => existingSet.has(m)));
    }
    return new Set(models);
  });
  const [defaultModel, setDefaultModel] = useState(() => {
    if (currentDefault && models.includes(currentDefault)) return currentDefault;
    if (existingModels.length > 0) {
      const kept = models.filter((m) => existingSet.has(m));
      if (kept.length > 0) return kept[0];
    }
    return models[0] ?? '';
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, filter]);

  const selectedList = models.filter((m) => selected.has(m));

  useEffect(() => {
    if (defaultModel && !selected.has(defaultModel)) {
      setDefaultModel(selectedList[0] ?? '');
    }
  }, [selected, defaultModel, selectedList]);

  function toggle(model: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
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
          </p>
        </div>
        <div className={styles.importHeaderActions}>
          <button type="button" onClick={() => setSelected(new Set(models))}>Select all</button>
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
          filtered.map((m) => (
            <label key={m} className={styles.importItem}>
              <input type="checkbox" checked={selected.has(m)} onChange={() => toggle(m)} />
              <span>{m}</span>
            </label>
          ))
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
            {selectedList.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
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

function TestSection({
  provider,
  testModel,
  onTestModelChange,
  testing,
  canQueryProvider,
  onTest,
  testResult,
}: {
  provider: Provider;
  testModel: string;
  onTestModelChange: (v: string) => void;
  testing: boolean;
  canQueryProvider: boolean;
  onTest: () => void;
  testResult: TestConnectionResult | null;
}) {
  return (
    <div className={styles.testSection}>
      <div className={styles.testRow}>
        {provider.models.length > 0 ? (
          <select
            value={testModel}
            onChange={(e) => onTestModelChange(e.target.value)}
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
            onChange={(e) => onTestModelChange(e.target.value)}
            placeholder="Model to test (optional)"
            aria-label="Model to test"
          />
        )}
        <button
          type="button"
          className="primary"
          onClick={onTest}
          disabled={testing || !canQueryProvider}
        >
          {testing ? 'Testing…' : 'Run test'}
        </button>
      </div>
      <p className={styles.hint}>
        Sends a minimal chat completion to verify the endpoint and response format.
      </p>

      {testResult && (
        <div
          className={testResult.ok ? styles.testOk : styles.testFail}
          role={testResult.ok ? 'status' : 'alert'}
          aria-live="polite"
        >
          {testResult.ok ? (
            <>
              <strong>Connection successful</strong>
              <span className={styles.testMeta}>
                HTTP {testResult.status} · {testResult.durationMs}ms
              </span>
              {testResult.models && testResult.models.length > 0 && (
                <div className={styles.testDetail}>
                  {testResult.models.length} model(s) available from /v1/models
                </div>
              )}
              {testResult.responseText && (
                <pre className={styles.testResp}>{testResult.responseText}</pre>
              )}
            </>
          ) : (
            <>
              <strong>Connection failed — {testResult.errorKind}</strong>
              <span className={styles.testMeta}>
                {testResult.status ? `HTTP ${testResult.status} · ` : ''}{testResult.durationMs}ms
              </span>
              <div>{testResult.errorSummary}</div>
              {testResult.errorDetail && (
                <div className={styles.testDetail}>{testResult.errorDetail}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
