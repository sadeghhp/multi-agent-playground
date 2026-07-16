import type {
  Agent,
  AgentLanguage,
  Connection,
  ConversationSettings,
  TranscriptMessage,
} from '../domain/schema';
import { buildPersonaIdentitySection } from '../domain/persona';
import { CONTROL_TOOL_DIRECTIVE, KIND_DIRECTIVE, overridesHistoryToggle } from '../domain/agentKind';
import { DISCUSSION_CONDUCT } from '../domain/conduct';
import { buildToolProtocolSection } from '../tools/protocol';
import { resolveTools } from '../tools/registry';
import { buildControlTools, grantedControlToolIds, type RosterEntry } from '../tools/control';
import { createNoopTurnControl } from '../orchestrator/controlEffects';
import type { ChatMessage } from '../providers/types';
import { extractInlineThinking } from '../providers/openaiAdapter';
import { characteristicsToInstruction } from './characteristics';

/**
 * Prompt assembly (spec §12). Builds an agent's chat request from explicit,
 * ordered sections. The same builder powers the read-only "effective prompt"
 * preview and the live orchestrator so what the user sees is what is sent.
 */

/**
 * Visible answer text for another agent to read. Strips any residual inline
 * think tags from `content` and never includes `reasoning` — peers must only
 * see the clear answer, not chain-of-thought.
 */
export function visibleAnswerText(msg: TranscriptMessage): string {
  return extractInlineThinking(msg.content).text.trim();
}

export interface PromptContext {
  agent: Agent;
  conversation: ConversationSettings;
  /** Transcript already trimmed to the history window (see boundHistory). */
  history: TranscriptMessage[];
  /** The connection feeding this agent, if any (spec §7.3, §11.6). */
  incoming?: Connection | null;
  sourceAgentName?: string | null;
  /** Id of the source agent, used to detect when its output is already in `history`. */
  sourceAgentId?: string | null;
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
  /**
   * Whether the pending user directive is still "fresh" — i.e. interjected
   * within the last few turns. Fresh directives are imposed as a hard "you must
   * address this" instruction; once a few turns have addressed it, it downgrades
   * to a softer "keep in mind" so a since-resolved interjection stops forcing
   * every later agent to re-answer it. Undefined is treated as fresh (previews).
   */
  userDirectiveIsFresh?: boolean;
  /**
   * Display name of the specific agent the pending user directive addresses
   * (user @mention). Null/undefined = broadcast to everyone (today's behavior).
   * The addressed agent gets the hard "answer this" instruction; every other
   * agent only sees it as context they must not answer themselves.
   */
  userDirectiveTargetName?: string | null;
  /** True when the pending user directive addresses THIS agent. */
  userDirectiveTargetsSelf?: boolean;
  /**
   * Present when this turn was summoned by a directed question (spec extension:
   * orchestration control). `isReplyReturn` marks the asker's follow-up turn
   * after the target answered (ask_agent round-trip).
   */
  pendingAgentDirective?: { fromName: string; text: string; isReplyReturn: boolean } | null;
  /**
   * The current discussion topic, when a moderator redirected it via set_topic.
   * Derived from the transcript (last message carrying `topicChange` wins).
   */
  activeTopic?: { topic: string; setByName: string } | null;
  /**
   * The playground's agents, so control-tool descriptions can list addressable
   * targets by name. Optional: previews/tests without it render the control
   * tools with an empty roster.
   */
  roster?: readonly RosterEntry[];
}

/** Whether the flattened history block is included for this agent. */
function historyIncluded(ctx: PromptContext): boolean {
  return ctx.agent.runtime.includeHistory || overridesHistoryToggle(ctx.agent.kind);
}

/**
 * True when the source agent's most-recent answer is already rendered inside the
 * included history block — in which case embedding it again in the task prompt
 * would duplicate the same text. The embed still fires when history is off or
 * the source has scrolled out of the window (its intended purpose).
 */
