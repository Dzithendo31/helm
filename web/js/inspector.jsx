/* ============================================================
   HELM — Right dock: Agent Inspector
   ============================================================ */
const ri = React.createElement;

function StarRating({ n }) {
  let s = '';
  for (let i = 0; i < 5; i++) s += i < n ? '\u2605' : '\u2606';
  return ri('span', { className: 'stars', style: { color: 'var(--role-helm)' } }, s);
}

function RightDock(props) {
  const { selected, live, onSendInstruction, onReassign, onKill, collapsed, onToggle,
          chatLog, onChatSend, onChatAction, tokenCount, onTalkToLeader } = props;

  if (collapsed) {
    return ri('div', { className: 'dock-rail right' },
      ri('button', { className: 'rail-btn', onClick: onToggle, title: 'Expand' }, ri(IconPanelRight, { size: 17 })),
      ri('button', { className: 'rail-btn', onClick: () => { onToggle(); onTalkToLeader(); }, title: 'Talk to Helm-Leader', style: { color: 'var(--role-helm)' } }, '\u25c9'),
    );
  }

  const isLeaderChat = selected === 'helm-leader';
  let agent = selected ? agentById(selected) : null;
  let team = selected ? teamById(selected) : null;

  const body = (() => {
    if (isLeaderChat) {
      return ri(HelmChat, { chatLog, onSend: onChatSend, onAction: onChatAction, tokenCount });
    }
    if (!selected) {
      return ri('div', { className: 'insp-empty' },
        ri('div', { className: 'big', style: { color: 'var(--role-helm)' } }, '\u25c9\u25c9'),
        ri('div', null, 'Talk to your first mate'),
        ri('div', { style: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 } }, 'Chat with the Helm-Leader to plan work, get status, or resolve blockers'),
        ri('button', { className: 'insp-cta-helm', onClick: onTalkToLeader }, '\u25c9\u25c9  Open Command Channel'),
        ri('div', { style: { fontSize: 11, color: 'var(--text-muted)', marginTop: 14 } }, 'Or click any agent / team node to inspect it'),
      );
    }

    if (team) {
      const meta = ROLE_META[team.role];
      const agents = team.agents.map(agentById);
      const tokens = agents.reduce((s, a) => s + ((live[a.id] && live[a.id].tokens) || a.tokens), 0);
      return ri('div', { className: 'inspector' },
        ri('div', { className: 'insp-head' },
          ri('span', { style: { color: meta.color, fontSize: 18 } }, meta.icon),
          ri('span', { className: 'insp-name' }, team.name)),
        ri('div', { className: 'insp-sub' }, agents.length + ' agents \u00b7 ' + meta.name),
        ri('div', { className: 'insp-divider' }),
        ri('div', { className: 'insp-block-label' }, 'TEAM TASK'),
        ri('div', { className: 'insp-task-text' }, team.task),
        ri('div', { className: 'insp-divider' }),
        ri('div', { className: 'insp-block-label' }, 'MEMBERS'),
        agents.map(a => ri('div', { key: a.id, className: 'kv', style: { cursor: 'pointer' }, onClick: () => props.onSelectAgent(a.id) },
          ri('span', { className: 'k' }, ri(StatusInd, { status: a.status }), '  ' + a.name + ' \u00b7 ' + a.sub),
          ri('span', { className: 'v' }, Math.round((live[a.id] && live[a.id].progress) || a.progress) + '%'))),
        ri('div', { className: 'insp-divider' }),
        ri('div', { className: 'insp-block-label' }, 'COMBINED TOKENS'),
        ri('div', { className: 'kv' }, ri('span', { className: 'k' }, 'This session'), ri('span', { className: 'v' }, tokens.toLocaleString())),
        ri('div', { className: 'insp-divider' }),
        ri('button', { className: 'insp-action-btn', onClick: () => onSendInstruction(team.name) }, 'Send Team Instruction'),
        ri('button', { className: 'insp-action-btn' }, 'Rebalance Agents'),
      );
    }

    // single agent
    const l = live[agent.id] || {};
    const prog = Math.round(l.progress != null ? l.progress : agent.progress);
    const tokens = l.tokens != null ? l.tokens : agent.tokens;
    const meta = ROLE_META[agent.role];
    const teamName = agent.team ? teamById(agent.team).name : '\u2014';
    const ctxPct = Math.round(agent.ctx * 100);
    return ri('div', { className: 'inspector' },
      ri('div', { className: 'insp-head' },
        ri(StatusInd, { status: agent.status }),
        ri('span', { className: 'insp-name', style: { color: meta.color } }, agent.name.toUpperCase())),
      ri('div', { className: 'insp-sub' }, 'Role: ' + agent.sub),
      ri('div', { className: 'insp-sub' }, 'Team: ' + teamName),
      ri('div', { className: 'insp-sub' }, 'Status: ', ri('span', { style: { color: STATUS_COLOR[agent.status] || 'var(--text-secondary)' } }, agent.status.toUpperCase())),

      ri('div', { className: 'insp-divider' }),
      ri('div', { className: 'insp-block-label' }, 'CURRENT TASK'),
      ri('div', { className: 'insp-task-text' }, '\u201c' + agent.task + '\u201d'),
      ri('div', { className: 'meter' }, ri('i', { style: { width: prog + '%', background: meta.color } })),
      ri('div', { className: 'kv', style: { marginTop: 4 } }, ri('span', { className: 'k' }, 'Progress'), ri('span', { className: 'v' }, prog + '%')),

      ri('div', { className: 'insp-divider' }),
      ri('div', { className: 'insp-block-label' }, 'TOKEN USAGE'),
      ri('div', { className: 'kv' }, ri('span', { className: 'k' }, 'This session'), ri('span', { className: 'v' }, tokens.toLocaleString())),
      ri('div', { className: 'kv' }, ri('span', { className: 'k' }, 'This task'), ri('span', { className: 'v' }, Math.round(tokens * 0.71).toLocaleString())),
      ri('div', { className: 'kv' }, ri('span', { className: 'k' }, 'Lifetime'), ri('span', { className: 'v' }, agent.lifetime.toLocaleString())),
      ri('div', { className: 'kv' }, ri('span', { className: 'k' }, 'Efficiency'), ri(StarRating, { n: agent.eff })),

      ri('div', { className: 'insp-divider' }),
      ri('div', { className: 'insp-block-label' }, 'CONTEXT WINDOW'),
      ri('div', { className: 'meter' }, ri('i', { style: { width: ctxPct + '%', background: ctxPct > 80 ? 'var(--status-error)' : 'var(--role-dev)' } })),
      ri('div', { className: 'kv', style: { marginTop: 4 } }, ri('span', { className: 'k' }, ctxPct + '%'), ri('span', { className: 'v' }, (agent.ctx * 50).toFixed(1) + 'k / 50k')),

      ri('div', { className: 'insp-divider' }),
      ri('div', { className: 'insp-block-label' }, 'RECENT ACTIONS'),
      (LOG_TEMPLATES[agent.role] || []).slice(0, 4).map((m, i) =>
        ri('div', { key: i, className: 'action-log-item' }, ri('span', { className: 'av' }, '\u25b8'), ri('span', null, m))),

      ri('div', { className: 'insp-divider' }),
      ri('button', { className: 'insp-action-btn', onClick: () => onSendInstruction(agent.name) }, 'Send Instruction'),
      ri('button', { className: 'insp-action-btn', onClick: () => onReassign(agent) }, 'Reassign Agent'),
      ri('button', { className: 'insp-action-btn danger', onClick: () => onKill(agent) }, 'Kill Agent'),
    );
  })();

  return ri('div', { className: 'dock dock-right area-right' },
    ri('div', { className: 'dock-section-head', style: { borderBottom: '1px solid var(--helm-border)' } },
      ri('span', { className: 'label-caps' }, isLeaderChat ? 'Command Channel' : 'Agent Inspector'),
      ri('button', { className: 'icon-x', onClick: onToggle, title: 'Collapse' }, ri(IconPanelRight, { size: 15 }))),
    body,
  );
}

Object.assign(window, { RightDock, StarRating });
