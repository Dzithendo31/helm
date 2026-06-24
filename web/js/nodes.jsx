/* ============================================================
   HELM — Agent / Team / Helm-Leader nodes
   ============================================================ */
const { createElement: hh } = React;

function elapsed(sinceMs) {
  const s = Math.floor((Date.now() - sinceMs) / 1000);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- Sub-agent card (inside a team node when expanded) ----
function SubAgent({ agent, live, color, onClick, index }) {
  const prog = live ? live.progress : agent.progress;
  return hh('div', {
    className: 'sub-agent', style: { animationDelay: (index * 55) + 'ms', cursor: 'pointer' },
    onClick: (e) => { e.stopPropagation(); onClick(agent.id); },
  },
    hh('div', { className: 'sa-top' },
      hh(StatusInd, { status: agent.status }),
      hh('span', { className: 'sa-name' }, agent.name),
    ),
    hh('div', { className: 'sa-role' }, agent.sub),
    hh('div', { className: 'sa-bar' }, hh('i', { style: { width: prog + '%', background: color } })),
    hh('div', { className: 'sa-pct mono-num' }, Math.round(prog) + '%'),
  );
}

// ---- Team node (solo + team mode) ----
function TeamNode(props) {
  const { team, layout, live, selected, teamMode, optimizeMode, blocked, question,
          dockedArtifacts, onClick, onSelectAgent, onAddAgent, onOpenArtifact, isWatch } = props;
  const meta = ROLE_META[team.role];
  const color = meta.color;
  const agents = team.agents.map(agentById);
  const lt = props.liveTeam; // live engine state for this team (?live mode)

  // aggregate live numbers
  let combinedTokens = 0, avgProg = 0;
  agents.forEach(a => {
    const l = live[a.id];
    combinedTokens += l ? l.tokens : a.tokens;
    avgProg += l ? l.progress : a.progress;
  });
  avgProg = Math.round(avgProg / agents.length);

  if (lt) {
    combinedTokens = lt.tokens || 0;
    avgProg = lt.status === 'done' ? 100 : lt.status === 'active' ? 66 : 0;
  }
  const activeCount = lt
    ? (lt.status === 'active' ? 1 : 0)
    : agents.filter(a => a.status === 'active' || a.status === 'partial').length;
  const start = props.startMs || Date.now();

  const optCost = props.optCost;

  const nodeStyle = {
    left: layout.x, top: layout.y, width: layout.w,
    borderColor: selected ? color : (blocked ? 'var(--status-error)' : undefined),
    boxShadow: blocked ? '0 0 26px rgba(255,59,48,0.4)'
      : (selected || activeCount > 0 ? `0 0 32px ${rgba(color, selected ? 0.4 : 0.18)}` : 'none'),
  };

  const cls = ['node', 'team'];
  if (selected) cls.push('selected');
  if (activeCount > 0 && !blocked) cls.push('breathing');
  if (blocked) cls.push('alerting');

  return hh('div', { className: cls.join(' '), style: nodeStyle,
      onClick: () => onClick(team.id), 'data-screen-label': team.name },

    blocked && hh('div', { className: 'blocked-badge' }, '\u26d4 BLOCKED'),
    question && !blocked && hh('div', { className: 'q-badge' }, '?'),

    hh('div', { className: 'node-header', style: { borderLeftColor: color, background: rgba(color, 0.12) } },
      hh('span', { style: { color, fontSize: 14, width: 20, textAlign: 'center' } }, meta.icon),
      hh('span', { className: 'node-name' }, team.name),
      hh('span', { className: 'role-badge', style: { background: rgba(color, 0.15), color } }, teamMode ? 'TEAM' : meta.label),
      hh('span', { className: 'count-badge' }, activeCount),
    ),

    hh('div', { className: 'node-body' },
      (teamMode && !lt)
        ? hh('div', { className: 'team-subgrid' },
            agents.map((a, i) => hh(SubAgent, { key: a.id, agent: a, live: live[a.id], color, index: i, onClick: onSelectAgent })),
            !isWatch && hh('div', { className: 'team-add', onClick: (e) => { e.stopPropagation(); onAddAgent(team.id); }, title: 'Add agent' }, '+'),
          )
        : hh('div', null,
            hh('div', { className: 'node-task-label' }, isWatch ? 'Surveillance' : 'Team task'),
            hh('div', { className: 'node-task' }, lt ? (lt.task || '—') : team.task),
            hh('div', { className: 'node-progress ' + (activeCount > 0 ? 'striping' : '') },
              hh('i', { style: { width: avgProg + '%', background: color } })),
          ),

      hh('div', { className: 'node-foot' },
        hh('span', null, '\u2191 ', fmtTokens(combinedTokens), ' tokens', teamMode ? ' combined' : ''),
        hh('span', null, '\u23f1 ', elapsed(start)),
      ),
    ),

    // optimize cost badge / lean badge
    optimizeMode && (optCost
      ? hh('div', { className: 'token-cost-badge' }, '~' + fmtTokens(optCost))
      : hh('div', { className: 'lean-badge' }, '\u2713 LEAN')),

    // docked artifacts
    dockedArtifacts && dockedArtifacts.length > 0 && hh('div', { className: 'docked-arts' },
      dockedArtifacts.map(a => {
        const am = ARTIFACT_META[a.type];
        return hh('div', { key: a.id, className: 'art-mini', style: { borderLeftColor: am.color },
          onClick: (e) => { e.stopPropagation(); onOpenArtifact(a.id); } },
          hh('span', { className: 'am-ico', style: { color: am.color } }, am.icon),
          hh('span', null, am.label.split(' ')[0], ' \u00b7 ', a.title.replace(/^(Task #\d+: |.*?: )/, '').slice(0, 16)),
        );
      })
    ),
  );
}

// ---- Helm-Leader node ----
function HelmLeaderNode(props) {
  const { layout, selected, cotText, showActions, alerting, onClick, onAccept, onModify, onReject } = props;
  const color = ROLE_META.helm.color;
  const cls = ['node', 'helm-leader'];
  if (selected) cls.push('selected');
  if (alerting) cls.push('alerting');
  else cls.push('breathing');

  return hh('div', { className: cls.join(' '),
      style: { left: layout.x, top: layout.y, width: layout.w,
               borderColor: selected ? color : undefined,
               boxShadow: alerting ? '0 0 40px rgba(255,59,48,0.4)' : `0 0 44px ${rgba(color, selected ? 0.35 : 0.16)}` },
      onClick: () => onClick('helm-leader'), 'data-screen-label': 'Helm-Leader' },

    hh('div', { className: 'node-header', style: { borderLeftColor: color, background: rgba(color, 0.14), height: 38 } },
      hh('span', { style: { color, fontSize: 15 } }, '\u25c9\u25c9'),
      hh('span', { className: 'node-name', style: { fontSize: 13.5 } }, 'HELM-LEADER'),
      hh('span', { className: 'role-badge', style: { background: rgba(color, 0.15), color } },
        alerting ? 'BLOCKER' : 'ORCHESTRATING'),
    ),

    hh('div', { className: 'node-body', style: { padding: '12px 14px 14px' } },
      hh('div', { className: 'cot-stream' },
        cotText.map((l, i) => hh('span', { key: i, className: 'cot-line' },
          l.startsWith('\u25b8') ? hh('span', null, hh('span', { className: 'arr' }, '\u25b8'), l.slice(1)) : l)),
        !showActions && hh('span', { className: 'cot-cursor' }),
      ),

      showActions && hh('div', { className: 'leader-actions' },
        hh('button', { className: 'la-btn primary', onClick: (e) => { e.stopPropagation(); onAccept(); } }, 'Accept Workflow'),
        hh('button', { className: 'la-btn ghost', onClick: (e) => { e.stopPropagation(); onModify(); } }, 'Modify'),
        hh('button', { className: 'la-btn ghost', onClick: (e) => { e.stopPropagation(); onReject(); } }, 'Reject'),
      ),
    ),
  );
}

Object.assign(window, { TeamNode, HelmLeaderNode, SubAgent, elapsed, rgba });