function sourceOutputAlreadyInHistory(ctx: PromptContext): boolean {
  if (!historyIncluded(ctx) || !ctx.sourceAgentId || !ctx.sourceOutput) return false;
  const target = ctx.sourceOutput.trim();
  return ctx.history.some((m) => m.agentId === ctx.sourceAgentId && visibleAnswerText(m) === target);
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

/**
 * Conversation-level environment ("mode"): the facilitation frame every agent
 * operates in for the run. Each directive states concrete behaviour to do and
 * to avoid (not a style adjective), so smaller models act on it. 'open' adds
 * nothing — each agent just follows its own role.
 */
const CONVERSATION_MODE_DIRECTIVE: Record<ConversationSettings['conversationMode'], string | null> = {
  open: null,
  brainstorm:
    'This is a brainstorming session: generate as many distinct ideas as you can and build on ' +
    "others' ideas ('yes, and…'). Defer judgement — do not criticise, rank, or reject ideas yet, " +
    'including your own. Favour volume and variety over polish.',
  critique:
    'This is a critique session: stress-test the ideas on the table. Surface hidden assumptions, ' +
    'failure modes, edge cases, and risks, and state what would have to be true for each claim to ' +
    'hold. Attack the idea, not the person, and when you reject something offer a stronger ' +
    'alternative.',
  debate:
    'This is a debate: take a clear position on the question and defend it. Steelman the opposing ' +
    'view before you rebut it, and back every point with a concrete reason or example rather than ' +
    'assertion.',
  planning:
    'This is a planning session: turn the objective into a concrete, ordered set of steps. For each ' +
    'step, note what it depends on and how you would know it is done. Call out unknowns that block ' +
    'the plan instead of glossing over them.',
  decision:
    'This is a decision session: drive toward a single recommendation. Lay out the options, the ' +
    'criteria you are weighing them against, and the tradeoffs, then end with one clearly ' +
    'recommended choice and the reason it wins.',
  retrospective:
    'This is a retrospective: reflect on what happened. Separate what went well, what went poorly, ' +
    'and what to change — and make every "change" a concrete, assignable action, not a vague ' +
    'intention.',
  postmortem:
    'This is a blameless postmortem: reconstruct what happened as a factual timeline, then identify ' +
    'root causes and contributing factors. Focus on systems, processes, and gaps — never individual ' +
    'blame — and propose a specific prevention for each cause.',
  socratic:
    'This is a Socratic discussion: advance mainly by asking sharp, probing questions rather than ' +
    'asserting conclusions. Use questions to expose gaps and assumptions, and assert directly only ' +
    'when it is needed to move the discussion forward.',
};

/** Build the system prompt text (sections 1–8 of spec §12). */
export function buildSystemPrompt(ctx: PromptContext): string {
  const { agent } = ctx;
  const sections: string[] = [];

  // 1. Identity (role agent vs digital-shadow contract)
  sections.push(...buildPersonaIdentitySection(agent));

  // 2. Role
  if (agent.role) sections.push(`Role: ${agent.role}.`);

  // 3. Primary system instruction
  if (agent.systemInstruction.trim()) {
    sections.push(agent.systemInstruction.trim());
  }

  // 3b. Kind contract (moderator / summarizer / finalizer). A fixed behavioural
  // contract for the agent's lifecycle kind, injected so the type's duty cannot
  // be silently dropped by an empty or edited systemInstruction. 'participant'
  // contributes nothing here.
  const kindDirective = KIND_DIRECTIVE[agent.kind];
  if (kindDirective) sections.push(kindDirective);

  // 3c. Control-tool usage contracts — only for tools the agent actually holds
  // (opt-in ∩ kind-eligible), so the prompt never references an absent tool.
  for (const toolId of grantedControlToolIds(agent)) {
    const directive = CONTROL_TOOL_DIRECTIVE[toolId];
    if (directive) sections.push(directive);
  }

  // 4. Characteristics
  const characteristics = characteristicsToInstruction(agent.characteristics);
  if (characteristics) sections.push(`Characteristics: ${characteristics}`);

  // 4b. Conversation-level environment + tone/length overrides (every agent, this run).
  // The environment frame comes first so it sets the overall stance; the finer
  // tone/length/chit-chat overrides then refine it.
  const modeDirective = CONVERSATION_MODE_DIRECTIVE[ctx.conversation.conversationMode];
  if (modeDirective) sections.push(modeDirective);
  if (ctx.conversation.toneOverride.trim()) {
    sections.push(`For this conversation, maintain a ${ctx.conversation.toneOverride.trim()} tone.`);
  }
  const lengthDirective = RESPONSE_LENGTH_DIRECTIVE[ctx.conversation.responseLength];
  if (lengthDirective) sections.push(lengthDirective);
  const chitchatDirective = CHITCHAT_POLICY_DIRECTIVE[ctx.conversation.chitchatPolicy];
  if (chitchatDirective) sections.push(chitchatDirective);

  // 4c. Discussion conduct — participants replying to a live discussion engage
  // the specific prior claims instead of emitting parallel monologues. Gated on
  // visible history: the opening speaker has nothing to respond to, and
  // moderator/summarizer/finalizer keep their KIND_DIRECTIVE neutrality.
  if (agent.kind === 'participant' && historyIncluded(ctx) && ctx.history.length > 0) {
    sections.push(DISCUSSION_CONDUCT);
  }

  // 5. Enabled skills
  const skills = agent.skills.filter((s) => s.enabled);
  if (skills.length > 0) {
    const names = skills.map((s) => s.name).join(', ');
    sections.push(`Declared skills: ${names}. (These are described capabilities, not tools.)`);
    for (const skill of skills) {
      if (skill.instruction.trim()) sections.push(skill.instruction.trim());
    }
  }

  // 5b. Executable tools (in contrast to the declared-only skills above). The
  // mechanical invocation protocol lives here — template prose only says WHEN
  // to use tools — so protocol changes never require template edits. Control
  // tools (orchestration) join the same protocol list; the preview builds them
  // with an inert TurnControl so the rendered prompt matches the live run.
  const tools = [
    ...resolveTools(agent.tools),
    ...buildControlTools({ agent, roster: ctx.roster ?? [], ctrl: createNoopTurnControl() }),
  ];
  if (tools.length > 0) {
    sections.push(buildToolProtocolSection(tools));
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

/**
 * Render the pending user directive for this agent. A broadcast directive keeps
 * today's fresh/stale phrasing for everyone. A TARGETED directive (user
 * @mention) is a hard "answer this" only for the addressed agent; every other
 * agent gets a soft context line regardless of freshness — they must not answer
 * a question that was put to someone else.
 */
function userDirectiveSection(ctx: PromptContext): string | null {
  const text = ctx.pendingUserDirective?.trim();
  if (!text) return null;
  const targetName = ctx.userDirectiveTargetName?.trim();
  if (targetName && !ctx.userDirectiveTargetsSelf) {
    return `The user asked ${targetName} the following — treat it as context; do not answer it yourself: "${text}"`;
  }
  if (targetName) {
    return ctx.userDirectiveIsFresh === false
      ? `Earlier in this conversation the user addressed YOU directly with the following — keep it in mind: "${text}"`
      : `The user has addressed YOU directly — you must answer this in your response; the other agents will see your reply: "${text}"`;
  }
  return ctx.userDirectiveIsFresh === false
    ? `Earlier in this conversation the user interjected with the following — keep it in mind: "${text}"`
    : `The user has interjected with the following — you must address it directly in your response: "${text}"`;
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
    const openingDirective = userDirectiveSection(ctx);
    if (openingDirective) sections.push(openingDirective);
    if (agent.personaMode === 'digital-shadow') {
      const realName =
        agent.persona?.realName?.trim() || agent.name.trim() || 'your persona';
      sections.push(
        `Begin the conversation now in character as ${realName}, opening the discussion directly. Do not restate these instructions, list the fields above, announce that you are an AI or a digital shadow, or acknowledge that you were given a prompt — just start talking.`,
      );
    } else {
      sections.push(
        'Begin the conversation now by speaking directly about the topic, the way a person would when opening a real discussion. Do not restate these instructions, list the fields above, announce that you are an AI, or acknowledge that you were given a prompt — just start talking.',
      );
    }
    return sections.join('\n');
  }

  sections.push(`Subject: ${conversation.subject || '(none)'}`);
  if (conversation.objective) sections.push(`Objective: ${conversation.objective}`);
  if (conversation.initialContext) sections.push(`Context: ${conversation.initialContext}`);

  // Active topic redirect (spec extension: orchestration control). Rendered for
  // every agent while it is the latest topicChange in the transcript.
  if (ctx.activeTopic?.topic.trim()) {
    sections.push(
      `${ctx.activeTopic.setByName} has redirected the discussion to: "${ctx.activeTopic.topic.trim()}". Address this topic; do not return to earlier threads unless they bear on it.`,
    );
  }

  // The user's latest follow-up (spec extension: "continue the conversation").
  // Surfaced explicitly, outside the includeHistory/historyWindow gate, so it
  // stays visible even when it scrolls out of the bounded history. A fresh
  // interjection is imposed as a hard instruction; a since-addressed one
  // downgrades to context so it stops forcing every later agent to re-answer it.
  // Targeted (@mention) directives bind only the addressed agent — see
  // userDirectiveSection.
  const userDirective = userDirectiveSection(ctx);
  if (userDirective) sections.push(userDirective);

  if (ctx.sourceAgentName && ctx.incoming) {
    sections.push(`You are responding after ${ctx.sourceAgentName} via a ${ctx.incoming.type} connection.`);
  }

  // For review/handoff, embed the source's actual output so the agent has the
  // content it was instructed to review/continue, regardless of the history
  // window — but skip it when that same output is already in the included
  // history (else it is sent twice).
  if (
    ctx.incoming &&
    (ctx.incoming.type === 'review' || ctx.incoming.type === 'handoff') &&
    ctx.sourceOutput?.trim() &&
    !sourceOutputAlreadyInHistory(ctx)
  ) {
    const label = ctx.sourceAgentName ?? 'The previous agent';
    sections.push(`${label}'s most recent response:\n${ctx.sourceOutput.trim()}`);
  }

  // Directed-question contract (spec extension: orchestration control). Placed
  // last before the response cue — the most specific instruction for this turn.
  if (ctx.pendingAgentDirective) {
    const { fromName, text, isReplyReturn } = ctx.pendingAgentDirective;
    if (isReplyReturn) {
      sections.push(
        `You previously asked ${fromName}: "${text.trim()}". ${fromName} has now answered — see their most recent message above. Continue your point using their answer.`,
      );
    } else {
      sections.push(
        [
          `${fromName} has put a question directly to YOU: "${text.trim()}"`,
          `Answer ${fromName}'s question first, directly and by name, before anything else.`,
          'If you cannot answer, state exactly what information you would need instead of deflecting.',
          'Keep this reply focused on the question — do not open a new line of discussion in this reply.',
        ].join(' '),
      );
    }
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

  // Moderator/summarizer/finalizer need the transcript to do their job, so their
  // kind overrides the per-agent includeHistory toggle (agentKind.overridesHistoryToggle).
  if (historyIncluded(ctx)) {
    for (const msg of ctx.history) {
      // Answer only — never feed thinking/reasoning to peer agents.
      const answer = visibleAnswerText(msg);
      if (!answer) continue;
      const isSelf = msg.agentId === ctx.agent.id;
      // Attribute peers with a `[Name]:` prefix so the flattened history stays
      // legible. The agent's OWN prior turns are sent unprefixed as assistant
      // messages — prefixing them trains the model to echo `[Name]:` on its next
      // reply, which then leaks verbatim into the transcript and peers' history.
      // A reply to a directed question carries who it answers, so later agents
      // understand why the turn order jumped.
      const attribution = msg.answeringTo
        ? `[${msg.agentName}, answering ${msg.answeringTo}]`
        : `[${msg.agentName}]`;
      messages.push({
        role: isSelf ? 'assistant' : 'user',
        content: isSelf ? answer : `${attribution}: ${answer}`,
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
  // Only messages that carry a visible answer count toward the window: failed/
  // empty turns (content '') are dropped at assembly anyway, so letting them
  // consume window slots would silently shrink an agent's real context.
  const withAnswers = transcript
    .map((m) => ({ m, answer: visibleAnswerText(m) }))
    .filter((x) => x.answer.length > 0);
  const recent = withAnswers.slice(-Math.max(1, windowSize));
  const result: TranscriptMessage[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    // Approximate the assembled size, including the `[Name]: ` attribution prefix.
    const len = recent[i].answer.length + recent[i].m.agentName.length + 4;
    if (chars + len > charBudget && result.length > 0) break;
    chars += len;
    result.unshift(recent[i].m);
  }
  return result;
}

/** Rough token estimate for display only (spec §11.6, §13). Clearly an estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
