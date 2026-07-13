import { useState } from 'react';
import type { AuthMethod, CredentialStorage, Provider } from '../domain/schema';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { createProvider } from '../domain/factories';
import { clearCredential, saveCredential } from '../persistence/credentialStore';
import { validateEndpoint } from '../providers/url';
import { testConnection, type TestConnectionResult } from '../providers/testConnection';
import { Modal } from './Modal';
import styles from './ProviderManager.module.css';

export function ProviderManager() {
  const playground = useDomainStore((s) => s.playground)!;
  const addProvider = useDomainStore((s) => s.addProvider);
  const updateProvider = useDomainStore((s) => s.updateProvider);
  const removeProvider = useDomainStore((s) => s.removeProvider);
  const setPanel = useUiStore((s) => s.setPanel);

  const providers = playground.providers;
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
    const copy = createProvider({ ...rest, displayName: `${p.displayName} (copy)` });
    addProvider(copy);
    setSelectedId(copy.id);
  }

  function handleDelete(p: Provider) {
    if (!window.confirm(`Delete provider "${p.displayName}"? Agents using it will be unassigned.`)) return;
    clearCredential(p.id);
    removeProvider(p.id);
    setSelectedId(providers.find((x) => x.id !== p.id)?.id ?? null);
  }

  return (
    <Modal title="Provider manager" onClose={() => setPanel('none')} width={780}>
      <div className={styles.warning + ' warning-banner'}>
        Provider credentials are stored and used in this browser. Do not use unrestricted production
        keys. Browser storage is not a secure secret vault.
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
  const [testModel, setTestModel] = useState(provider.defaultModel || provider.models[0] || '');
  const [modelsText, setModelsText] = useState(provider.models.join(', '));

  const urlValidation = validateEndpoint(provider.baseUrl);

  function setKey(apiKey: string) {
    onChange({ apiKey });
    saveCredential(provider.id, apiKey, provider.credentialStorage);
  }

  function setStorage(mode: CredentialStorage) {
    onChange({ credentialStorage: mode });
    if (provider.apiKey) saveCredential(provider.id, provider.apiKey, mode);
  }

  function commitModels(text: string) {
    const models = text.split(',').map((m) => m.trim()).filter(Boolean);
    onChange({ models, defaultModel: provider.defaultModel || models[0] || '' });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(provider, testModel || provider.defaultModel);
      setTestResult(result);
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
          <input id="pv-url" value={provider.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} placeholder="http://localhost:11434" />
          {!urlValidation.ok && provider.baseUrl && <p className={styles.err}>{urlValidation.reason}</p>}
        </div>
        <div className="field">
          <label htmlFor="pv-path">Path</label>
          <input id="pv-path" value={provider.path} onChange={(e) => onChange({ path: e.target.value })} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="pv-auth">Authentication</label>
        <select id="pv-auth" value={provider.authMethod} onChange={(e) => onChange({ authMethod: e.target.value as AuthMethod })}>
          <option value="none">No authentication</option>
          <option value="bearer">Bearer token</option>
          <option value="custom-header">Custom header</option>
        </select>
      </div>

      {provider.authMethod !== 'none' && (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pv-header">Header name</label>
              <input id="pv-header" value={provider.authHeaderName} onChange={(e) => onChange({ authHeaderName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pv-prefix">Prefix</label>
              <input id="pv-prefix" value={provider.authPrefix} onChange={(e) => onChange({ authPrefix: e.target.value })} placeholder="Bearer" />
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
                placeholder="stored in this browser"
                autoComplete="off"
              />
              <button type="button" onClick={() => { onChange({ apiKey: '' }); clearCredential(provider.id); }}>Clear</button>
            </div>
          </div>

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
        </>
      )}

      <div className="field">
        <label htmlFor="pv-models">Model IDs (comma-separated)</label>
        <input
          id="pv-models"
          value={modelsText}
          onChange={(e) => setModelsText(e.target.value)}
          onBlur={() => commitModels(modelsText)}
          placeholder="llama3.1, qwen2.5"
        />
      </div>

      <div className={styles.testBox}>
        <div className={styles.testRow}>
          <input value={testModel} onChange={(e) => setTestModel(e.target.value)} placeholder="model to test" />
          <button type="button" className="primary" onClick={handleTest} disabled={testing || !provider.baseUrl}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {testResult && (
          <div className={testResult.ok ? styles.testOk : styles.testFail}>
            {testResult.ok ? (
              <>
                <strong>✓ Success</strong> — HTTP {testResult.status} · {testResult.durationMs}ms
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
