import {
  type Playground,
  type Provider,
  Playground as PlaygroundSchema,
  PlaygroundExport as PlaygroundExportSchema,
} from '../domain/schema';
import { newAgentId, newConnectionId, newPlaygroundId, newProviderId, newSkillId } from '../domain/ids';
import { migrateToCurrent } from './migrate';

/**
 * Import/export serialization (spec §15.3, §21). Exports never include API keys;
 * imports are validated, migrated, and (optionally) re-ID'd as a copy.
 */

/** Max import size in bytes — guards against oversized/hostile files (spec §21). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function stripKey(provider: Provider): Omit<Provider, 'apiKey'> {
  // Structurally drop apiKey; also blank credentialStorage back to session so an
  // imported provider never claims a persisted key it doesn't have.
  const { apiKey: _apiKey, ...rest } = provider;
  return { ...rest, credentialStorage: 'session' };
}

/** Produce the credential-free export object (spec §15.3). */
export function toExport(playground: Playground) {
  const stripped = {
    ...playground,
    providers: playground.providers.map(stripKey),
  };
  // Validate against the export schema so a stray key can never slip through.
  return PlaygroundExportSchema.parse(stripped);
}

export function exportToJson(playground: Playground): string {
  return JSON.stringify(toExport(playground), null, 2);
}

export interface ImportResult {
  ok: boolean;
  playground?: Playground;
  /** Non-fatal warnings, e.g. agents referencing a missing provider (spec §15.3). */
  warnings: string[];
  error?: string;
}

/**
 * Parse and validate an imported playground JSON string.
 * When asCopy is true, all ids are regenerated so the import doesn't collide
 * with an existing playground (spec §15.3 "generate new IDs when importing as a copy").
 */
export function importFromJson(text: string, asCopy = true): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, warnings: [], error: 'File is too large to import.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, warnings: [], error: 'File is not valid JSON.' };
  }

  const migrated = migrateToCurrent(parsed);
  if (!migrated.ok) {
    return { ok: false, warnings: [], error: migrated.reason };
  }

  const validated = PlaygroundSchema.safeParse(migrated.data);
  if (!validated.success) {
    const first = validated.error.issues[0];
    return {
      ok: false,
      warnings: [],
      error: `Invalid playground structure: ${first?.path.join('.')} ${first?.message}`.trim(),
    };
  }

  let playground = validated.data;
  const warnings = collectWarnings(playground);

  if (asCopy) {
    playground = regenerateIds(playground);
  }

  return { ok: true, playground, warnings };
}

/** Report references that don't resolve, without failing the import (spec §15.3). */
function collectWarnings(pg: Playground): string[] {
  const warnings: string[] = [];
  const agentIds = new Set(pg.agents.map((a) => a.id));
  const providerIds = new Set(pg.providers.map((p) => p.id));

  for (const conn of pg.connections) {
    if (!agentIds.has(conn.source) || !agentIds.has(conn.target)) {
      warnings.push(`Connection ${conn.id} references a missing agent and will be dropped.`);
    }
  }
  for (const agent of pg.agents) {
    if (agent.llm.providerId && !providerIds.has(agent.llm.providerId)) {
      warnings.push(`Agent "${agent.name}" references a provider that is not in this file.`);
    }
  }
  return warnings;
}

/** Regenerate all ids, keeping internal references consistent (spec §15.3). */
export function regenerateIds(pg: Playground): Playground {
  const agentMap = new Map<string, string>();
  const providerMap = new Map<string, string>();
  // Old→new library-skill ids. Built before agents so each agent skill's
  // libraryId can be remapped; without this, a duplicated playground's agent
  // skills would alias the original's library entries.
  const libraryMap = new Map<string, string>();

  const providers = pg.providers.map((p) => {
    const id = newProviderId();
    providerMap.set(p.id, id);
    return { ...p, id };
  });

  const skillLibrary = pg.skillLibrary.map((s) => {
    const id = newSkillId();
    libraryMap.set(s.id, id);
    return { ...s, id };
  });

  const agents = pg.agents.map((a) => {
    const id = newAgentId();
    agentMap.set(a.id, id);
    return {
      ...a,
      id,
      // Fresh skill ids (so copies never alias) and remapped provenance pointers.
      skills: a.skills.map((sk) => ({
        ...sk,
        id: newSkillId(),
        libraryId: sk.libraryId ? libraryMap.get(sk.libraryId) : undefined,
      })),
      llm: {
        ...a.llm,
        providerId: a.llm.providerId ? providerMap.get(a.llm.providerId) ?? null : null,
      },
    };
  });

  // Drop connections whose endpoints didn't survive; remap the rest.
  const connections = pg.connections
    .filter((c) => agentMap.has(c.source) && agentMap.has(c.target))
    .map((c) => ({
      ...c,
      id: newConnectionId(),
      source: agentMap.get(c.source)!,
      target: agentMap.get(c.target)!,
    }));

  const startingAgentId = pg.conversation.startingAgentId
    ? agentMap.get(pg.conversation.startingAgentId) ?? null
    : null;

  return {
    ...pg,
    id: newPlaygroundId(),
    agents,
    connections,
    providers,
    skillLibrary,
    conversation: { ...pg.conversation, startingAgentId },
    // A fresh copy starts with no transcript history.
    transcript: [],
  };
}
