import { useState } from 'react';
import type { CredentialStorage, Provider } from '../domain/schema';
import { deriveAuthMethod, schemeFromAuthMethod, type AuthScheme } from './providerAuth';
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
    // Strip the original id so createProvider's fresh id survives the spread;
    // otherwise both providers share an id and updates hit both.
    const { id: _id, apiKey: _key, ...rest } = p;
    // The copy carries no key, so it must be no-auth — otherwise a bearer/custom
    // authMethod would trip the "no API key" run validation.
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
    <Modal title="Provider manager" onClose={() => setPanel('none')} width={780}>
      <div className={styles.warning + ' warning-banner'}>
        Providers are shared across all playgrounds in this browser — create one here and any
        playground can use it. Credentials are stored and used in this browser; do not use
        unrestricted production keys. Browser storage is not a secure secret vault.
      </div>
      <div className={styles.layout}>
        <div className={styles.list}>
          <button type="button" className={`primary ${styles.addBtn}`} onClick={handleAdd}>
            + Add provider
          </button>
          {providers.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No providers yet.</p>}
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.listItem} ${p.id === selectedId ? styles.listActive : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className={styles.listName}>{p.displayName}</span>
              {!p.enabled && <span className="chip">off</span>}
            </button>
          ))}
        </div>

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
            <p className="muted">Select or add a provider.</p>
          )}
        </div>
      </div>
    </Modal>
  );
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
  const [fetchModelsResult, setFetchModelsResult] = useState<string | null>(null);
  const [testModel, setTestModel] = useState(provider.defaultModel || provider.models[0] || '');
  const [modelsText, setModelsText] = useState(provider.models.join(', '));
  // How to send the key when one is present. `authMethod` itself is derived from
  // key presence (empty key ⇒ 'none'), so this remembers the choice meanwhile.
  const [scheme, setScheme] = useState<AuthScheme>(schemeFromAuthMethod(provider.authMethod));

  const urlValidation = validateEndpoint(provider.baseUrl);
  const canQueryProvider = Boolean(provider.baseUrl) && urlValidation.ok;

  function setKey(apiKey: string) {
    onChange({ apiKey, authMethod: deriveAuthMethod(apiKey, scheme) });
    saveCredential(provider.id, apiKey, provider.credentialStorage);
  }

  function changeScheme(next: AuthScheme) {
    setScheme(next);
    const patch: Partial<Provider> = {
      authMethod: deriveAuthMethod(provider.apiKey ?? '', next),
      // Reset the prefix on switch so a stale "Bearer" can't leak into a
      // custom-header scheme (bearer supplies its own default prefix).
      authPrefix: '',
    };
    // Bearer always uses the standard Authorization header; drop any stale custom name.
    if (next === 'bearer') patch.authHeaderName = 'Authorization';
    onChange(patch);
  }

  function clearKey() {
    onChange({ apiKey: '', authMethod: 'none' });
    clearCredential(provider.id);
  }

  function setStorage(mode: CredentialStorage) {
    onChange({ credentialStorage: mode });
    if (provider.apiKey) saveCredential(provider.id, provider.apiKey, mode);
  }

  function commitModels(text: string) {
    const models = text.split(',').map((m) => m.trim()).filter(Boolean);
    onChange({ models, defaultModel: provider.defaultModel || models[0] || '' });
  }

  function applyModels(models: string[]) {
    const text = models.join(', ');
    setModelsText(text);
    onChange({ models, defaultModel: provider.defaultModel || models[0] || '' });
    if (!testModel.trim() && models[0]) setTestModel(models[0]);
  }

  async function handleFetchModels() {
    if (!canQueryProvider) return;
    setFetchingModels(true);
    setFetchModelsResult(null);
    try {
      const result = await listModels(provider);
      if (result.ok) {
        applyModels(result.models);
        setFetchModelsResult(
          result.models.length > 0
            ? `Found ${result.models.length} model(s) in ${result.durationMs}ms.`
            : `Connected in ${result.durationMs}ms, but /v1/models returned no models.`,
        );
      } else {
        setFetchModelsResult(
          `Failed (${result.errorKind ?? 'error'}): ${result.errorSummary ?? 'Could not list models.'}`,
        );
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
      if (result.models && result.models.length > 0) applyModels(result.models);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <div className={styles.editorActions}>
        <label className={styles.inline}>
          <input type="checkbox" checked={provider.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Enabled
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="danger" onClick={onDelete}>Delete</button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="pv-name">Display name</label>
        <input id="pv-name" value={provider.displayName} onChange={(e) => onChange({ displayName: e.target.value })} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pv-url">Base URL</label>
          <input id="pv-url" value={provider.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} placeholder="https://host or https://host/v1" />
          {!urlValidation.ok && provider.baseUrl && <p className={styles.err}>{urlValidation.reason}</p>}
        </div>
        <div className="field">
          <label htmlFor="pv-path">Path</label>
          <input id="pv-path" value={provider.path} onChange={(e) => onChange({ path: e.target.value })} placeholder="/chat/completions (optional)" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="pv-key">API key</label>
        <div className={styles.keyRow}>
          <input
            id="pv-key"
            type="password"
            value={provider.apiKey ?? ''}
            onChange={(e) => setKey(e.target.value)}
            placeholder="leave empty for no-auth servers"
            autoComplete="off"
          />
          <button type="button" onClick={clearKey}>Clear</button>
        </div>
        <p className={styles.hint}>Leave empty for servers that need no auth (e.g. local LM Studio / Ollama).</p>
      </div>

      <div className="field">
        <label>Scheme</label>
        <label className={styles.inline}>
          <input type="radio" name={`scheme-${provider.id}`} checked={scheme === 'bearer'} onChange={() => changeScheme('bearer')} />
          Bearer token (sends Authorization: Bearer …)
        </label>
        <label className={styles.inline}>
          <input type="radio" name={`scheme-${provider.id}`} checked={scheme === 'custom-header'} onChange={() => changeScheme('custom-header')} />
          Custom header
        </label>
      </div>

      {scheme === 'custom-header' && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="pv-header">Header name</label>
            <input id="pv-header" value={provider.authHeaderName} onChange={(e) => onChange({ authHeaderName: e.target.value })} placeholder="x-api-key" />
          </div>
          <div className="field">
            <label htmlFor="pv-prefix">Prefix</label>
            <input id="pv-prefix" value={provider.authPrefix} onChange={(e) => onChange({ authPrefix: e.target.value })} placeholder="(none)" />
          </div>
        </div>
      )}

      <div className="field">
        <label>Credential storage</label>
        <label className={styles.inline}>
          <input type="radio" name={`storage-${provider.id}`} checked={provider.credentialStorage === 'session'} onChange={() => setStorage('session')} />
          Session only (default — cleared when the tab closes)
        </label>
        <label className={styles.inline}>
          <input type="radio" name={`storage-${provider.id}`} checked={provider.credentialStorage === 'local'} onChange={() => setStorage('local')} />
          Remember in this browser
        </label>
        {provider.credentialStorage === 'local' && (
          <p className={styles.err}>⚠ The key will persist in this browser's local storage until cleared. Anything with access to this browser can read it.</p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pv-models">Model IDs (comma-separated)</label>
          <div className={styles.modelsRow}>
            <input
              id="pv-models"
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              onBlur={() => commitModels(modelsText)}
              placeholder="llama3.1, qwen2.5"
            />
            <button
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels || !canQueryProvider}
            >
              {fetchingModels ? 'Fetching…' : 'Fetch models'}
            </button>
          </div>
          {fetchModelsResult && <p className={fetchModelsResult.startsWith('Failed') ? styles.err : styles.hint}>{fetchModelsResult}</p>}
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

      <div className={styles.testBox}>
        <div className={styles.testRow}>
          <input value={testModel} onChange={(e) => setTestModel(e.target.value)} placeholder="model to test (optional)" />
          <button type="button" className="primary" onClick={handleTest} disabled={testing || !canQueryProvider}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {testResult && (
          <div className={testResult.ok ? styles.testOk : styles.testFail}>
            {testResult.ok ? (
              <>
                <strong>✓ Success</strong> — HTTP {testResult.status} · {testResult.durationMs}ms
                {testResult.models && testResult.models.length > 0 && (
                  <div className={styles.testDetail}>{testResult.models.length} model(s) from /v1/models</div>
                )}
                <div className={styles.testResp}>{testResult.responseText}</div>
              </>
            ) : (
              <>
                <strong>✗ {testResult.errorKind}</strong>
                {testResult.status ? ` — HTTP ${testResult.status}` : ''} · {testResult.durationMs}ms
                <div>{testResult.errorSummary}</div>
                {testResult.errorDetail && <div className={styles.testDetail}>{testResult.errorDetail}</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
