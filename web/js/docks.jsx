/* ============================================================
   HELM — Left dock (queue/templates/repo/artifacts) + Right dock (inspector)
   ============================================================ */
const { useState: duseState } = React;
const he = React.createElement;

function DockSection({ title, count, defaultOpen = true, children, accent }) {
  const [open, setOpen] = duseState(defaultOpen);
  return he('div', { className: 'dock-section' + (open ? '' : ' collapsed') },
    he('div', { className: 'dock-section-head', onClick: () => setOpen(o => !o) },
      he('span', { className: 'label-caps', style: accent ? { color: accent } : null }, title,
        count != null && he('span', { className: 'sec-count' }, '  ' + count)),
      he('span', { className: 'chev' }, he(IconChevron, { size: 13 })),
    ),
    he('div', { className: 'dock-section-body' }, children),
  );
}

// ---- Task Queue ----
function TaskQueue({ tasks, activeId, onStart, onNewTask, onReorder }) {
  return he(DockSection, { title: 'Queue', count: tasks.length },
    tasks.map(t => he('div', {
        key: t.id, className: 'task-card' + (t.id === activeId ? ' active' : ''),
        draggable: true,
        onDragStart: (e) => e.dataTransfer.setData('tid', t.id),
        onDragOver: (e) => e.preventDefault(),
        onDrop: (e) => { e.preventDefault(); onReorder(parseInt(e.dataTransfer.getData('tid')), t.id); },
        onClick: () => onStart(t),
      },
      he('div', { className: 'tc-top' },
        he('span', { className: 'tc-id mono-num' }, '#0' + t.id),
        he('span', { className: 'badge ' + t.priority.toLowerCase() }, t.priority),
      ),
      he('div', { className: 'tc-title' }, t.title),
      he('div', { className: 'tc-meta' },
        he('span', { className: 'chip-cx' }, t.complexity),
        he('span', { className: 'status-dot-s ' + t.status }, t.status === 'in-progress' ? '\u25cf in progress' : t.status === 'done' ? '\u2713 done' : '\u25cb queued'),
      ),
    )),
    he('button', { className: 'dock-btn', onClick: onNewTask }, '+ New Task'),
  );
}

// ---- Templates ----
function Templates({ onUse }) {
  return he(DockSection, { title: 'Templates' },
    TEMPLATES.map((t, i) => he('div', { key: i, className: 'tmpl-row' },
      he('span', { className: 'ti' }, t.icon),
      he('div', null, he('div', { className: 'tn' }, t.name), he('div', { className: 'td' }, t.desc)),
      he('button', { className: 'tmpl-use', onClick: (e) => { e.stopPropagation(); onUse(t); } }, '\u25b6 Use'),
    )),
    he('button', { className: 'dock-btn', onClick: () => onUse({ name: 'Current', desc: 'saved' }) }, '+ Save Current'),
  );
}

// ---- Repo Navigator ----
function TreeNode({ node, depth, onOpenFile }) {
  const [open, setOpen] = duseState(node.open || false);
  const pad = { paddingLeft: 6 + depth * 14 };
  if (node.type === 'dir') {
    return he('div', null,
      he('div', { className: 'tmpl-row', style: { ...pad, padding: '4px 6px', paddingLeft: pad.paddingLeft }, onClick: () => setOpen(o => !o) },
        he('span', { className: 'chev', style: { transform: open ? 'none' : 'rotate(-90deg)', display: 'inline-flex' } }, he(IconChevron, { size: 11 })),
        he('span', { style: { color: 'var(--text-secondary)' } }, he(IconFolder, { size: 13 })),
        he('span', { className: 'tn', style: { fontSize: 11.5 } }, node.name),
      ),
      open && node.children && node.children.map((c, i) => he(TreeNode, { key: i, node: c, depth: depth + 1, onOpenFile })),
    );
  }
  const glow = node.touchedBy ? ROLE_META[node.touchedBy].color : null;
  return he('div', { className: 'tmpl-row', style: { ...pad, padding: '4px 6px', paddingLeft: pad.paddingLeft }, onClick: () => onOpenFile(node) },
    he('span', { style: { color: glow || 'var(--text-muted)' } }, he(IconFile, { size: 12 })),
    he('span', { className: 'tn', style: { fontSize: 11.5, color: glow || 'var(--text-primary)', textShadow: glow ? `0 0 8px ${rgba(glow,0.6)}` : 'none' } }, node.name),
  );
}
function RepoNav({ onOpenFile }) {
  return he(DockSection, { title: 'Repo', defaultOpen: false },
    REPO_TREE.map((n, i) => he(TreeNode, { key: i, node: n, depth: 0, onOpenFile })));
}

