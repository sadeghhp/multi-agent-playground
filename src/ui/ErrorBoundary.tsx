import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level render-error fallback. React error boundaries must be class
 * components (no hooks-based equivalent exists) — this is intentionally the
 * only class component in the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.fallback} role="alert">
          {/* Class component (error boundaries can't be hooks) — read from the
              i18n instance directly rather than useTranslation. */}
          <h1>{i18n.t('errorBoundary.title')}</h1>
          <p>{i18n.t('errorBoundary.description')}</p>
          <pre className={styles.detail} dir="auto">{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            {i18n.t('errorBoundary.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
