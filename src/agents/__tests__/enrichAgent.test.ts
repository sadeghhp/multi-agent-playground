import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, createProvider } from '../../domain/factories';
import { ProviderError } from '../../providers/errors';
import type { NormalizedResponse } from '../../providers/types';
import { enrichAgentDraft, enrichedDraftToAgentOverrides } from '../enrichAgent';
import type { GeneratedAgentDraft } from '../generateAgent';

vi.mock('../../providers/openaiAdapter', () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from '../../providers/openaiAdapter';
const sendChatMock = vi.mocked(sendChat);

function reply(text: string, extras: Partial<NormalizedResponse> = {}): NormalizedResponse {
  return { text, model: 'm1', finishReason: 'stop', raw: {}, durationMs: 5, status: 200, ...extras };
}

const VALID_DRAFT = {
  name: 'Critic',
  description: 'Skeptically reviews claims.',
  role: 'Skeptical reviewer',
  systemInstruction: 'Challenge unsupported claims and double-check numeric figures against the source.',
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
  skills: [
    { name: 'critique', description: 'Critical review', instruction: 'Focus on factual weaknesses.' },
    { name: 'fact-check', description: 'Verifies numeric claims', instruction: 'Cross-check figures against the source.' },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('enrichAgentDraft', () => {
  const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
  const agent = createAgent({
    name: 'Critic',
    role: 'Skeptical reviewer',
    systemInstruction: 'Challenge unsupported claims.',
    llm: { providerId: 'pv_1', model: 'm1', temperature: 0.7, maxOutputTokens: 1024 },
    skills: [{ id: 'sk_1', name: 'critique', description: 'Critical review', instruction: 'Focus on factual weaknesses.', enabled: true }],
  });

  it('returns a validated draft on success', async () => {
    sendChatMock.mockResolvedValue(reply(JSON.stringify(VALID_DRAFT)));
    const result = await enrichAgentDraft(agent, 'It should now fact-check numeric claims.', provider);
    expect(result.ok).toBe(true);
    expect(result.draft?.skills).toHaveLength(2);
  });

  it('includes the current agent config and new info in the request', async () => {
    sendChatMock.mockResolvedValue(reply(JSON.stringify(VALID_DRAFT)));
    await enrichAgentDraft(agent, 'It should now fact-check numeric claims.', provider);
    const params = sendChatMock.mock.calls[0][1];
    const userMsg = params.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('"name": "Critic"');
    expect(userMsg).toContain('It should now fact-check numeric claims.');
    expect(params.model).toBe('m1');
    expect(params.temperature).toBe(0.4);
  });

  it('does not call the provider when new info is empty', async () => {
    const result = await enrichAgentDraft(agent, '   ', provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('empty-info');
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it('does not call the provider when no model is configured', async () => {
    const noModelAgent = createAgent({ llm: { providerId: 'pv_1', model: '', temperature: 0.7, maxOutputTokens: 1024 } });
    const result = await enrichAgentDraft(noModelAgent, 'new info', provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('no-model');
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it('fails cleanly on non-JSON output and surfaces the raw text', async () => {
    sendChatMock.mockResolvedValue(reply('I cannot help with that.'));
    const result = await enrichAgentDraft(agent, 'new info', provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('invalid-json');
    expect(result.rawText).toBe('I cannot help with that.');
  });

  it('reports a sanitized error when the provider throws', async () => {
    sendChatMock.mockRejectedValue(new ProviderError('rate-limit', 'Rate limited', { status: 429 }));
    const result = await enrichAgentDraft(agent, 'new info', provider);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('rate-limit');
    expect(result.retryEligible).toBe(true);
  });
});

describe('enrichedDraftToAgentOverrides', () => {
  const agent = createAgent({
    characteristics: {
      tone: 'neutral',
      verbosity: 50,
      creativity: 50,
      assertiveness: 50,
      skepticism: 50,
      cooperation: 50,
    },
    skills: [
      { id: 'sk_existing', name: 'critique', description: 'old desc', instruction: 'old instruction', enabled: false, libraryId: 'lib_1' },
    ],
  });

  it('preserves id, enabled state, and libraryId for skills matched by name', () => {
    const draft = VALID_DRAFT as GeneratedAgentDraft;
    const overrides = enrichedDraftToAgentOverrides(agent, draft);
    const critique = overrides.skills?.find((s) => s.name === 'critique');
    expect(critique?.id).toBe('sk_existing');
    expect(critique?.enabled).toBe(false);
    expect(critique?.libraryId).toBe('lib_1');
    expect(critique?.description).toBe('Critical review');
  });

  it('mints a fresh id for a new skill introduced by the draft', () => {
    const draft = VALID_DRAFT as GeneratedAgentDraft;
    const overrides = enrichedDraftToAgentOverrides(agent, draft);
    const factCheck = overrides.skills?.find((s) => s.name === 'fact-check');
    expect(factCheck?.id).toMatch(/^sk_/);
    expect(factCheck?.enabled).toBe(true);
    expect(factCheck?.libraryId).toBeUndefined();
  });

  it('merges characteristics over the existing values', () => {
    const draft = VALID_DRAFT as GeneratedAgentDraft;
    const overrides = enrichedDraftToAgentOverrides(agent, draft);
    expect(overrides.characteristics?.tone).toBe('direct');
    expect(overrides.characteristics?.skepticism).toBe(85);
  });

  it('preserves digital-shadow mode and persona when the draft omits them', () => {
    const shadow = createAgent({
      name: 'Thomas Nagel',
      personaMode: 'digital-shadow',
      persona: {
        realName: 'Thomas Nagel',
        knownFor: 'Mind',
        stanceNotes: '- bats',
        citationStyle: 'in-character',
      },
      systemInstruction: 'I argue from subjective experience.',
    });
    const draft = VALID_DRAFT as GeneratedAgentDraft; // no personaMode
    const overrides = enrichedDraftToAgentOverrides(shadow, draft);
    expect(overrides.personaMode).toBe('digital-shadow');
    expect(overrides.persona?.realName).toBe('Thomas Nagel');
    expect(overrides.persona?.stanceNotes).toContain('bats');
  });

  it('applies an explicit digital-shadow persona from the draft', () => {
    const draft = {
      ...VALID_DRAFT,
      name: 'Thomas Nagel',
      role: 'Digital shadow of Thomas Nagel',
      personaMode: 'digital-shadow' as const,
      persona: {
        realName: 'Thomas Nagel',
        knownFor: 'Philosophy of mind',
        stanceNotes: '- Qualia',
        citationStyle: 'in-character' as const,
      },
    } as GeneratedAgentDraft;
    const overrides = enrichedDraftToAgentOverrides(agent, draft);
    expect(overrides.personaMode).toBe('digital-shadow');
    expect(overrides.persona?.knownFor).toBe('Philosophy of mind');
  });
});
