import type { ConversationMode, ConversationSettings } from './schema';

/**
 * UI metadata for the conversation-environment picker. The behavioural
 * directives the model actually receives live in agents/promptAssembly.ts
 * (CONVERSATION_MODE_DIRECTIVE, keyed by the same enum); these labels/hints are
 * the human-facing half. Order here is the display order in the dropdown.
 */
export interface ConversationModeMeta {
  value: ConversationMode;
  label: string;
  hint: string;
}

export const CONVERSATION_MODES: ConversationModeMeta[] = [
  { value: 'open', label: 'Open discussion', hint: 'No special framing — each agent follows its own role.' },
  { value: 'brainstorm', label: 'Brainstorming', hint: 'Diverge and pile up ideas; hold criticism for later.' },
  { value: 'critique', label: 'Critique / red-team', hint: 'Stress-test ideas: assumptions, risks, failure modes.' },
  { value: 'debate', label: 'Debate', hint: 'Take and defend positions; steelman before rebutting.' },
  { value: 'planning', label: 'Planning', hint: 'Break the objective into concrete, ordered steps.' },
  { value: 'decision', label: 'Decision', hint: 'Weigh options and converge on one recommendation.' },
  { value: 'retrospective', label: 'Retrospective', hint: "What went well, what didn't, what to change." },
  { value: 'postmortem', label: 'Blameless postmortem', hint: 'Timeline, root causes, preventions — no blame.' },
  { value: 'socratic', label: 'Socratic', hint: 'Advance mainly by asking probing questions.' },
];

/**
 * Curated quick-start bundles for the Run dialog. Selecting one applies a small
 * partial patch of *style* settings only — the environment mode plus supporting
 * tone/length/chit-chat/temperature. They deliberately never touch the run's
 * content (subject/objective/…) or its budget (turn caps, stop-on-error,
 * timeout), so clicking one can't silently undo limits the user already set.
 * Apply via `updateConversation(patch)`, NOT the full-snapshot applyRunPreset.
 */
export interface QuickStartPreset {
  id: string;
  label: string;
  description: string;
  patch: Partial<
    Pick<ConversationSettings, 'conversationMode' | 'toneOverride' | 'responseLength' | 'chitchatPolicy' | 'temperatureOverride'>
  >;
}

export const QUICK_START_PRESETS: QuickStartPreset[] = [
  {
    id: 'qs_brainstorm',
    label: 'Brainstorm',
    description: 'Diverge, defer judgement, generate lots of ideas.',
    patch: { conversationMode: 'brainstorm', chitchatPolicy: 'agent-default', responseLength: 'medium', temperatureOverride: 0.9 },
  },
  {
    id: 'qs_devils_advocate',
    label: "Devil's advocate",
    description: 'Red-team the ideas: surface risks and weak assumptions.',
    patch: { conversationMode: 'critique', chitchatPolicy: 'concise-factual', responseLength: 'medium', temperatureOverride: 0.3 },
  },
  {
    id: 'qs_debate',
    label: 'Structured debate',
    description: 'Opposing positions, steelmanned then rebutted.',
    patch: { conversationMode: 'debate', chitchatPolicy: 'agent-default', responseLength: 'medium', temperatureOverride: 0.6 },
  },
  {
    id: 'qs_decision',
    label: 'Decision panel',
    description: 'Weigh options against criteria; converge on one call.',
    patch: { conversationMode: 'decision', chitchatPolicy: 'concise-factual', responseLength: 'medium', temperatureOverride: 0.3 },
  },
  {
    id: 'qs_retro',
    label: 'Sprint retro',
    description: "What went well, what didn't, concrete actions.",
    patch: { conversationMode: 'retrospective', chitchatPolicy: 'agent-default', responseLength: 'medium', temperatureOverride: 0.5 },
  },
  {
    id: 'qs_postmortem',
    label: 'Blameless postmortem',
    description: 'Timeline, root causes, and preventions — no blame.',
    patch: { conversationMode: 'postmortem', chitchatPolicy: 'concise-factual', responseLength: 'long', temperatureOverride: 0.2 },
  },
  {
    id: 'qs_concise',
    label: 'Concise & factual',
    description: 'Short, strict, sourced — no small talk or flattery.',
    patch: { conversationMode: 'open', chitchatPolicy: 'concise-factual', responseLength: 'short', temperatureOverride: 0.2 },
  },
];
