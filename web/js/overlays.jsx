/* ============================================================
   HELM — Overlays: Artifact Viewer, Optimize drawer, New Task,
   Toasts, Workflow Builder, generic confirm
   ============================================================ */
const ov = React.createElement;
const { useState: ouseState } = React;

// ---------- Artifact Viewer ----------
function ArtifactViewer({ id, onClose, onOpen, onResolveBlocker, onAcceptSuggestion, onAnswerQuestion, resolvedBlockers }) {
  const a = artById(id);
  if (!a) return null;
  const meta = ARTIFACT_META[a.type];

  const linked = [];
  if (a.derived) linked.push({ dir: '\u2191 Derived from', id: a.derived });
  if (a.sentTo) linked.push({ dir: '\u2192 Sent to', id: null, label: a.sentTo });
  if (a.produced) linked.push({ dir: '\u2193 Produced', id: a.produced });

  // review sub-type structured body
  let structured = null;
  if (a.type === 'suggestion') {
    structured = ov('div', null,
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'File'), ov('span', { className: 'v' }, a.file)),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Line'), ov('span', { className: 'v' }, a.line)),
      ov('div', { className: 'md-content', style: { margin: '12px 0' } }, ov('p', null, '\u201c' + a.content + '\u201d')),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Impact'), ov('span', { className: 'v' }, a.impact)),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Effort'), ov('span', { className: 'v' }, a.effort)),
      ov('div', { style: { display: 'flex', gap: 8, marginTop: 14 } },
        ov('button', { className: 'btn-primary', style: { flex: 1, background: 'var(--role-helm)', color: '#1a1206' }, onClick: () => { onAcceptSuggestion(a.id); onClose(); } }, 'Accept'),
        ov('button', { className: 'btn-ghost', style: { flex: 1 }, onClick: onClose }, 'Dismiss'),
        ov('button', { className: 'btn-ghost', style: { flex: 1 }, onClick: onClose }, 'Discuss \u2192')),
    );
  } else if (a.type === 'blocker') {
    const resolved = resolvedBlockers.includes(a.id);
    structured = ov('div', null,
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Blocking'), ov('span', { className: 'v', style: { color: 'var(--status-error)' } }, 'Task #' + a.blocks)),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Severity'), ov('span', { className: 'v', style: { color: 'var(--status-error)' } }, a.severity)),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'File'), ov('span', { className: 'v' }, a.file)),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Line'), ov('span', { className: 'v' }, a.line)),
      ov('div', { className: 'md-content', style: { margin: '12px 0' } }, renderMarkdown(a.content)),
      resolved
        ? ov('div', { style: { padding: 10, borderRadius: 7, background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.4)', color: 'var(--role-qa)', fontSize: 12, textAlign: 'center' } }, '\u2713 Resolved \u2014 Dev fix delivered & re-reviewed')
        : ov('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
            ov('button', { className: 'btn-ghost', style: { flex: 1 }, onClick: onClose }, 'View Code'),
            ov('button', { className: 'btn-primary', style: { flex: 1 }, onClick: () => { onResolveBlocker(a.id); onClose(); } }, 'Assign Fix \u2192 Dev')),
    );
  } else if (a.type === 'question') {
    structured = ov('div', null,
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Directed at'), ov('span', { className: 'v' }, a.directedAt)),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Re'), ov('span', { className: 'v' }, a.re)),
      ov('div', { className: 'md-content', style: { margin: '12px 0' } }, ov('p', null, '\u201c' + a.content + '\u201d')),
      ov('div', { className: 'kv' }, ov('span', { className: 'k' }, 'Awaiting'), ov('span', { className: 'v', style: { color: 'var(--role-dev)' } }, a.awaiting)),
      ov('div', { style: { display: 'flex', gap: 8, marginTop: 14 } },
        ov('button', { className: 'btn-primary', style: { flex: 1 }, onClick: () => { onAnswerQuestion(a.id, 'user'); onClose(); } }, 'Answer as User'),
        ov('button', { className: 'btn-ghost', style: { flex: 1 }, onClick: () => { onAnswerQuestion(a.id, 'route'); onClose(); } }, 'Route to ' + a.awaiting + ' \u2192')),
    );
  }

  return ov('div', { className: 'scrim', onClick: onClose },
    ov('div', { className: 'modal artview', onClick: e => e.stopPropagation() },
      ov('div', { className: 'artview-head' },
        ov('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          ov('div', null,
            ov('span', { className: 'artview-badge', style: { background: rgba(meta.color, 0.15), color: meta.color } }, meta.icon, ' ', meta.label),
            ov('div', { className: 'artview-title' }, a.title.replace(/^(Task #\d+: |Suggestion: |Blocker: |Alert: )/, '')),
            ov('div', { className: 'artview-meta' }, 'by ' + a.from + '  \u00b7  ' + (a.role ? ROLE_META[a.role].name : ''))),
          ov('button', { className: 'icon-x', onClick: onClose }, '\u2715')),
      ),
      ov('div', { className: 'artview-body' },
        structured || ov('div', { className: 'md-content' }, renderMarkdown(a.content))),
      linked.length > 0 && ov('div', { className: 'linked-arts' },
        ov('div', { className: 'insp-block-label', style: { marginBottom: 8 } }, 'LINKED ARTIFACTS'),
        linked.map((lk, i) => ov('div', { key: i, className: 'linked-row', onClick: () => lk.id && onOpen(lk.id) },
          ov('span', { className: 'lr-dir' }, lk.dir + ':'),
          ov('span', null, lk.id ? (artById(lk.id) ? artById(lk.id).title.replace(/^(Task #\d+: )/, '') : lk.id) : lk.label)))),
      ov('div', { className: 'artview-foot' },
        ov('button', null, 'Export .md'),
        ov('button', null, 'Copy'),
        ov('button', null, 'Archive')),
    ),
  );
}

// ---------- Optimize Drawer ----------
function OptimizeDrawer({ onClose, baseTokens, onApply }) {
  const optimized = Math.round(baseTokens * 0.62);
  const savePct = Math.round((1 - optimized / baseTokens) * 100);
  return ov('div', { className: 'drawer', style: { width: 360 } },
    ov('div', { className: 'drawer-head' },
      ov('div', { className: 'drawer-title', style: { color: 'var(--role-helm)' } }, ov(IconBulb, { size: 16 }), 'OPTIMIZE MODE'),
      ov('button', { className: 'icon-x', onClick: onClose }, '\u2715')),
    ov('div', { className: 'drawer-body' },
      ov('div', { className: 'insp-block-label' }, 'CURRENT RUN ESTIMATE'),
      ov('div', { className: 'opt-estimate' },
        ov('div', { className: 'opt-row' }, ov('span', { className: 'ok' }, 'Tokens'), ov('span', { className: 'ov' }, baseTokens.toLocaleString())),
        ov('div', { className: 'opt-row' }, ov('span', { className: 'ok' }, 'Cost'), ov('span', { className: 'ov' }, fmtCost(baseTokens))),
        ov('div', { className: 'opt-row' }, ov('span', { className: 'ok' }, 'Time'), ov('span', { className: 'ov' }, '~4m 20s'))),

      ov('div', { className: 'insp-block-label', style: { marginTop: 6 } }, 'SAVINGS OPPORTUNITIES'),
      ov('div', { className: 'opt-card' },
        ov('div', { className: 'oc-head' }, ov('span', { style: { color: 'var(--role-helm)' } }, '\u26a0'), 'Dev Team (3 agents)'),
        ov('div', { className: 'oc-sub' }, 'Could be 1 agent'),
        ov('div', { className: 'oc-save' }, 'Save: ~12,400 tokens \u00b7 ~$0.05'),
        ov('button', { className: 'opt-apply-btn' }, 'Compress \u2192 Single')),
      ov('div', { className: 'opt-card' },
        ov('div', { className: 'oc-head' }, ov('span', { style: { color: 'var(--role-helm)' } }, '\u26a0'), 'QA Team running parallel'),
        ov('div', { className: 'oc-sub' }, 'Could run sequentially'),
        ov('div', { className: 'oc-save' }, 'Save: ~6,200 tokens'),
        ov('button', { className: 'opt-apply-btn' }, 'Make Sequential')),

      ov('div', { className: 'insp-block-label', style: { marginTop: 6 } }, 'OPTIMIZED ESTIMATE'),
      ov('div', { className: 'opt-estimate optimized' },
        ov('div', { className: 'opt-row' }, ov('span', { className: 'ok' }, 'Tokens'), ov('span', { className: 'save' }, optimized.toLocaleString() + ' (\u2193 ' + savePct + '%)')),
        ov('div', { className: 'opt-row' }, ov('span', { className: 'ok' }, 'Cost'), ov('span', { className: 'save' }, fmtCost(optimized))),
        ov('div', { className: 'opt-row' }, ov('span', { className: 'ok' }, 'Time'), ov('span', { className: 'save' }, '~3m 10s'))),

      ov('button', { className: 'opt-cta primary', onClick: onApply }, 'Apply All Optimizations'),
      ov('button', { className: 'opt-cta ghost', onClick: onClose }, 'Apply Selected'),
    ),
  );
}

// ---------- New Task Modal ----------
function NewTaskModal({ onClose, onCreate }) {
  const [title, setTitle] = ouseState('');
  const [desc, setDesc] = ouseState('');
  const [pri, setPri] = ouseState('P1');
  const [cx, setCx] = ouseState('M');
  return ov('div', { className: 'scrim', onClick: onClose },
    ov('div', { className: 'modal task-modal', onClick: e => e.stopPropagation() },
      ov('div', { className: 'tm-head' }, 'New Task', ov('button', { className: 'icon-x', onClick: onClose }, '\u2715')),
      ov('div', { className: 'tm-body' },
        ov('div', { className: 'field' },
          ov('label', { className: 'field-label' }, 'Title'),
          ov('input', { autoFocus: true, placeholder: 'e.g. Add password reset flow', value: title, onChange: e => setTitle(e.target.value) })),
        ov('div', { className: 'field' },
          ov('label', { className: 'field-label' }, 'Description'),
          ov('textarea', { rows: 3, placeholder: 'What needs to happen, constraints, acceptance criteria\u2026', value: desc, onChange: e => setDesc(e.target.value) })),
        ov('div', { style: { display: 'flex', gap: 14 } },
          ov('div', { className: 'field', style: { flex: 1 } },
            ov('label', { className: 'field-label' }, 'Priority'),
            ov('div', { className: 'seg' }, ['P1', 'P2', 'P3'].map(p => ov('button', { key: p, className: pri === p ? 'on' : '', onClick: () => setPri(p) }, p)))),
          ov('div', { className: 'field', style: { flex: 1 } },
            ov('label', { className: 'field-label' }, 'Complexity'),
            ov('div', { className: 'seg' }, ['S', 'M', 'L', 'XL'].map(c => ov('button', { key: c, className: cx === c ? 'on' : '', onClick: () => setCx(c) }, c)))),
        ),
      ),
      ov('div', { className: 'tm-foot' },
        ov('button', { className: 'btn-ghost', onClick: onClose }, 'Cancel'),
        ov('button', { className: 'btn-primary', onClick: () => onCreate({ title: title || 'Untitled task', priority: pri, complexity: cx }) }, 'Create Task')),
    ),
  );
}

// ---------- Toasts ----------
function ToastStack({ toasts, onDismiss }) {
  return ov('div', { className: 'toast-stack' },
    toasts.map(t => ov('div', { key: t.id, className: 'toast', onClick: () => onDismiss(t.id) },
      ov('div', { className: 't-head' }, '\u26a0 ' + (t.head || 'WATCHMEN ALERT')),
      ov('div', { className: 't-body' }, t.body))));
}

// ---------- Confirm dialog ----------
function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  return ov('div', { className: 'scrim', onClick: onClose },
    ov('div', { className: 'modal', style: { width: 380, padding: 0 }, onClick: e => e.stopPropagation() },
      ov('div', { className: 'tm-head' }, title, ov('button', { className: 'icon-x', onClick: onClose }, '\u2715')),
      ov('div', { style: { padding: '16px 18px', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 } }, body),
      ov('div', { className: 'tm-foot' },
        ov('button', { className: 'btn-ghost', onClick: onClose }, 'Cancel'),
        ov('button', { className: 'btn-primary', style: danger ? { background: 'var(--status-error)', color: '#fff' } : null, onClick: onConfirm }, confirmLabel || 'Confirm'))),
  );
}

// ---------- Workflow Builder (lightweight) ----------
const WF_PALETTE = [
  { role: 'helm', label: 'Tech Lead' }, { role: 'dev', label: 'Frontend Agent' },
  { role: 'dev', label: 'Backend Agent' }, { role: 'qa', label: 'QA Agent' },
  { role: 'research', label: 'Infra Agent' }, { role: 'research', label: 'Data Agent' },
];
function WorkflowBuilder({ onClose, onRun }) {
  const [nodes, setNodes] = ouseState([
    { id: 1, role: 'helm', label: 'Tech Lead', x: 360, y: 40 },
    { id: 2, role: 'research', label: 'Research Agent', x: 140, y: 200 },
    { id: 3, role: 'dev', label: 'Frontend Agent', x: 360, y: 200 },
    { id: 4, role: 'qa', label: 'QA Agent', x: 580, y: 200 },
  ]);
  const [budget, setBudget] = ouseState(40);
  const drag = React.useRef(null);
  const addNode = (p) => setNodes(ns => [...ns, { id: Date.now(), role: p.role, label: p.label, x: 280 + Math.random() * 120, y: 320 }]);
  const edges = [[1, 2], [1, 3], [1, 4], [2, 3], [3, 4]];
  const center = (n) => ({ x: n.x + 75, y: n.y + 22 });

  return ov('div', { className: 'scrim', onClick: onClose },
    ov('div', { className: 'modal wf-overlay', onClick: e => e.stopPropagation() },
      ov('div', { className: 'wf-head' },
        ov('div', { className: 'drawer-title' }, '\u2389 WORKFLOW BUILDER'),
        ov('div', { style: { display: 'flex', gap: 8 } },
          ov('button', { className: 'btn-ghost' }, '\u23f1 Estimate'),
          ov('button', { className: 'btn-ghost' }, '\ud83d\udcbe Save as Template'),
          ov('button', { className: 'btn-primary', onClick: onRun }, '\u25b6 Run'),
          ov('button', { className: 'icon-x', onClick: onClose }, '\u2715')),
      ),
      ov('div', { className: 'wf-body' },
        ov('div', { className: 'wf-left' },
          ov('div', { className: 'insp-block-label' }, 'TASK DESCRIPTION'),
          ov('textarea', { className: '', rows: 3, defaultValue: 'Implement OAuth login flow with PKCE + httpOnly refresh tokens.',
            style: { width: '100%', background: 'var(--helm-surface-2)', border: '1px solid var(--helm-border)', borderRadius: 6, padding: 10, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 12, marginBottom: 16 } }),
          ov('div', { className: 'wf-slider-row' },
            ov('div', { className: 'insp-block-label' }, 'TOKEN BUDGET: ' + budget + 'k'),
            ov('input', { type: 'range', min: 10, max: 120, value: budget, onChange: e => setBudget(+e.target.value) })),
          ov('div', { className: 'insp-block-label', style: { marginTop: 8 } }, 'NODE PALETTE'),
          WF_PALETTE.map((p, i) => ov('div', { key: i, className: 'wf-palette-node', onClick: () => addNode(p) },
            ov('span', { style: { color: ROLE_META[p.role].color, fontSize: 14 } }, ROLE_META[p.role].icon),
            ov('span', null, p.label),
            ov('span', { style: { marginLeft: 'auto', color: 'var(--text-muted)' } }, '+'))),
        ),
        ov('div', { className: 'wf-canvas', id: 'wf-canvas',
            onMouseMove: (e) => { if (drag.current) { const r = e.currentTarget.getBoundingClientRect(); setNodes(ns => ns.map(n => n.id === drag.current ? { ...n, x: e.clientX - r.left - 75, y: e.clientY - r.top - 22 } : n)); } },
            onMouseUp: () => drag.current = null, onMouseLeave: () => drag.current = null },
          ov('div', { className: 'canvas-dots', style: { inset: 0 } }),
          ov('svg', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } },
            edges.map(([a, b], i) => {
              const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b);
              if (!na || !nb) return null;
              const ca = center(na), cb = center(nb);
              return ov('path', { key: i, d: `M ${ca.x} ${ca.y} C ${ca.x} ${(ca.y + cb.y) / 2} ${cb.x} ${(ca.y + cb.y) / 2} ${cb.x} ${cb.y}`,
                fill: 'none', stroke: ROLE_META[na.role].color, strokeOpacity: 0.5, strokeWidth: 1.6 });
            })),
          nodes.map(n => ov('div', { key: n.id, className: 'wf-node', style: { left: n.x, top: n.y, borderLeftColor: ROLE_META[n.role].color, borderLeftWidth: 3 },
              onMouseDown: () => drag.current = n.id },
            ov('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
              ov('span', { style: { color: ROLE_META[n.role].color } }, ROLE_META[n.role].icon),
              ov('span', { style: { fontFamily: 'var(--font-display)', fontSize: 11 } }, n.label)),
            ov('div', { style: { fontSize: 9, color: 'var(--text-muted)', marginTop: 4 } }, 'model: claude \u00b7 ' + Math.round(budget / nodes.length) + 'k'))),
        ),
      ),
    ),
  );
}

Object.assign(window, { ArtifactViewer, OptimizeDrawer, NewTaskModal, ToastStack, ConfirmDialog, WorkflowBuilder });
