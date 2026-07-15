import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createRunPreset, defaultConversationSettings } from '../../domain/factories';

/**
 * Run preset round-trip via fake-indexeddb, exercising the real db.ts paths:
 * the fourth object store created on the v3 upgrade, save/list/delete, and the
 * corrupted-record skip. Mirrors agentLibrary.test.ts's approach of a fresh
 * factory + module reset per test since db.ts holds a single module-level
 * connection.
 */

type DbModule = typeof import('../db');

async function freshDb(): Promise<DbModule> {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  return import('../db');
}

describe('run preset round-trip', () => {
  it('saves, lists, and deletes a run preset', async () => {
    const db = await freshDb();
    const older = createRunPreset('Terse', { ...defaultConversationSettings(), chitchatPolicy: 'concise-factual' });
    const newer = {
      ...createRunPreset('Playful', { ...defaultConversationSettings(), toneOverride: 'playful' }),
      savedAt: older.savedAt + 1000,
    };

    await db.saveRunPreset(older);
    await db.saveRunPreset(newer);

    const all = await db.loadAllRunPresets();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.name).sort()).toEqual(['Playful', 'Terse']);

    await db.deleteRunPreset(older.id);
    const remaining = await db.loadAllRunPresets();
    expect(remaining.map((p) => p.id)).toEqual([newer.id]);
  });

  it('preserves the settings payload, excluding subject/objective/context/startingAgentId', () => {
    const preset = createRunPreset('X', {
      ...defaultConversationSettings(),
      subject: 'should not be saved',
      temperatureOverride: 0.4,
    });
    expect(preset.settings).not.toHaveProperty('subject');
    expect(preset.settings.temperatureOverride).toBe(0.4);
  });

  it('skips a corrupted run preset record instead of throwing', async () => {
    const db = await freshDb();
    const good = createRunPreset('Good', defaultConversationSettings());
    await db.saveRunPreset(good);

    // Poke a structurally invalid record straight into the store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground');
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('runPresets', 'readwrite');
        tx.objectStore('runPresets').put({ id: 'rp_broken', schemaVersion: 1 /* missing settings */ });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const all = await db.loadAllRunPresets();
    expect(all.some((p) => p.id === good.id)).toBe(true);
    expect(all.some((p) => p.id === 'rp_broken')).toBe(false);
  });
});
