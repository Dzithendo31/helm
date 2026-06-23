/* ============================================================
   HELM — Bottom Console (Logs / Messages / Errors)
   ============================================================ */
const co = React.createElement;
const { useRef: couseRef, useEffect: couseEffect, useState: couseState } = React;

function Console(props) {
  const { logs, messages, errors, collapsed, onToggle } = props;
  const [tab, setTab] = couseState('logs');
  const [query, setQuery] = couseState('');
  const [paused, setPaused] = couseState(false);
  const [showTs, setShowTs] = couseState(true);
  const bodyRef = couseRef(null);

  couseEffect(() => {
    if (!paused && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [logs, messages, errors, tab, paused]);

  // pause: report up so app stops appending? We'll just freeze scroll; app keeps data. Simpler: keep appending.
  couseEffect(() => { props.onPauseChange && props.onPauseChange(paused); }, [paused]);

  const q = query.toLowerCase();
  const fLogs = logs.filter(l => !q || (l.who + l.msg).toLowerCase().includes(q));
  const fMsgs = messages.filter(m => !q || (m.from + m.to + m.msg).toLowerCase().includes(q));
  const fErrs = errors.filter(l => !q || (l.who + l.msg).toLowerCase().includes(q));

  if (collapsed) {
    return co('div', { className: 'console area-cons', style: { flexDirection: 'row', alignItems: 'center', padding: '0 12px' } },
      co('button', { className: 'console-tool-btn', onClick: onToggle }, co(IconChevron, { size: 13, style: { transform: 'rotate(180deg)' } }), 'Console'),
      co('span', { style: { marginLeft: 12, fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--text-muted)' } },
        logs.length + ' logs \u00b7 ' + messages.length + ' messages \u00b7 ',
        co('span', { style: { color: errors.length ? 'var(--status-error)' : 'var(--text-muted)' } }, errors.length + ' errors')),
    );
  }

  const tabs = [
    { id: 'logs', label: 'LOGS' },
    { id: 'messages', label: 'MESSAGES' },
    { id: 'errors', label: 'ERRORS', badge: errors.length },
  ];

  return co('div', { className: 'console area-cons' },
    co('div', { className: 'console-bar' },
      tabs.map(t => co('button', { key: t.id, className: 'console-tab' + (tab === t.id ? ' on' : ''), onClick: () => setTab(t.id) },
        t.label, t.badge ? co('span', { className: 'tabbadge mono-num' }, t.badge) : null)),
      co('div', { className: 'console-tools' },
        co('div', { style: { position: 'relative', display: 'flex', alignItems: 'center' } },
          co('span', { style: { position: 'absolute', left: 8, color: 'var(--text-muted)', display: 'flex' } }, co(IconSearch, { size: 12 })),
          co('input', { className: 'console-search', style: { paddingLeft: 26 }, placeholder: 'filter\u2026', value: query, onChange: e => setQuery(e.target.value) })),
        co('button', { className: 'console-tool-btn', onClick: () => setPaused(p => !p), style: paused ? { color: 'var(--status-active)' } : null },
          paused ? co(IconPlay, { size: 12 }) : co(IconPause, { size: 12 }), paused ? 'RESUME' : 'PAUSE'),
        co('button', { className: 'console-tool-btn', onClick: () => setShowTs(s => !s), style: showTs ? { color: 'var(--text-primary)' } : null }, '\u23f1'),
        co('button', { className: 'console-tool-btn', onClick: props.onClear }, co(IconTrash, { size: 12 })),
        co('button', { className: 'console-tool-btn', onClick: () => navigator.clipboard && navigator.clipboard.writeText(logs.map(l => `[${l.who}] ${l.msg}`).join('\n')) }, co(IconCopy, { size: 12 })),
        co('button', { className: 'console-tool-btn', onClick: onToggle }, co(IconChevron, { size: 13 })),
      ),
    ),
    co('div', { className: 'console-body', ref: bodyRef, 'aria-live': 'polite' },
      tab === 'logs' && fLogs.map((l) => co('div', { key: l.id, className: 'log-line' + (l.error ? ' is-error' : '') },
        co('span', { className: 'ts' }, showTs ? l.ts : ''),
        co('span', { className: 'who', style: { color: ROLE_META[l.role] ? ROLE_META[l.role].color : 'var(--text-secondary)' } }, '[' + l.who + ']'),
        co('span', { className: 'msg' }, l.msg))),
      tab === 'messages' && fMsgs.map((m) => co('div', { key: m.id, className: 'msg-line' + (m.user ? ' user-msg' : '') },
        co('span', { className: 'ts' }, showTs ? m.ts : ''),
        co('span', { className: 'msg-who' },
          co('span', { style: { color: ROLE_META[m.fromRole] ? ROLE_META[m.fromRole].color : 'var(--role-dev)', fontWeight: 600 } }, m.from),
          co('span', { className: 'msg-arrow' }, ' \u2192 '),
          co('span', { style: { color: 'var(--text-secondary)' } }, m.to)),
        co('span', { className: 'msg', style: { color: 'var(--text-primary)' } }, '\u201c' + m.msg + '\u201d')),
      ),
      tab === 'errors' && (fErrs.length ? fErrs.map((l) => co('div', { key: l.id, className: 'log-line is-error' },
        co('span', { className: 'ts' }, showTs ? l.ts : ''),
        co('span', { className: 'who', style: { color: 'var(--status-error)' } }, '[' + l.who + ']'),
        co('span', { className: 'msg' }, l.msg))) : co('div', { style: { color: 'var(--text-muted)', padding: 8 } }, 'No errors. WatchMen perimeter clear.')),
    ),
  );
}

Object.assign(window, { Console });
