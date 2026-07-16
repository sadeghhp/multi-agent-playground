import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const playground = useDomainStore((s) => s.playground);
  const addLibrarySkill = useDomainStore((s) => s.addLibrarySkill);
  const updateLibrarySkill = useDomainStore((s) => s.updateLibrarySkill);
  const removeLibrarySkill = useDomainStore((s) => s.removeLibrarySkill);
  const setSkillLibrary = useDomainStore((s) => s.setSkillLibrary);
  const setPanel = useUiStore((s) => s.setPanel);
  const showToast = useUiStore((s) => s.showToast);
  const requestConfirm = useUiStore((s) => s.requestConfirm);

  const skills = playground?.skillLibrary ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(skills[0]?.id ?? null);
  const selected = skills.find((s) => s.id === selectedId) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);

  // Guarded defensively (after all hooks, to satisfy the Rules of Hooks) — the
  // toolbar disables the trigger for this panel while no playground is
  // active, but this must not crash if it's ever reached some other way (e.g.
  // a future UI path, restored panel state).
  if (!playground) return null;

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

  async function handleDelete(skill: LibrarySkill) {
    const ok = await requestConfirm({
      title: t('skills.deleteTitle'),
      message: t('skills.deleteMessage', { name: skill.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    removeLibrarySkill(skill.id);
    setSelectedId(skills.find((s) => s.id !== skill.id)?.id ?? null);
  }

  function handleExport() {
    if (skills.length === 0) {
      showToast('warn', t('skills.emptyExport'));
      return;
    }
    downloadJson(`${playground?.name || 'playground'}-skill-library`, exportSkillSet(skills));
  }

  async function handleImport(file: File) {
    const result = importSkillSet(await file.text());
    if (!result.ok) {
      showToast('error', result.error ?? t('skills.importFailed'));
      return;
    }
    // Append: imported skills already carry fresh ids from importSkillSet.
    setSkillLibrary([...skills, ...result.skills]);
    if (result.skills[0]) setSelectedId(result.skills[0].id);
    showToast('info', t('skills.imported', { count: result.skills.length }));
  }

  return (
    <Modal title={t('skills.title')} onClose={() => setPanel('none')} width={720}>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        {t('skills.intro')}
      </p>
      <div className={styles.layout}>
        <div className={styles.list}>
          <button type="button" className={`primary ${styles.addBtn}`} onClick={handleAdd}>
            {t('skills.addSkill')}
          </button>
          {skills.length === 0 && <p className="muted" style={{ fontSize: 12 }}>{t('skills.noSkills')}</p>}
          {skills.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.listItem} ${s.id === selectedId ? styles.listActive : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className={styles.listName} dir="auto">{s.name || t('skills.unnamed')}</span>
            </button>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={handleExport} style={{ flex: 1 }}>{t('skills.export')}</button>
            <button type="button" onClick={() => fileInput.current?.click()} style={{ flex: 1 }}>{t('skills.import')}</button>
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
            <p className="muted">{t('skills.selectOrAdd')}</p>
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
  const { t } = useTranslation();
  return (
    <div>
      <div className={styles.editorActions}>
        <strong>{t('skills.editSkill')}</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onDuplicate}>{t('skills.duplicate')}</button>
          <button type="button" className="danger" onClick={onDelete}>{t('common.delete')}</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="sk-name">{t('skills.nameLabel')}</label>
        <input id="sk-name" dir="auto" value={skill.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="sk-desc">{t('skills.descLabel')}</label>
        <input id="sk-desc" dir="auto" value={skill.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="sk-inst">{t('skills.instructionLabel')}</label>
        <textarea
          id="sk-inst"
          rows={4}
          dir="auto"
          placeholder={t('skills.instructionPlaceholder')}
          value={skill.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
        />
      </div>
    </div>
  );
}
