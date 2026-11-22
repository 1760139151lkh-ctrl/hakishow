/** 撤销与重做：对风格、滑块、细节、选中区域、版本或照片的每次可逆改动保存快照。快照是可序列化为 JSON 的对象，因此撤销历史能够随草稿保存，并在刷新后保留。示例：const u = createUndo({ snapshot, restore })；完成改动后执行 u.commit('切换为梦幻公主')；u.undo() 返回被撤销步骤的标签，供通知使用。 */
/** @template S @typedef {{ state: S, label: string }} Step */

/**
 * @template S
 * @param {{ snapshot: () => S, restore: (s: S) => void, limit?: number, onChange?: () => void }} o
 */
export function createUndo(o) {
  const limit = o.limit || 50;
  const snap = () => structuredClone(o.snapshot());
  /** @type {Step<S>[]} */ let past = [];
  /** @type {Step<S>[]} */ let future = [];
  let base = snap();
  const key = (/** @type {S} */ s) => JSON.stringify(s);
  const changed = () => o.onChange?.();
  return {
    /** 在改动后调用；跳过相同快照。 @param {string} label */
    commit(label) {
      const now = snap();
      if (key(now) === key(base)) return false;
      past.push({ state: base, label });
      if (past.length > limit) past.shift();
      future = [];
      base = now;
      changed();
      return true;
    },
    /** @returns {string | null} 被撤销步骤的标签。 */
    undo() {
      const step = past.pop();
      if (!step) return null;
      future.push({ state: base, label: step.label });
      base = step.state;
      o.restore(structuredClone(base));
      changed();
      return step.label;
    },
    /** @returns {string | null} 被重做步骤的标签。 */
    redo() {
      const step = future.pop();
      if (!step) return null;
      past.push({ state: base, label: step.label });
      base = step.state;
      o.restore(structuredClone(base));
      changed();
      return step.label;
    },
    /** 对齐到当前状态，不记录用户操作。 */
    rebase() { base = snap(); },
    /** 从新照片开始时重置历史。 */
    clear() { past = []; future = []; base = snap(); changed(); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get nextUndo() { return past.at(-1)?.label || ''; },
    get nextRedo() { return future.at(-1)?.label || ''; },
    /** 随草稿保存并恢复历史。 */
    dump() { return { past: past.slice(-30), future: future.slice(-30) }; },
    /** @param {{ past?: Step<S>[], future?: Step<S>[] } | null | undefined} d */
    load(d) { past = (d?.past || []).slice(-limit); future = (d?.future || []).slice(-limit); base = snap(); changed(); },
  };
}
