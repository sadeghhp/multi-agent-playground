import { describe, expect, it } from 'vitest';
import { ConversationMode } from '../schema';
import { CONVERSATION_MODES, QUICK_START_PRESETS } from '../runEnvironments';

describe('conversation environments', () => {
  it('exposes UI metadata for every ConversationMode enum value', () => {
    const metaValues = CONVERSATION_MODES.map((m) => m.value).sort();
    expect(metaValues).toEqual([...ConversationMode.options].sort());
  });

  it('quick-start patches only touch style fields — never budget or content', () => {
    const forbidden = [
      'subject',
      'objective',
      'initialContext',
      'startingAgentId',
      'maxTotalTurns',
      'maxResponsesPerAgent',
      'stopOnError',
      'responseTimeoutOverrideMs',
    ];
    for (const preset of QUICK_START_PRESETS) {
      for (const key of Object.keys(preset.patch)) {
        expect(forbidden).not.toContain(key);
      }
    }
  });

  it('every quick-start names a valid conversation mode', () => {
    for (const preset of QUICK_START_PRESETS) {
      expect(ConversationMode.options).toContain(preset.patch.conversationMode);
    }
  });
});
