import type { TranscriptMessage } from '../../domain/schema';

/** Consecutive messages sharing a turn number, in chronological order. */
export interface TurnGroup {
  turn: number;
  messages: TranscriptMessage[];
}

/**
 * Group the (already chronological) transcript into contiguous runs by turn
 * number. A new turn value starts a new group; the same turn repeated later
 * (which shouldn't normally happen) starts a fresh group rather than merging.
 * Shared by the timeline renderer and the conversation exporters so both frame
 * turns identically.
 */
export function groupByTurn(transcript: TranscriptMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const msg of transcript) {
    const last = groups[groups.length - 1];
    if (last && last.turn === msg.turn) {
      last.messages.push(msg);
    } else {
      groups.push({ turn: msg.turn, messages: [msg] });
    }
  }
  return groups;
}

/**
 * A group is a user interjection when every message in it is user-authored
 * (`agentId === null`). Rendered distinctly (no "Turn N" divider) so a stepped-in
 * message reads as an aside, and legacy `turn: 0` interjections don't surface a
 * jarring "Turn 0" marker.
 */
export function isInterjectionGroup(group: TurnGroup): boolean {
  return group.messages.every((m) => m.agentId === null);
}
