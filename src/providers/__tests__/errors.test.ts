import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  classifyStatus,
  classifyThrown,
  formatProviderErrorDetail,
  parseProviderErrorPayload,
  providerErrorFromPayload,
  retryEligible,
  summaryFor,
  troubleshootingHints,
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
  it('maps 408 to timeout', () => {
    expect(classifyStatus(408)).toBe('timeout');
  });
  it('maps other 4xx to a non-retryable bad-request', () => {
    expect(classifyStatus(400)).toBe('bad-request');
    expect(classifyStatus(422)).toBe('bad-request');
    expect(retryEligible('bad-request')).toBe(false);
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

describe('parseProviderErrorPayload', () => {
  it('parses a string error', () => {
    expect(parseProviderErrorPayload('boom')).toEqual({ message: 'boom' });
  });

  it('parses OpenRouter-shaped metadata including raw upstream', () => {
    const parsed = parseProviderErrorPayload({
      code: 502,
      message: 'JSON error injected into SSE stream',
      metadata: {
        error_type: 'unmapped',
        raw: '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
      },
    });
    expect(parsed).toMatchObject({
      status: 502,
      message: 'JSON error injected into SSE stream',
      errorType: 'unmapped',
    });
    expect(parsed.rawUpstream).toMatch(/invalid argument/i);
  });
});

describe('providerErrorFromPayload', () => {
  it('classifies in-band 400 as bad-request', () => {
    const pe = providerErrorFromPayload(
      { code: 400, message: 'Bad Request', metadata: { raw: 'Request contains an invalid argument.' } },
      { streamed: true },
    );
    expect(pe.kind).toBe('bad-request');
    expect(pe.status).toBe(400);
    expect(pe.streamed).toBe(true);
    expect(pe.rawUpstream).toMatch(/invalid argument/i);
  });

  it('overrides gateway 502 to bad-request when raw signals client arguments', () => {
    const pe = providerErrorFromPayload(
      {
        code: 502,
        message: 'JSON error injected into SSE stream',
        metadata: {
          raw: '{"error":{"message":"Request contains an invalid argument."}}',
        },
      },
      { streamed: true },
    );
    expect(pe.kind).toBe('bad-request');
    expect(pe.status).toBe(502);
  });
});

describe('formatProviderErrorDetail', () => {
  it('prefers raw upstream over the wrapper message', () => {
    const pe = new ProviderError('bad-request', summaryFor('bad-request'), {
      detail: 'JSON error injected into SSE stream',
      rawUpstream: 'Request contains an invalid argument.',
      streamed: true,
    });
    const detail = formatProviderErrorDetail(pe);
    expect(detail).toContain('invalid argument');
    expect(detail).toContain(summaryFor('bad-request'));
    // Wrapper string is deprioritized when rawUpstream is present.
    expect(detail).not.toContain('JSON error injected');
  });
});

describe('troubleshootingHints', () => {
  it('suggests history and token cuts for large bad-request prompts', () => {
    const hints = troubleshootingHints(
      { kind: 'bad-request', rawUpstream: 'Request contains an invalid argument.' },
      { promptChars: 18_000, maxOutputTokens: 8192 },
    );
    expect(hints.some((h) => /History|Include history/i.test(h))).toBe(true);
    expect(hints.some((h) => /Max output tokens/i.test(h))).toBe(true);
    expect(hints.length).toBeLessThanOrEqual(4);
  });

  it('suggests retry for streamed server-error', () => {
    const hints = troubleshootingHints({ kind: 'server-error', streamed: true });
    expect(hints[0]).toMatch(/Retry|switch model/i);
  });
});
