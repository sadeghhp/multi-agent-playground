import type {
  Agent,
  AgentLanguage,
  Connection,
  ConversationSettings,
  TranscriptMessage,
} from '../domain/schema';
import type { ChatMessage } from '../providers/types';
import { characteristicsToInstruction } from './characteristics';

/**
 * Prompt assembly (spec §12). Builds an agent's chat request from explicit,
 * ordered sections. The same builder powers the read-only "effective prompt"
 * preview and the live orchestrator so what the user sees is what is sent.
 */

export interface PromptContext {
  agent: Agent;
  conversation: ConversationSettings;
  /** Transcript already trimmed to the history window (see boundHistory). */
  history: TranscriptMessage[];
  /** The connection feeding this agent, if any (spec §7.3, §11.6). */
  incoming?: Connection | null;
  sourceAgentName?: string | null;
  /**
   * The source agent's most recent output (spec §12 "source agent output, when
   * applicable"). Included for review/handoff connections independently of the
   * history window, so the agent can act on the response it was told to review
   * even when includeHistory is off.
   */
  sourceOutput?: string | null;
  /** True on the very first turn of a run — enables the opening instruction. */
  isFirstTurn?: boolean;
  /**
   * The most recent user-authored message in the transcript (see
   * orchestrator.continueRun), if any. Surfaced explicitly and outside the
   * `includeHistory`/`historyWindow` gate so a user's follow-up ("argue
   * against this", "give me the facts") stays an authoritative instruction
   * for every agent in this run, not just a line that can scroll out of the
   * bounded history window.
   */
  pendingUserDirective?: string | null;
}

const CONNECTION_RULE: Record<Connection['type'], string> = {
  conversation:
    'Respond to the latest relevant messages in the conversation. Do not repeat or restate a previous message verbatim — contribute your own distinct perspective, new information, or a disagreement.',
  review: "Review the previous agent's most recent response. Focus on weaknesses, errors, and gaps.",
  handoff: "Treat the previous agent's output as your primary task context and continue the work.",
};

/**
 * The agent's conversation language (spec: per-agent language). Placed late in
 * the system prompt so it carries weight, and phrased bilingually (English +
 * native) so smaller local models are less likely to ignore it.
 */
const LANGUAGE_DIRECTIVE: Record<AgentLanguage, string> = {
  en: 'Write all of your responses in English.',
  fa: 'Write all of your responses in Persian (Farsi). همه‌ی پاسخ‌های خود را به زبان فارسی بنویسید.',
  fr: 'Write all of your responses in French. Rédige toutes tes réponses en français.',
};

/**
 * Conversation-level reply-length override, applied on top of each agent's own
 * verbosity characteristic for the duration of a run. 'agent-default' leaves
 * the per-agent characteristic as the only signal.
 */
const RESPONSE_LENGTH_DIRECTIVE: Record<ConversationSettings['responseLength'], string | null> = {
  'agent-default': null,
  short: 'Keep your response short for this conversation: no more than 1-3 sentences.',
  medium: 'Keep your response to a moderate length for this conversation: roughly one short paragraph.',
  long: 'Give a long, thorough response for this conversation, exploring multiple points or angles.',
};

/**
 * Conversation-level chit-chat/flattery control, applied on top of each
 * agent's own characteristics for the duration of a run. 'agent-default'
 * leaves the per-agent characteristics as the only signal.
 */
const CHITCHAT_POLICY_DIRECTIVE: Record<ConversationSettings['chitchatPolicy'], string | null> = {
  'agent-default': null,
  'concise-factual':
    'For this conversation: do not open with greetings, small talk, or transitional filler; ' +
    'do not compliment, flatter, or praise other agents or their ideas; state claims only when ' +
    'you can support them with a fact, source, or explicit reasoning, and say when you are ' +
    'uncertain rather than guessing; respond with the minimum number of sentences needed to convey ' +
    'the substance.',
};

/** Build the system prompt text (sections 1–8 of spec §12). */
export function buildSystemPrompt(ctx: PromptContext): string {
  const { agent } = ctx;
  const sections: string[] = [];

  // 1. Identity
  sections.push(`You are Agent: ${agent.name || 'Unnamed agent'}.`);

  // 2. Role
  if (agent.role) sections.push(`Role: ${agent.role}.`);

  // 3. Primary system instruction
  if (agent.systemInstruction.trim()) {
    sections.push(agent.systemInstruction.trim());
  }

  // 4. Characteristics
  const characteristics = characteristicsToInstruction(agent.characteristics);
  if (characteristics) sections.push(`Characteristics: ${characteristics}`);

  // 4b. Conversation-level tone/length overrides (apply to every agent this run)
  if (ctx.conversation.toneOverride.trim()) {
    sections.push(`For this conversation, maintain a ${ctx.conversation.toneOverride.trim()} tone.`);
  }
  const lengthDirective = RESPONSE_LENGTH_DIRECTIVE[ctx.conversation.responseLength];
  if (lengthDirective) sections.push(lengthDirective);
  const chitchatDirective = CHITCHAT_POLICY_DIRECTIVE[ctx.conversation.chitchatPolicy];
  if (chitchatDirective) sections.push(chitchatDirective);

  // 5. Enabled skills
  const skills = agent.skills.filter((s) => s.enabled);
  if (skills.length > 0) {
    const names = skills.map((s) => s.name).join(', ');
    sections.push(`Declared skills: ${names}. (These are described capabilities, not tools.)`);
    for (const skill of skills) {
      if (skill.instruction.trim()) sections.push(skill.instruction.trim());
    }
  }

  // 6. Conversation rule (from the incoming connection)
  if (ctx.incoming) {
    sections.push(CONNECTION_RULE[ctx.incoming.type]);
    if (ctx.incoming.instructionOverride?.trim()) {
      sections.push(ctx.incoming.instructionOverride.trim());
    }
  }

  // 7. Language directive — governs both what the agent asks and answers.
  // A run-level override replaces the agent's own language for this run
  // rather than stacking with it, since two "write in X" directives would
  // conflict.
  const effectiveLanguage =
    ctx.conversation.languageOverride === 'agent-default' ? agent.language : ctx.conversation.languageOverride;
  sections.push(LANGUAGE_DIRECTIVE[effectiveLanguage]);

  // 8. Output constraints (final-response instruction)
  if (agent.runtime.finalResponseInstruction?.trim()) {
    sections.push(`Output constraint: ${agent.runtime.finalResponseInstruction.trim()}`);
  }

  return sections.join('\n');
}

