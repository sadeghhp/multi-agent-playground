import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  classifyStatus,
  classifyThrown,
  retryEligible,
} from '../errors';

describe('classifyStatus', () => {
  it('maps 401/403 to auth', () => {
    expect(classifyStatus(401)).toBe('auth');
    expect(classifyStatus(403)).toBe('auth');
  });
  it('maps 404 to model-not-found', () => {
    expect(classifyStatus(404)).toBe('model-not-found');
  });
  it('maps 429 to rate-limit', () => {
    expect(classifyStatus(429)).toBe('rate-limit');
  });
  it('maps 5xx to server-error', () => {
    expect(classifyStatus(500)).toBe('server-error');
    expect(classifyStatus(503)).toBe('server-error');
  });
});

describe('classifyThrown', () => {
  it('classifies AbortError as aborted', () => {
    const e = new DOMException('aborted', 'AbortError');
    expect(classifyThrown(e).kind).toBe('aborted');
  });

  it('classifies TimeoutError as timeout', () => {
    const e = new DOMException('timed out', 'TimeoutError');
    expect(classifyThrown(e).kind).toBe('timeout');
  });

  it('classifies "Failed to fetch" TypeError as cors (the common browser case)', () => {
    const e = new TypeError('Failed to fetch');
    const pe = classifyThrown(e);
    expect(pe.kind).toBe('cors');
    expect(pe.detail).toMatch(/cross-origin|CORS/i);
  });

  it('classifies Firefox NetworkError as cors', () => {
    const e = new TypeError('NetworkError when attempting to fetch resource.');
    expect(classifyThrown(e).kind).toBe('cors');
  });

  it('classifies other TypeErrors as network', () => {
    const e = new TypeError('something else entirely');
    expect(classifyThrown(e).kind).toBe('network');
  });

  it('passes through an existing ProviderError unchanged', () => {
    const original = new ProviderError('rate-limit', 'slow down');
    expect(classifyThrown(original)).toBe(original);
  });
});

describe('retryEligible', () => {
  it('is true for transient kinds', () => {
    expect(retryEligible('rate-limit')).toBe(true);
    expect(retryEligible('timeout')).toBe(true);
    expect(retryEligible('server-error')).toBe(true);
  });
  it('is false for auth and cors', () => {
    expect(retryEligible('auth')).toBe(false);
    expect(retryEligible('cors')).toBe(false);
  });
});