// ---- Artifacts Panel ----
const ART_FILTERS = ['All', 'Spec', 'Tasks', 'Reviews', 'Alerts'];
function matchFilter(a, f) {
  if (f === 'All') return true;
  if (f === 'Spec') return a.type === 'spec';
  if (f === 'Tasks') return a.type === 'task';
  if (f === 'Reviews') return ['suggestion', 'blocker', 'question'].includes(a.type);
  if (f === 'Alerts') return a.type === 'alert';
  return true;
}
function ArtifactsPanel({ artifacts, onOpen, resolvedBlockers }) {
  const [filter, setFilter] = duseState('All');
  const groups = [
    { key: 'alert', label: 'ALERTS', match: a => a.type === 'alert' },
    { key: 'blocker', label: 'BLOCKERS', match: a => a.type === 'blocker' },
    { key: 'spec', label: 'SPECS', match: a => a.type === 'spec' },
    { key: 'task', label: 'TASKS', match: a => a.type === 'task' },
    { key: 'brief', label: 'RESEARCH', match: a => a.type === 'brief' },
    { key: 'changelog', label: 'CHANGELOGS', match: a => a.type === 'changelog' },
    { key: 'question', label: 'QUESTIONS', match: a => a.type === 'question' },
    { key: 'suggestion', label: 'SUGGESTIONS', match: a => a.type === 'suggestion' },
    { key: 'test', label: 'TEST REPORTS', match: a => a.type === 'test' },
    { key: 'decision', label: 'DECISIONS', match: a => a.type === 'decision' },
  ];
  const visible = artifacts.filter(a => matchFilter(a, filter));
  return he(DockSection, { title: 'Artifacts', count: artifacts.length },
    he('div', { className: 'art-filters' },
      ART_FILTERS.map(f => he('button', { key: f, className: 'art-filter' + (filter === f ? ' on' : ''), onClick: () => setFilter(f) }, f))),
    groups.map(g => {
      const items = visible.filter(g.match);
      if (!items.length) return null;
      const meta = ARTIFACT_META[g.key];
      return he('div', { key: g.key },
        he('div', { className: 'art-group-label' },
          he('span', { style: { color: meta.color, fontSize: 12 } }, meta.icon),
          he('span', { className: 'agl', style: { color: meta.color } }, g.label, ' (' + items.length + ')')),
        items.map(a => {
          const unresolved = (a.type === 'blocker' && !resolvedBlockers.includes(a.id)) || a.type === 'question' || a.type === 'alert';
          return he('div', { key: a.id, className: 'art-row', style: { borderLeftColor: meta.color }, onClick: () => onOpen(a.id) },
            he('span', { className: 'ar-ico', style: { color: meta.color } }, meta.icon),
            he('span', { className: 'ar-title' }, a.title.replace(/^(Task #\d+: |Suggestion: |Blocker: |Alert: |Spec: |Decision: )/, '')),
            unresolved && he('span', { className: 'pulse-dot', style: { background: meta.color, color: meta.color } }),
            he('span', { className: 'ar-from' }, a.from.split(' ')[0]),
          );
        }),
      );
    }),
  );
}

function LeftDock(props) {
  if (props.collapsed) {
    return he('div', { className: 'dock-rail left' },
      he('button', { className: 'rail-btn', onClick: props.onToggle, title: 'Expand' }, he(IconPanelLeft, { size: 17 })),
      he('button', { className: 'rail-btn', title: 'Queue', style: { color: 'var(--role-helm)' } }, he(IconBolt, { size: 16 })),
      he('button', { className: 'rail-btn', title: 'Artifacts' }, he(IconFile, { size: 16 })),
      he('button', { className: 'rail-btn', title: 'Repo' }, he(IconFolder, { size: 16 })),
    );
  }
  return he('div', { className: 'dock dock-left area-left' },
    he('div', { className: 'dock-section-head', style: { borderBottom: '1px solid var(--helm-border)' } },
      he('span', { className: 'label-caps' }, 'Mission Control'),
      he('button', { className: 'icon-x', onClick: props.onToggle, title: 'Collapse' }, he(IconPanelLeft, { size: 15 }))),
    he('div', { className: 'dock-scroll' },
      he(TaskQueue, props.taskProps),
      he(Templates, { onUse: props.onUseTemplate }),
      he(ArtifactsPanel, props.artifactProps),
      he(RepoNav, { onOpenFile: props.onOpenFile }),
    ),
  );
}

Object.assign(window, { LeftDock, DockSection, TaskQueue, Templates, RepoNav, ArtifactsPanel });
