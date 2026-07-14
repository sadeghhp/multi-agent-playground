import { Component, type ErrorInfo, type ReactNode } from 'react';
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
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error and couldn&apos;t continue rendering.</p>
          <pre className={styles.detail}>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