/** Build the user-turn content (the task/subject portion of spec §12, sent as the user message). */
export function buildTaskPrompt(ctx: PromptContext): string {
  const { conversation, agent } = ctx;
  const sections: string[] = [];

  // The opening turn reads as a natural conversational kickoff rather than a
  // form-like field dump, so the first agent's reply sounds like the start of
  // a real discussion instead of an acknowledgement of instructions.
  if (ctx.isFirstTurn) {
    sections.push(`You are opening a live discussion. The topic is: "${conversation.subject || '(no subject given)'}"`);
    if (conversation.objective) sections.push(`Keep this goal in mind as the discussion unfolds: ${conversation.objective}`);
    if (conversation.initialContext) sections.push(`Relevant background: ${conversation.initialContext}`);
    if (agent.runtime.openingInstruction?.trim()) sections.push(agent.runtime.openingInstruction.trim());
    if (ctx.pendingUserDirective?.trim()) {
      sections.push(
        `The user has interjected with the following — you must address it directly: "${ctx.pendingUserDirective.trim()}"`,
      );
    }
    sections.push(
      'Begin the conversation now by speaking directly about the topic, the way a person would when opening a real discussion. Do not restate these instructions, list the fields above, announce that you are an AI, or acknowledge that you were given a prompt — just start talking.',
    );
    return sections.join('\n');
  }

  sections.push(`Subject: ${conversation.subject || '(none)'}`);
  if (conversation.objective) sections.push(`Objective: ${conversation.objective}`);
  if (conversation.initialContext) sections.push(`Context: ${conversation.initialContext}`);

  // The user's latest follow-up (spec extension: "continue the conversation").
  // Surfaced explicitly, outside the includeHistory/historyWindow gate, so it
  // stays an authoritative instruction for every agent for the rest of the
  // run rather than one line that can scroll out of the bounded history.
  if (ctx.pendingUserDirective?.trim()) {
    sections.push(
      `The user has interjected with the following — you must address it directly in your response: "${ctx.pendingUserDirective.trim()}"`,
    );
  }

  if (ctx.sourceAgentName && ctx.incoming) {
    sections.push(`You are responding after ${ctx.sourceAgentName} via a ${ctx.incoming.type} connection.`);
  }

  // For review/handoff, embed the source's actual output so the agent has the
  // content it was instructed to review/continue, regardless of the history window.
  if (
    ctx.incoming &&
    (ctx.incoming.type === 'review' || ctx.incoming.type === 'handoff') &&
    ctx.sourceOutput?.trim()
  ) {
    const label = ctx.sourceAgentName ?? 'The previous agent';
    sections.push(`${label}'s most recent response:\n${ctx.sourceOutput.trim()}`);
  }

  sections.push('Provide your response.');
  return sections.join('\n');
}

/**
 * Assemble the full ChatMessage[] sent to the provider. History is rendered as
 * prior assistant/user turns so the model has conversational context (spec §11.6).
 */
export function assembleMessages(ctx: PromptContext): ChatMessage[] {
  const messages: ChatMessage[] = [];
  messages.push({ role: 'system', content: buildSystemPrompt(ctx) });

  if (ctx.agent.runtime.includeHistory) {
    for (const msg of ctx.history) {
      if (!msg.content) continue;
      // Prefix so each contribution is attributable inside the flattened history.
      messages.push({
        role: msg.agentId === ctx.agent.id ? 'assistant' : 'user',
        content: `[${msg.agentName}]: ${msg.content}`,
      });
    }
  }

  messages.push({ role: 'user', content: buildTaskPrompt(ctx) });
  return messages;
}

/**
 * Bound transcript history by message count and estimated character budget
 * (spec §11.6). Character estimation is explicitly an approximation, not tokens.
 */
export function boundHistory(
  transcript: TranscriptMessage[],
  windowSize: number,
  charBudget = 12_000,
): TranscriptMessage[] {
  const recent = transcript.slice(-Math.max(1, windowSize));
  const result: TranscriptMessage[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const len = recent[i].content.length;
    if (chars + len > charBudget && result.length > 0) break;
    chars += len;
    result.unshift(recent[i]);
  }
  return result;
}

/** Rough token estimate for display only (spec §11.6, §13). Clearly an estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
