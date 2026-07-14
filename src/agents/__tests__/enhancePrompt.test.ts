import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, createProvider } from '../../domain/factories';
import { ProviderError } from '../../providers/errors';
import type { NormalizedResponse } from '../../providers/types';
import { cleanEnhancedText, enhanceSystemInstruction } from '../enhancePrompt';

vi.mock('../../providers/openaiAdapter', () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from '../../providers/openaiAdapter';
const sendChatMock = vi.mocked(sendChat);

function reply(text: string): NormalizedResponse {
  return { text, model: 'm1', finishReason: 'stop', raw: {}, durationMs: 5, status: 200 };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('cleanEnhancedText', () => {
  it('unwraps a whole-reply code fence', () => {
    expect(cleanEnhancedText('```\nDo the thing well.\n```')).toBe('Do the thing well.');
    expect(cleanEnhancedText('```text\nLine one\nLine two\n```')).toBe('Line one\nLine two');
  });

  it('drops a "Here is the improved instruction:" preamble', () => {
    const raw = 'Sure! Here is the improved instruction:\n\nAnalyze methodically and cite evidence.';
    expect(cleanEnhancedText(raw)).toBe('Analyze methodically and cite evidence.');
  });

  it('drops the preamble when it is separated by a single newline, not a blank line (L-14 regression)', () => {
    const raw = "Sure! Here's the improved instruction:\nAnalyze methodically and cite evidence.";
    expect(cleanEnhancedText(raw)).toBe('Analyze methodically and cite evidence.');
  });

  it('strips wrapping quotes', () => {
    expect(cleanEnhancedText('"Be concise."')).toBe('Be concise.');
    expect(cleanEnhancedText('“Be concise.”')).toBe('Be concise.');
  });

  it('leaves clean text untouched', () => {
    const clean = 'You are a critic. Challenge unsupported claims.';
    expect(cleanEnhancedText(clean)).toBe(clean);
  });
});

describe('enhanceSystemInstruction', () => {
  const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
  const agent = createAgent({
    name: 'Critic',
    role: 'Reviewer',
    systemInstruction: 'be critical',
    llm: { providerId: provider.id, model: 'm1', temperature: 0.7, maxOutputTokens: 1024 },
  });

  it('returns cleaned rewritten text on success', async () => {
    sendChatMock.mockResolvedValue(reply('```\nCritically evaluate every claim.\n```'));
    const result = await enhanceSystemInstruction(agent, provider);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Critically evaluate every claim.');
  });

  it('gives the rewrite headroom above the agent maxOutputTokens', async () => {
    sendChatMock.mockResolvedValue(reply('better'));
    await enhanceSystemInstruction(agent, provider);
    const params = sendChatMock.mock.calls[0][1];
    expect(params.maxOutputTokens).toBeGreaterThanOrEqual(2048);
    expect(params.model).toBe('m1');
  });

  it('reports a sanitized error when the provider throws', async () => {
    sendChatMock.mockRejectedValue(new ProviderError('rate-limit', 'Rate limited', { status: 429 }));
    const result = await enhanceSystemInstruction(agent, provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('rate-limit');
    expect(result.errorSummary).toBe('Rate limited');
  });

  it('fails cleanly when the model returns only whitespace', async () => {
    sendChatMock.mockResolvedValue(reply('   \n  '));
    const result = await enhanceSystemInstruction(agent, provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('empty-response');
  });

  it('does not call the provider when no model is configured', async () => {
    const noModel = createAgent({ llm: { providerId: provider.id, model: '', temperature: 0.7, maxOutputTokens: 1024 } });
    const result = await enhanceSystemInstruction(noModel, provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('no-model');
    expect(sendChatMock).not.toHaveBeenCalled();
  });
});
