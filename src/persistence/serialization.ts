import {
  type Playground,
  type Provider,
  PlaygroundExport as PlaygroundExportSchema,
} from '../domain/schema';
import { newAgentId, newConnectionId, newPlaygroundId } from '../domain/ids';
import { migrateToCurrent } from './migrate';

/**
 * Import/export serialization (spec §15.3, §21). Providers are application-global
 * (schema v2), but an exported file re-embeds the providers its agents reference
 * so the file stays self-contained and portable; imports merge those providers
 * back into the global registry. Exports never include API keys.
 */

/** Max import size in bytes — guards against oversized/hostile files (spec §21). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function stripKey(provider: Provider): Omit<Provider, 'apiKey'> {
  // Structurally drop apiKey; also blank credentialStorage back to session so an
  // imported provider never claims a persisted key it doesn't have.
  const { apiKey: _apiKey, ...rest } = provider;
  return { ...rest, credentialStorage: 'session' };
}

/** The subset of the global registry referenced by this playground's agents. */
function referencedProviders(playground: Playground, providers: Provider[]): Provider[] {
  const usedIds = new Set(
    playground.agents.map((a) => a.llm.providerId).filter((id): id is string => Boolean(id)),
  );
  return providers.filter((p) => usedIds.has(p.id));
}

/**
 * Produce the credential-free export object (spec §15.3): the playground plus the
 * providers its agents use, key-stripped.
 */
export function toExport(playground: Playground, providers: Provider[]) {
  const stripped = {
    ...playground,
    providers: referencedProviders(playground, providers).map(stripKey),
  };
  // Validate against the export schema so a stray key can never slip through.
  return PlaygroundExportSchema.parse(stripped);
}

export function exportToJson(playground: Playground, providers: Provider[]): string {
  return JSON.stringify(toExport(playground, providers), null, 2);
}

export interface ImportResult {
  ok: boolean;
  playground?: Playground;
  /** Providers embedded in the file, to be merged into the global registry. */
  providers?: Provider[];
  /** Non-fatal warnings, e.g. agents referencing a missing provider (spec §15.3). */
  warnings: string[];
  error?: string;
}

/**
 * Parse and validate an imported playground JSON string. The embedded providers
 * are returned separately (as `providers`) for the caller to merge into the
 * global registry; the returned `playground` carries none.
 *
 * When asCopy is true, playground/agent/connection ids are regenerated so the
 * import doesn't collide with an existing playground (spec §15.3). Provider ids
 * are deliberately preserved so the merge can dedupe against providers already in
 * the registry and agents' `providerId` references keep resolving.
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

  const validated = PlaygroundExportSchema.safeParse(migrated.data);
  if (!validated.success) {
    const first = validated.error.issues[0];
    return {
      ok: false,
      warnings: [],
      error: `Invalid playground structure: ${first?.path.join('.')} ${first?.message}`.trim(),
    };
  }

  // Split the embedded providers off; the domain Playground carries none.
  const { providers, ...pgData } = validated.data;
  const validatedPg = pgData as Playground;

  // Warnings describe what will be dropped, so collect them before pruning.
  const warnings = collectWarnings(validatedPg, providers);

  // Always drop dangling connections so the result matches the warning, on both
  // the copy and non-copy paths (regenerateIds also prunes, so this is idempotent).
  let playground = pruneDanglingConnections(validatedPg);

  if (asCopy) {
    playground = regenerateIds(playground);
  }

  return { ok: true, playground, providers, warnings };
}

/** Drop connections whose source or target agent is not present (spec §15.3). */
export function pruneDanglingConnections(pg: Playground): Playground {
  const agentIds = new Set(pg.agents.map((a) => a.id));
  const connections = pg.connections.filter(
    (c) => agentIds.has(c.source) && agentIds.has(c.target),
  );
  return connections.length === pg.connections.length ? pg : { ...pg, connections };
}

/** Report references that don't resolve, without failing the import (spec §15.3). */
function collectWarnings(pg: Playground, providers: Provider[]): string[] {
  const warnings: string[] = [];
  const agentIds = new Set(pg.agents.map((a) => a.id));
  const providerIds = new Set(providers.map((p) => p.id));

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

/**
 * Regenerate playground/agent/connection ids, keeping internal references
 * consistent (spec §15.3). Providers are application-global, so `llm.providerId`
 * references are preserved unchanged.
 */
export function regenerateIds(pg: Playground): Playground {
  const agentMap = new Map<string, string>();

  const agents = pg.agents.map((a) => {
    const id = newAgentId();
    agentMap.set(a.id, id);
    return { ...a, id };
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
    conversation: { ...pg.conversation, startingAgentId },
    // A fresh copy starts with no transcript history.
    transcript: [],
  };
}
