import { useRef, useState } from 'react';
import type { LibrarySkill } from '../domain/schema';
import { useDomainStore } from '../store/domainStore';
import { useUiStore } from '../store/uiStore';
import { createLibrarySkill } from '../domain/factories';
import { exportSkillSet, importSkillSet } from '../persistence/skillSets';
import { downloadJson } from './fileDownload';
import { Modal } from './Modal';
import styles from './ProviderManager.module.css';

/**
 * Skill library manager (spec §7.2). The reusable catalog of declared skills a
 * playground offers to its agents. Skills here are templates — attaching one to
 * an agent copies it (see AgentInspector). Import appends; export writes the
 * whole catalog. Master/detail layout mirrors the provider manager.
 */
export function SkillLibraryManager() {
  const playground = useDomainStore((s) => s.playground)!;
  const addLibrarySkill = useDomainStore((s) => s.addLibrarySkill);
  const updateLibrarySkill = useDomainStore((s) => s.updateLibrarySkill);
  const removeLibrarySkill = useDomainStore((s) => s.removeLibrarySkill);
  const setSkillLibrary = useDomainStore((s) => s.setSkillLibrary);
  const setPanel = useUiStore((s) => s.setPanel);
  const showToast = useUiStore((s) => s.showToast);

  const skills = playground.skillLibrary;
  const [selectedId, setSelectedId] = useState<string | null>(skills[0]?.id ?? null);
  const selected = skills.find((s) => s.id === selectedId) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const skill = createLibrarySkill();
    addLibrarySkill(skill);
    setSelectedId(skill.id);
  }

  function handleDuplicate(skill: LibrarySkill) {
    const copy = createLibrarySkill({
      name: `${skill.name} (copy)`,
      description: skill.description,
      instruction: skill.instruction,
    });
    addLibrarySkill(copy);
    setSelectedId(copy.id);
  }

  function handleDelete(skill: LibrarySkill) {
    if (!window.confirm(`Delete skill "${skill.name}"? Agents that copied it keep their own copy.`)) return;
    removeLibrarySkill(skill.id);
    setSelectedId(skills.find((s) => s.id !== skill.id)?.id ?? null);
  }

  function handleExport() {
    if (skills.length === 0) {
      showToast('warn', 'The library is empty — nothing to export.');
      return;
    }
    downloadJson(`${playground.name || 'playground'}-skill-library`, exportSkillSet(skills));
  }

  async function handleImport(file: File) {
    const result = importSkillSet(await file.text());
    if (!result.ok) {
      showToast('error', result.error ?? 'Import failed.');
      return;
    }
    // Append: imported skills already carry fresh ids from importSkillSet.
    setSkillLibrary([...skills, ...result.skills]);
    if (result.skills[0]) setSelectedId(result.skills[0].id);
    showToast('info', `Imported ${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}.`);
  }

  return (
    <Modal title="Skill library" onClose={() => setPanel('none')} width={720}>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Reusable declared capabilities — not executable tools. Attach these to agents from the
        agent inspector; each agent keeps its own editable copy.
      </p>
      <div className={styles.layout}>
        <div className={styles.list}>
          <button type="button" className={`primary ${styles.addBtn}`} onClick={handleAdd}>
            + Add skill
          </button>
          {skills.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No skills yet.</p>}
          {skills.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.listItem} ${s.id === selectedId ? styles.listActive : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className={styles.listName}>{s.name || '(unnamed)'}</span>
            </button>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={handleExport} style={{ flex: 1 }}>Export</button>
            <button type="button" onClick={() => fileInput.current?.click()} style={{ flex: 1 }}>Import</button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className={styles.editor}>
          {selected ? (
            <SkillEditor
              key={selected.id}
              skill={selected}
              onChange={(patch) => updateLibrarySkill(selected.id, patch)}
              onDuplicate={() => handleDuplicate(selected)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <p className="muted">Select or add a skill.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SkillEditor({
  skill,
  onChange,
  onDuplicate,
  onDelete,
}: {
  skill: LibrarySkill;
  onChange: (patch: Partial<LibrarySkill>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div>
      <div className={styles.editorActions}>
        <strong>Edit skill</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="sk-name">Name</label>
        <input id="sk-name" value={skill.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="sk-desc">Short description</label>
        <input id="sk-desc" value={skill.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="sk-inst">Instruction text</label>
        <textarea
          id="sk-inst"
          rows={4}
          placeholder="Merged into an agent's system prompt when the copied skill is enabled."
          value={skill.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
        />
      </div>
    </div>
  );
}
