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
  /** True on the very first turn of a run — enables the opening instruction. */
  isFirstTurn?: boolean;
}

const CONNECTION_RULE: Record<Connection['type'], string> = {
  conversation: 'Respond to the latest relevant messages in the conversation.',
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

/** Build the system prompt text (sections 1–6, 9 of spec §12). */
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

  // 8. Language directive — governs both what the agent asks and answers.
  sections.push(LANGUAGE_DIRECTIVE[agent.language]);

  // 9. Output constraints (final-response instruction)
  if (agent.runtime.finalResponseInstruction?.trim()) {
    sections.push(`Output constraint: ${agent.runtime.finalResponseInstruction.trim()}`);
  }

  return sections.join('\n');
}

/** Build the user-turn content (sections 7–8 of spec §12). */
export function buildTaskPrompt(ctx: PromptContext): string {
  const { conversation, agent } = ctx;
  const sections: string[] = [];

  sections.push(`Subject: ${conversation.subject || '(none)'}`);
  if (conversation.objective) sections.push(`Objective: ${conversation.objective}`);
  if (conversation.initialContext) sections.push(`Context: ${conversation.initialContext}`);

  if (ctx.isFirstTurn && agent.runtime.openingInstruction?.trim()) {
    sections.push(agent.runtime.openingInstruction.trim());
  }

  if (ctx.sourceAgentName && ctx.incoming) {
    sections.push(`You are responding after ${ctx.sourceAgentName} via a ${ctx.incoming.type} connection.`);
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
