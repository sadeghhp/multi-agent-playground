import type { RequestSnapshot } from '../../store/runtimeStore';
import {
  troubleshootingHints,
  type ProviderErrorKind,
} from '../../providers/errors';
import { useUiStore } from '../../store/uiStore';
import styles from './Transcript.module.css';

const TITLE_FOR_KIND: Partial<Record<ProviderErrorKind, string>> = {
  'bad-request': 'Request rejected',
  'rate-limit': 'Rate limited',
  timeout: 'Request timed out',
  'server-error': 'Upstream model error',
  auth: 'Authentication failed',
  cors: 'Browser blocked the request (CORS)',
  'private-network': 'Cannot reach local provider from this site',
  'insecure-remote': 'Insecure remote endpoint',
  network: 'Network error',
  'model-not-found': 'Model not found',
  aborted: 'Request cancelled',
};

function titleFor(kind?: ProviderErrorKind, streamed?: boolean): string {
  if (kind === 'server-error' && streamed) return 'Upstream model error (mid-stream)';
  if (kind && TITLE_FOR_KIND[kind]) return TITLE_FOR_KIND[kind]!;
  return 'Request failed';
}

function diagnosticsBlob(snapshot: RequestSnapshot): string {
  return JSON.stringify(
    {
      url: snapshot.url,
      provider: snapshot.providerName,
      model: snapshot.model,
      params: snapshot.params,
      status: snapshot.status,
      error: snapshot.error,
      errorKind: snapshot.errorKind,
      errorType: snapshot.errorType,
      rawUpstream: snapshot.rawUpstream,
      streamedError: snapshot.streamedError,
      promptMessages: snapshot.promptMessages,
      promptChars: snapshot.promptChars,
      partialOutputChars: snapshot.partialOutputChars,
    },
    null,
    2,
  );
}

export function FailureDiagnostics({
  snapshot,
  fallbackError,
  showRequest,
  onToggleRequest,
}: {
  snapshot?: RequestSnapshot;
  fallbackError?: string;
  showRequest: boolean;
  onToggleRequest: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const errorKind = snapshot?.errorKind;
  const primary =
    snapshot?.rawUpstream?.trim() ||
    snapshot?.error?.trim() ||
    fallbackError?.trim() ||
    'Unknown provider error.';
  const maxOutputTokens =
    typeof snapshot?.params?.maxOutputTokens === 'number'
      ? snapshot.params.maxOutputTokens
      : undefined;
  const hints = troubleshootingHints(
    {
      kind: errorKind ?? 'unknown',
      streamed: snapshot?.streamedError,
      rawUpstream: snapshot?.rawUpstream,
    },
    {
      promptChars: snapshot?.promptChars,
      maxOutputTokens,
    },
  );

  const metaParts: string[] = [];
  if (snapshot?.status != null) metaParts.push(String(snapshot.status));
  if (snapshot?.errorType) metaParts.push(`error_type: ${snapshot.errorType}`);
  if (snapshot?.streamedError) metaParts.push('mid-stream');
  if (snapshot?.promptMessages != null && snapshot.promptChars != null) {
    metaParts.push(
      `${snapshot.promptMessages} messages · ~${snapshot.promptChars.toLocaleString()} chars`,
    );
  }
  if (maxOutputTokens != null) metaParts.push(`max_tokens ${maxOutputTokens}`);
  if (snapshot?.partialOutputChars) {
    metaParts.push(`${snapshot.partialOutputChars} chars streamed before fail`);
  }

  const copyDiagnostics = () => {
    if (!snapshot) {
      showToast('error', 'No request snapshot available to copy.');
      return;
    }
    if (!navigator.clipboard) {
      showToast('error', 'Clipboard is not available in this context.');
      return;
    }
    navigator.clipboard.writeText(diagnosticsBlob(snapshot)).then(
      () => showToast('info', 'Copied diagnostics (no credentials).'),
      () => showToast('error', 'Could not copy diagnostics.'),
    );
  };

  return (
    <div className={styles.failureDiag} dir="ltr">
      <div className={styles.failureTitle}>{titleFor(errorKind, snapshot?.streamedError)}</div>
      <div className={styles.errText}>{primary}</div>
      {metaParts.length > 0 && (
        <div className={styles.failureMeta}>{metaParts.join(' · ')}</div>
      )}
      {hints.length > 0 && (
        <div className={styles.failureHints}>
          <div className={styles.failureHintsLabel}>What to try</div>
          <ul>
            {hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.failureActions}>
        <button type="button" onClick={copyDiagnostics} disabled={!snapshot}>
          Copy diagnostics
        </button>
        {snapshot && (
          <button type="button" onClick={onToggleRequest} aria-pressed={showRequest}>
            {showRequest ? 'Hide request details' : 'Show request details'}
          </button>
        )}
      </div>
    </div>
  );
}
