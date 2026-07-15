import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../domain/factories';
import { ProviderError } from '../../providers/errors';
import type { NormalizedResponse } from '../../providers/types';
import { cleanJsonText, draftToAgentOverrides, generateAgentDraft } from '../generateAgent';

vi.mock('../../providers/openaiAdapter', () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from '../../providers/openaiAdapter';
const sendChatMock = vi.mocked(sendChat);

function reply(text: string): NormalizedResponse {
  return { text, model: 'm1', finishReason: 'stop', raw: {}, durationMs: 5, status: 200 };
}

const VALID_DRAFT = {
  name: 'Critic',
  description: 'Skeptically reviews claims.',
  role: 'Skeptical reviewer',
  systemInstruction: 'Challenge unsupported claims and identify weaknesses.',
  language: 'en',
  characteristics: {
    tone: 'direct',
    verbosity: 50,
    creativity: 40,
    assertiveness: 70,
    skepticism: 85,
    cooperation: 35,
  },
  colorCategory: 'red',
  skills: [{ name: 'critique', description: 'Critical review', instruction: 'Focus on factual weaknesses.' }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('cleanJsonText', () => {
  it('unwraps a whole-reply code fence', () => {
    expect(cleanJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts a balanced JSON object out of surrounding prose', () => {
    const raw = 'Sure! Here you go:\n\n{"a":1,"b":{"c":2}}\n\nLet me know if you need changes.';
    expect(cleanJsonText(raw)).toBe('{"a":1,"b":{"c":2}}');
  });

  it('leaves clean JSON untouched', () => {
    expect(cleanJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it('does not unwrap quotes inside string values', () => {
    const raw = '{"name":"\\"Quoted\\" Name"}';
    expect(cleanJsonText(raw)).toBe(raw);
  });
});

describe('generateAgentDraft', () => {
  const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

  it('returns a validated draft on success', async () => {
    sendChatMock.mockResolvedValue(reply(JSON.stringify(VALID_DRAFT)));
    const result = await generateAgentDraft('a skeptical reviewer', provider, 'm1');
    expect(result.ok).toBe(true);
    expect(result.draft?.name).toBe('Critic');
    expect(result.draft?.skills).toHaveLength(1);
  });

  it('parses a reply wrapped in a code fence with surrounding prose', async () => {
    sendChatMock.mockResolvedValue(reply(`Here's the agent:\n\n\`\`\`json\n${JSON.stringify(VALID_DRAFT)}\n\`\`\`countdown`));
    const result = await generateAgentDraft('a skeptical reviewer', provider, 'm1');
    expect(result.ok).toBe(true);
    expect(result.draft?.role).toBe('Skeptical reviewer');
  });

  it('sends the expected request params', async () => {
    sendChatMock.mockResolvedValue(reply(JSON.stringify(VALID_DRAFT)));
    await generateAgentDraft('desc', provider, 'm1');
    const params = sendChatMock.mock.calls[0][1];
    expect(params.model).toBe('m1');
    expect(params.temperature).toBe(0.4);
    expect(params.maxOutputTokens).toBe(2048);
  });

  it('fails cleanly on non-JSON output and surfaces the raw text', async () => {
    sendChatMock.mockResolvedValue(reply('I cannot help with that.'));
    const result = await generateAgentDraft('desc', provider, 'm1');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('invalid-json');
    expect(result.rawText).toBe('I cannot help with that.');
  });

  it('fails cleanly on JSON that does not match the draft schema', async () => {
    sendChatMock.mockResolvedValue(reply(JSON.stringify({ foo: 'bar' })));
    const result = await generateAgentDraft('desc', provider, 'm1');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('invalid-json');
    expect(result.errorDetail).toBeTruthy();
    expect(result.rawText).toBeTruthy();
  });

  it('fails cleanly when the model returns only whitespace', async () => {
    sendChatMock.mockResolvedValue(reply('   \n  '));
    const result = await generateAgentDraft('desc', provider, 'm1');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('empty-response');
  });

  it('surfaces reasoning text and a distinct message when a reasoning model burns its budget without answering', async () => {
    sendChatMock.mockResolvedValue({
      ...reply(''),
      reasoning: 'Thinking through the request at length...',
    });
    const result = await generateAgentDraft('desc', provider, 'm1');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('empty-response');
    expect(result.errorSummary).toMatch(/reasoning/i);
    expect(result.rawText).toBe('Thinking through the request at length...');
  });

  it('threads onReasoningToken through to sendChat', async () => {
    sendChatMock.mockResolvedValue(reply(JSON.stringify(VALID_DRAFT)));
    const onReasoningToken = vi.fn();
    await generateAgentDraft('desc', provider, 'm1', { onReasoningToken });
    expect(sendChatMock).toHaveBeenCalledWith(
      provider,
      expect.anything(),
      expect.objectContaining({ onReasoningToken }),
    );
  });

  it('does not call the provider when the description is empty', async () => {
    const result = await generateAgentDraft('   ', provider, 'm1');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('empty-description');
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it('does not call the provider when no model is given', async () => {
    const result = await generateAgentDraft('desc', provider, '');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('no-model');
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it('reports a sanitized error when the provider throws', async () => {
    sendChatMock.mockRejectedValue(new ProviderError('rate-limit', 'Rate limited', { status: 429 }));
    const result = await generateAgentDraft('desc', provider, 'm1');
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('rate-limit');
    expect(result.errorSummary).toBe('Rate limited');
    expect(result.retryEligible).toBe(true);
  });
});

describe('draftToAgentOverrides', () => {
  it('mints fresh skill ids and merges characteristics over defaults', () => {
    const draft = generateAgentDraftFixture();
    const overrides = draftToAgentOverrides(draft);
    expect(overrides.skills).toHaveLength(1);
    expect(overrides.skills?.[0].id).toMatch(/^sk_/);
    expect(overrides.skills?.[0].enabled).toBe(true);
    expect(overrides.characteristics?.tone).toBe('direct');
  });

  it('applies an llm override when given', () => {
    const draft = generateAgentDraftFixture();
    const overrides = draftToAgentOverrides(draft, { providerId: 'pv_1', model: 'm1' });
    expect(overrides.llm?.providerId).toBe('pv_1');
    expect(overrides.llm?.model).toBe('m1');
  });

  it('leaves llm unset when no override is given', () => {
    const draft = generateAgentDraftFixture();
    const overrides = draftToAgentOverrides(draft);
    expect(overrides.llm).toBeUndefined();
  });
});

function generateAgentDraftFixture() {
  return VALID_DRAFT as Parameters<typeof draftToAgentOverrides>[0];
}
