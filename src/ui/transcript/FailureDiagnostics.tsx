import { useTranslation } from 'react-i18next';
import type { RequestSnapshot } from '../../store/runtimeStore';
import {
  troubleshootingHints,
  type ProviderErrorKind,
} from '../../providers/errors';
import { useUiStore } from '../../store/uiStore';
import { formatNumber } from '../../i18n/format';
import styles from './Transcript.module.css';

// Maps each provider error kind to its translation key (under the `transcript`
// area). The visible titles themselves are localized at render time via t().
const TITLE_KEY_FOR_KIND: Partial<Record<ProviderErrorKind, string>> = {
  'bad-request': 'titleBadRequest',
  'rate-limit': 'titleRateLimit',
  timeout: 'titleTimeout',
  'server-error': 'titleServerError',
  auth: 'titleAuth',
  cors: 'titleCors',
  'private-network': 'titlePrivateNetwork',
  'insecure-remote': 'titleInsecureRemote',
  network: 'titleNetwork',
  'model-not-found': 'titleModelNotFound',
  aborted: 'titleAborted',
};

function titleKeyFor(kind?: ProviderErrorKind, streamed?: boolean): string {
  if (kind === 'server-error' && streamed) return 'titleServerErrorMidStream';
  if (kind && TITLE_KEY_FOR_KIND[kind]) return TITLE_KEY_FOR_KIND[kind]!;
  return 'titleFailed';
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
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const showToast = useUiStore((s) => s.showToast);
  const errorKind = snapshot?.errorKind;
  const primary =
    snapshot?.rawUpstream?.trim() ||
    snapshot?.error?.trim() ||
    fallbackError?.trim() ||
    t('transcript.unknownProviderError');
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
  if (snapshot?.streamedError) metaParts.push(t('transcript.midStream'));
  if (snapshot?.promptMessages != null && snapshot.promptChars != null) {
    metaParts.push(
      t('transcript.diagPromptSummary', {
        messages: snapshot.promptMessages,
        chars: formatNumber(snapshot.promptChars, language),
      }),
    );
  }
  if (maxOutputTokens != null) metaParts.push(`max_tokens ${maxOutputTokens}`);
  if (snapshot?.partialOutputChars) {
    metaParts.push(t('transcript.diagStreamedBeforeFail', { n: snapshot.partialOutputChars }));
  }

  const copyDiagnostics = () => {
    if (!snapshot) {
      showToast('error', t('transcript.noSnapshotToCopy'));
      return;
    }
    if (!navigator.clipboard) {
      showToast('error', t('transcript.clipboardUnavailable'));
      return;
    }
    navigator.clipboard.writeText(diagnosticsBlob(snapshot)).then(
      () => showToast('info', t('transcript.copiedDiagnostics')),
      () => showToast('error', t('transcript.couldNotCopyDiagnostics')),
    );
  };

  return (
    <div className={styles.failureDiag} dir="ltr">
      <div className={styles.failureTitle}>{t(`transcript.${titleKeyFor(errorKind, snapshot?.streamedError)}`)}</div>
      <div className={styles.errText}>{primary}</div>
      {metaParts.length > 0 && (
        <div className={styles.failureMeta}>{metaParts.join(' · ')}</div>
      )}
      {hints.length > 0 && (
        <div className={styles.failureHints}>
          <div className={styles.failureHintsLabel}>{t('transcript.whatToTry')}</div>
          <ul>
            {hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.failureActions}>
        <button type="button" onClick={copyDiagnostics} disabled={!snapshot}>
          {t('transcript.copyDiagnostics')}
        </button>
        {snapshot && (
          <button type="button" onClick={onToggleRequest} aria-pressed={showRequest}>
            {showRequest ? t('transcript.hideRequestDetails') : t('transcript.showRequestDetails')}
          </button>
        )}
      </div>
    </div>
  );
}
