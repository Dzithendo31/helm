/* ============================================================
   HELM — Top Bar + App root (state, live sim, demo flow)
   ============================================================ */
const { useState: auseState, useEffect: auseEffect, useRef: auseRef, useCallback: auseCb } = React;
const ap = React.createElement;

// LIVE mode (open HELM.html?live): silence the design sim and bind the
// cleanly-mappable surfaces (console log + token counter) to a real Helm run
// over SSE. The canvas/docks keep their design scaffolding for now.
const LIVE = new URLSearchParams(window.location.search).has('live');
const ICON_ROLE = { '⚓': 'helm', '🔬': 'research', '🔨': 'dev', '🧪': 'dev', '🔧': 'dev', '🔎': 'qa', '👁': 'watch' };
function liveLogLine(ln) {
  return { who: ln.icon || '·', role: ICON_ROLE[ln.icon] || 'helm', msg: ln.text, ts: (ln.at || '').slice(11, 19), error: ln.level === 'error', id: 'live-' + ln.seq };
}

// ---------- Top Bar ----------
function TopBar(props) {
  const { teamMode, optimizeMode, brainOpen, anyActive, tokenCount, currentTask,
          onToggleTeam, onToggleOptimize, onToggleBrain, onTalkToLeader } = props;
  return ap('div', { className: 'topbar area-top' },
    ap('div', { className: 'topbar-cluster' },
      ap('div', { className: 'helm-logo' },
        ap('span', { className: 'helm-wheel' + (anyActive ? ' spinning' : '') }, ap(IconHelm, { size: 22 })),
        ap('span', { className: 'helm-wordmark' }, 'HELM')),
      ap('div', { className: 'breadcrumb' }, ap('b', null, 'acme-corp'), ' / ', ap('b', null, 'web-platform'))),

    ap('div', { className: 'topbar-center' },
      ap('div', { className: 'active-task-pill' + (currentTask && currentTask.status === 'in-progress' ? ' running' : ''), onClick: onTalkToLeader, style: { cursor: 'pointer' }, title: 'Talk to the Helm-Leader' },
        ap('span', { className: 'bolt' }, ap(IconBolt, { size: 13 })),
        ap('span', { className: 'ttl' }, currentTask ? currentTask.title : 'No active task'),
        ap('span', { style: { color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 } }, '\u25c9\u25c9'))),

    ap('div', { className: 'topbar-cluster' },
      ap('button', { className: 'tb-toggle' + (teamMode ? ' on' : ''), onClick: onToggleTeam, title: 'Toggle team mode' },
        ap('span', { className: 'sw' }), teamMode ? 'TEAM' : 'SOLO'),
      ap('button', { className: 'tb-btn' + (optimizeMode ? ' active-amber' : ''), onClick: onToggleOptimize },
        ap(IconBulb, { size: 14 }), 'OPTIMIZE'),
      ap('button', { className: 'tb-btn' + (brainOpen ? ' active-violet' : ''), onClick: onToggleBrain },
        ap(IconHex, { size: 14 }), 'BRAIN'),
      ap('div', { className: 'token-counter' },
        ap('span', { className: 'arr' }, '\u2191'),
        ap('span', { className: 'tk mono-num' }, fmtTokens(tokenCount), ' tokens'),
        ap('span', { className: 'cost mono-num' }, fmtCost(tokenCount))),
      ap('div', { className: 'avatar', title: 'Captain' }, 'C')),
  );
}

// ---------- App ----------
function HelmApp() {
  const [teamMode, setTeamMode] = auseState(false);
  const [optimizeMode, setOptimizeMode] = auseState(false);
  const [brainOpen, setBrainOpen] = auseState(false);
  const [selected, setSelected] = auseState(null);
  const [tasks, setTasks] = auseState(TASKS.slice());
  const [activeTaskId, setActiveTaskId] = auseState(42);
  const [tokenCount, setTokenCount] = auseState(48200);
  const [zoom, setZoom] = auseState(0.62);
  const [offset, setOffset] = auseState({ x: 30, y: 44 });
  const [live, setLive] = auseState(() => { const o = {}; AGENTS.forEach(a => o[a.id] = { progress: a.progress, tokens: a.tokens }); return o; });
  const [logs, setLogs] = auseState(() => LOG_SEED.map((l, i) => ({ ...l, ts: clockNow(), id: 'seed-l-' + i })));
  const [messages, setMessages] = auseState(() => MSG_SEED.map((m, i) => ({ ...m, ts: clockNow(), id: 'seed-m-' + i })));
  const [paused, setPaused] = auseState(false);
  const [chatLog, setChatLog] = auseState(() => [{ id: 'c0', role: 'helm', text: "Captain on deck. \u2693 I'm orchestrating the OAuth login flow across Research, Dev and QA \u2014 with the WatchMen on the perimeter. Ask for a status, probe a blocker, or hand me a new task." }]);
  const [travels, setTravels] = auseState([]);
  const [toasts, setToasts] = auseState([]);
  const [blockedTeam, setBlockedTeam] = auseState(null);
  const [questionTeam, setQuestionTeam] = auseState('dev-team');
  const [resolvedBlockers, setResolvedBlockers] = auseState([]);
  const [decision, setDecision] = auseState(null);
  const [alertRing, setAlertRing] = auseState(0);
  const [leftCollapsed, setLeftCollapsed] = auseState(false);
  const [rightCollapsed, setRightCollapsed] = auseState(false);
  const [consoleCollapsed, setConsoleCollapsed] = auseState(false);
  const [showMinimap, setShowMinimap] = auseState(false);
  const [viewArtifact, setViewArtifact] = auseState(null);
  const [modal, setModal] = auseState(null); // {type:'newtask'|'confirm'|'workflow'|'instruction', ...}
  const [cotLines, setCotLines] = auseState(COT_LINES.slice(0, 4));
  const [leaderActions, setLeaderActions] = auseState(false);
  const [leaderAlerting, setLeaderAlerting] = auseState(false);
  const [demoStep, setDemoStep] = auseState(0);
  const [demoRunning, setDemoRunning] = auseState(false);
  const [layoutVersion, setLayoutVersion] = auseState(0);
  const startMs = auseRef(Date.now() - 83000).current;
  const tid = auseRef(0);
  const lc = auseRef(0);
  const chatStream = auseRef(null);
  const demoTimers = auseRef([]);

  const errors = logs.filter(l => l.error);
  const anyActive = AGENTS.some(a => a.status === 'active');

  const dockedMap = {
    'dev-team': [artById('spec-1'), artById('task-42')],
    'qa-team': [artById('changelog-1')],
    'research-team': [artById('brief-1')],
  };
  const optCosts = { 'dev-team': 18400, 'research-team': 9200, 'qa-team': 0, 'watchmen': 0, 'helm-leader': 8400 };

  // ---- live simulation ----
  auseEffect(() => {
    const iv = setInterval(() => {
      if (paused || LIVE) return;
      setLive(prev => {
        const next = { ...prev };
        AGENTS.forEach(a => {
          if (a.status === 'active' || a.status === 'partial') {
            const cur = next[a.id];
            next[a.id] = {
              progress: Math.min(99, cur.progress + Math.random() * 1.4),
              tokens: cur.tokens + Math.floor(Math.random() * 60),
            };
          }
        });
        return next;
      });
      setTokenCount(t => t + Math.floor(50 + Math.random() * 250));
    }, 800);
    return () => clearInterval(iv);
  }, [paused]);

  // ---- log streaming ----
  auseEffect(() => {
    const iv = setInterval(() => {
      if (paused || LIVE) return;
      const roles = Object.keys(LOG_TEMPLATES);
      const role = roles[Math.floor(Math.random() * roles.length)];
      const who = AGENTS.filter(a => a.role === role)[0];
      const tpl = LOG_TEMPLATES[role];
      const msg = tpl[Math.floor(Math.random() * tpl.length)];
      const isErr = Math.random() < 0.04;
      setLogs(l => [...l.slice(-120), { who: (who ? who.name : role).toUpperCase(), role, msg: isErr ? 'WARN: ' + msg + ' (retrying)' : msg, ts: clockNow(), error: isErr, id: 'l' + (++lc.current) }]);
      if (Math.random() < 0.22) {
        const m = MSG_SEED[Math.floor(Math.random() * MSG_SEED.length)];
        setMessages(ms => [...ms.slice(-60), { ...m, ts: clockNow(), id: 'm' + (++lc.current) }]);
      }
    }, 1700);
    return () => clearInterval(iv);
  }, [paused]);

  // ---- LIVE: bind console + token counter to a real Helm run via SSE ----
  auseEffect(() => {
    if (!LIVE) return;
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      let ev; try { ev = JSON.parse(e.data); } catch (_) { return; }
      if (ev.type === 'log') {
        setLogs(l => [...l.slice(-240), liveLogLine(ev.line)]);
      } else if (ev.type === 'tokens') {
        setTokenCount(ev.tokens);
      } else if (ev.type === 'snapshot') {
        setLogs(ev.state.log.map(liveLogLine));
        if (ev.state.tokens) setTokenCount(ev.state.tokens);
      }
    };
    return () => es.close();
  }, []);

  // ---- steady COT rotation ----
  auseEffect(() => {
    if (leaderActions || demoRunning) return;
    const iv = setInterval(() => {
      const pool = LOG_TEMPLATES.helm;
      setCotLines(['Orchestrating active task\u2026', '\u25b8 ' + pool[Math.floor(Math.random() * pool.length)], '\u25b8 ' + pool[Math.floor(Math.random() * pool.length)], '\u25b8 Monitoring 4 teams \u00b7 WatchMen engaged']);
    }, 3200);
    return () => clearInterval(iv);
  }, [leaderActions, demoRunning]);

  // ---- ambient travels ----
  auseEffect(() => {
    const iv = setInterval(() => {
      if (paused || demoRunning) return;
      const samples = [
        { fromId: 'research-team', toId: 'dev-team', label: 'Brief \u00b7 Auth', icon: '\u2316', color: ROLE_META.research.color },
        { fromId: 'dev-team', toId: 'qa-team', label: '\u0394 Changelog', icon: '\u0394', color: ROLE_META.dev.color },
        { fromId: 'helm-leader', toId: 'dev-team', label: '\u26a1 Task #042', icon: '\u26a1', color: ROLE_META.helm.color },
      ];
      const s = samples[Math.floor(Math.random() * samples.length)];
      spawnTravel(s);
    }, 4200);
    return () => clearInterval(iv);
  }, [paused, demoRunning]);

  const spawnTravel = auseCb((t) => {
    const id = ++tid.current;
    setTravels(tv => [...tv, { id, dur: 1900, ...t }]);
  }, []);
  const onTravelArrive = auseCb((id) => {
    setTravels(tv => tv.filter(t => t.id !== id));
  }, []);

  const pushToast = (head, body) => {
    const id = ++tid.current;
    setToasts(t => [...t, { id, head, body }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 7000);
  };

  // ---- handlers ----
  const onSelect = (id) => { setSelected(id); if (rightCollapsed) setRightCollapsed(false); };
  const onSelectAgent = (id) => { setSelected(id); if (rightCollapsed) setRightCollapsed(false); };

  const startTask = (task) => {
    setActiveTaskId(task.id);
    setTasks(ts => ts.map(t => ({ ...t, status: t.id === task.id ? 'in-progress' : (t.status === 'in-progress' ? 'queued' : t.status) })));
    // leader analyze
    setLeaderActions(false); setLeaderAlerting(false);
    runAnalysis(task);
  };

  const analyzeTimers = auseRef([]);
  const runAnalysis = (task) => {
    analyzeTimers.current.forEach(clearTimeout); analyzeTimers.current = [];
    const lines = [`Analyzing: "${task.title.slice(0, 30)}"`, '\u25b8 Breaking into sub-tasks', '\u25b8 Spawning Research + Dev + QA', '\u25b8 WatchMen on perimeter', '\u25b8 Estimating: ~' + (task.complexity === 'XL' ? 38 : task.complexity === 'L' ? 24 : 14) + 'k tokens'];
    setCotLines([lines[0]]);
    lines.forEach((ln, i) => {
      if (i === 0) return;
      analyzeTimers.current.push(setTimeout(() => setCotLines(lines.slice(0, i + 1)), 700 * i));
    });
    analyzeTimers.current.push(setTimeout(() => setLeaderActions(true), 700 * lines.length + 300));
  };

  const acceptWorkflow = () => {
    setLeaderActions(false);
    setLayoutVersion(v => v + 1);
    spawnTravel({ fromId: 'helm-leader', toId: 'dev-team', label: '\u26a1 Task', icon: '\u26a1', color: ROLE_META.helm.color });
    setTimeout(() => spawnTravel({ fromId: 'research-team', toId: 'dev-team', label: '\u2316 Brief', icon: '\u2316', color: ROLE_META.research.color }), 500);
    pushToast('WORKFLOW ACCEPTED', 'Teams spawned. Task is now in progress.');
  };

  const resolveBlocker = (bid) => {
    setResolvedBlockers(r => [...r, bid]);
    setBlockedTeam(null);
    setDecision(null);
    spawnTravel({ fromId: 'qa-team', toId: 'dev-team', label: '\u2713 Fix assigned', icon: '\u2713', color: ROLE_META.qa.color });
    setLeaderAlerting(false);
    setLogs(l => [...l, { who: 'GEORGE', role: 'qa', msg: 'Blocker resolved \u2014 fix verified, task unfrozen', ts: clockNow(), id: 'l' + (++lc.current) }]);
    pushToast('BLOCKER RESOLVED', 'Dev applied the fix. Task #042 unfrozen and back in flow.');
  };

  const triggerBlocker = () => {
    setBlockedTeam('dev-team');
    setQuestionTeam(null);
    setLeaderAlerting(true);
    setAlertRing(a => a + 1);
    pushToast('WATCHMEN ALERT', 'JWT secret logged in plain text \u2014 api/routes/auth.ts:94. Task #042 frozen.');
    setLogs(l => [...l, { who: 'GEORGE', role: 'qa', msg: 'BLOCKER: JWT exposed in plain text (auth.ts:94)', ts: clockNow(), error: true, id: 'l' + (++lc.current) }]);
    setDecision({
      title: 'BLOCKER \u2014 decision required',
      text: 'WatchMen + QA flagged a CRITICAL security violation: JWT secret logged in plain text. Task #042 is frozen until resolved.',
      blockerId: 'blocker-1',
    });
  };

  // ---- scripted demo ----
  const stopDemo = () => { demoTimers.current.forEach(clearTimeout); demoTimers.current = []; setDemoRunning(false); setDemoStep(0); };
  const runDemo = () => {
    if (demoRunning) { stopDemo(); return; }
    setDemoRunning(true); setDemoStep(1);
    setResolvedBlockers([]); setBlockedTeam(null); setDecision(null);
    const T = (ms, fn) => demoTimers.current.push(setTimeout(fn, ms));
    // 1 leader analyzes
    runAnalysis({ title: 'Implement OAuth login flow', complexity: 'XL' });
    setSelected('helm-leader');
    T(4200, () => { setDemoStep(2); acceptWorkflow(); });
    // 2 research -> dev brief
    T(6000, () => { setDemoStep(3); spawnTravel({ fromId: 'research-team', toId: 'helm-leader', label: '\u2316 Brief', icon: '\u2316', color: ROLE_META.research.color }); });
    T(8200, () => spawnTravel({ fromId: 'helm-leader', toId: 'dev-team', label: '\ud83d\udcc4 Spec v1', icon: '\ud83d\udcc4', color: ROLE_META.helm.color }));
    // 3 dev -> qa changelog
    T(11000, () => { setDemoStep(4); spawnTravel({ fromId: 'dev-team', toId: 'qa-team', label: '\u0394 Changelog', icon: '\u0394', color: ROLE_META.dev.color }); });
    // 4 blocker fires
    T(14000, () => { setDemoStep(5); triggerBlocker(); setSelected('dev-team'); });
    // (waits for user; auto-resolve fallback)
    T(22000, () => { setDemoStep(6); if (demoTimers.current.length) { resolveBlocker('blocker-1'); } });
    T(25000, () => { setDemoRunning(false); setDemoStep(0); pushToast('DEMO COMPLETE', 'Steady state resumed. Poke around freely.'); });
  };

  // cleanup
  auseEffect(() => () => { demoTimers.current.forEach(clearTimeout); analyzeTimers.current.forEach(clearTimeout); clearInterval(chatStream.current); }, []);

  // ---- Helm-Leader chat ----
  const talkToLeader = () => { setSelected('helm-leader'); setRightCollapsed(false); };
  const sendToLeader = (text) => {
    const ctx = { tokenCount, taskTitle: (tasks.find(t => t.id === activeTaskId) || {}).title || 'the active task', blocked: !!blockedTeam };
    const uid = 'cu' + (++lc.current);
    setChatLog(c => [...c, { id: uid, role: 'user', text }]);
    const reply = leaderReply(text, ctx);
    const hid = 'ch' + (++lc.current);
    setChatLog(c => [...c, { id: hid, role: 'helm', text: '', streaming: true, action: reply.action }]);
    clearInterval(chatStream.current);
    let i = 0;
    chatStream.current = setInterval(() => {
      i += 2;
      setChatLog(c => c.map(m => m.id === hid ? { ...m, text: reply.text.slice(0, i) } : m));
      if (i >= reply.text.length) { clearInterval(chatStream.current); setChatLog(c => c.map(m => m.id === hid ? { ...m, text: reply.text, streaming: false } : m)); }
    }, 16);
  };
  const onChatAction = (kind) => {
    if (kind === 'optimize') setOptimizeMode(true);
    else if (kind === 'newtask') setModal({ type: 'newtask' });
    else if (kind === 'brain') setBrainOpen(true);
    else if (kind === 'accept') acceptWorkflow();
    else if (kind === 'resolve') { if (decision) resolveBlocker(decision.blockerId); else if (blockedTeam) resolveBlocker('blocker-1'); else setViewArtifact('blocker-1'); }
  };

  const onAddAgent = (teamId) => { setModal({ type: 'confirm', title: 'Add Agent', body: 'Spawn a new agent into ' + teamById(teamId).name + '? It will inherit the team context and begin on the next available sub-task.', confirmLabel: 'Spawn Agent', onConfirm: () => { pushToast('AGENT SPAWNED', 'New agent joined ' + teamById(teamId).name + '.'); setModal(null); } }); };
  const onSendInstruction = (name) => setModal({ type: 'instruction', target: name });
  const onReassign = (a) => setModal({ type: 'confirm', title: 'Reassign ' + a.name, body: 'Move ' + a.name + ' to a different team? Current sub-task progress will be checkpointed.', confirmLabel: 'Reassign', onConfirm: () => { pushToast('AGENT REASSIGNED', a.name + ' moved teams.'); setModal(null); } });
  const onKill = (a) => setModal({ type: 'confirm', title: 'Kill ' + a.name + '?', danger: true, body: 'Terminating ' + a.name + ' will halt its current task immediately. This cannot be undone.', confirmLabel: 'Kill Agent', onConfirm: () => { pushToast('AGENT TERMINATED', a.name + ' was killed.'); setModal(null); setSelected(null); } });

  const acceptSuggestion = (id) => { pushToast('SUGGESTION ACCEPTED', 'Micro-task routed to Dev Team.'); spawnTravel({ fromId: 'qa-team', toId: 'dev-team', label: '\u2726 Micro-task', icon: '\u2726', color: ROLE_META.helm.color }); };
  const answerQuestion = (id, how) => { setQuestionTeam(null); pushToast(how === 'user' ? 'ANSWER SENT' : 'ROUTED TO AGENT', how === 'user' ? 'Your answer was injected to the agent.' : 'Agent will attempt to answer autonomously.'); };

  return ap('div', { className: 'helm-root' + (leftCollapsed ? ' left-collapsed' : '') + (rightCollapsed ? ' right-collapsed' : '') + (consoleCollapsed ? ' console-collapsed' : '') },
    ap(TopBar, {
      teamMode, optimizeMode, brainOpen, anyActive, tokenCount, currentTask: tasks.find(t => t.id === activeTaskId),
      onToggleTeam: () => { setTeamMode(m => !m); setLayoutVersion(v => v + 1); },
      onToggleOptimize: () => setOptimizeMode(m => !m),
      onToggleBrain: () => setBrainOpen(b => !b),
      onTalkToLeader: talkToLeader,
    }),

    ap(LeftDock, {
      collapsed: leftCollapsed, onToggle: () => setLeftCollapsed(c => !c),
      taskProps: { tasks, activeId: activeTaskId, onStart: startTask, onNewTask: () => setModal({ type: 'newtask' }),
        onReorder: (from, to) => setTasks(ts => { const a = ts.slice(); const fi = a.findIndex(t => t.id === from); const ti2 = a.findIndex(t => t.id === to); const [m] = a.splice(fi, 1); a.splice(ti2, 0, m); return a; }) },
      onUseTemplate: (t) => pushToast('TEMPLATE LOADED', t.name + ' workflow staged on canvas.'),
      artifactProps: { artifacts: ARTIFACTS, onOpen: setViewArtifact, resolvedBlockers },
      onOpenFile: (f) => pushToast('FILE OPENED', f.name + (f.touchedBy ? ' \u00b7 touched by ' + ROLE_META[f.touchedBy].name : '')),
    }),

    ap('div', { className: 'area-canvas', style: { position: 'relative' } },
      ap(Canvas, {
        teamMode, optimizeMode, selected, blockedTeam, questionTeam, dockedMap, optCosts,
        cotText: cotLines, showLeaderActions: leaderActions, leaderAlerting,
        travels, layoutVersion, live, startMs, alertRing,
        zoom, offset, setZoom, setOffset,
        onSelect, onSelectAgent, onAddAgent, onOpenArtifact: setViewArtifact, onTravelArrive,
        onAccept: acceptWorkflow, onModify: () => setModal({ type: 'workflow' }), onReject: () => { setLeaderActions(false); pushToast('WORKFLOW REJECTED', 'Describe the task again to re-plan.'); },
        showMinimap, onToggleMinimap: () => setShowMinimap(s => !s),
      }),

      // demo control
      ap('div', { className: 'demo-fab' },
        ap('span', { className: 'df-text' }, demoRunning ? 'Demo running' : 'Watch HELM work'),
        demoRunning && ap('span', { className: 'df-step' }, 'step ' + demoStep + '/6'),
        ap('button', { className: 'demo-run-btn' + (demoRunning ? ' running' : ''), onClick: runDemo }, demoRunning ? '\u25a0 Stop' : '\u25b6 Run Demo')),

      // decision banner
      decision && ap('div', { className: 'decision-banner' },
        ap('div', { className: 'db-head' }, ap('span', { style: { color: 'var(--status-error)', fontSize: 15 } }, '\u26d4'), ap('span', { className: 'db-title' }, decision.title)),
        ap('div', { className: 'db-text' }, decision.text),
        ap('div', { className: 'db-actions' },
          ap('button', { className: 'db-btn view', onClick: () => setViewArtifact(decision.blockerId) }, 'View Blocker'),
          ap('button', { className: 'db-btn fix', onClick: () => resolveBlocker(decision.blockerId) }, 'Assign Fix \u2192 Dev'))),

      optimizeMode && ap(OptimizeDrawer, { baseTokens: 48200, onClose: () => setOptimizeMode(false), onApply: () => { pushToast('OPTIMIZED', 'Applied \u2014 projected 38% token reduction.'); setOptimizeMode(false); } }),
      brainOpen && ap(BrainView, { onClose: () => setBrainOpen(false) }),
    ),

    ap(RightDock, {
      collapsed: rightCollapsed, onToggle: () => setRightCollapsed(c => !c),
      selected, live, onSelectAgent, onSendInstruction, onReassign, onKill,
      chatLog, onChatSend: sendToLeader, onChatAction, tokenCount, onTalkToLeader: talkToLeader,
    }),

    ap(Console, { logs, messages, errors, collapsed: consoleCollapsed, onToggle: () => setConsoleCollapsed(c => !c), onClear: () => { setLogs([]); setMessages([]); }, onPauseChange: setPaused }),

    ap(ToastStack, { toasts, onDismiss: (id) => setToasts(t => t.filter(x => x.id !== id)) }),

    viewArtifact && ap(ArtifactViewer, { id: viewArtifact, onClose: () => setViewArtifact(null), onOpen: setViewArtifact,
      onResolveBlocker: resolveBlocker, onAcceptSuggestion: acceptSuggestion, onAnswerQuestion: answerQuestion, resolvedBlockers }),

    modal && modal.type === 'newtask' && ap(NewTaskModal, { onClose: () => setModal(null),
      onCreate: (t) => { const id = Math.max(...tasks.map(x => x.id)) + 1; setTasks(ts => [...ts, { id, status: 'queued', ...t }]); setModal(null); pushToast('TASK QUEUED', '#0' + id + ' \u00b7 ' + t.title); } }),
    modal && modal.type === 'confirm' && ap(ConfirmDialog, { ...modal, onClose: () => setModal(null) }),
    modal && modal.type === 'workflow' && ap(WorkflowBuilder, { onClose: () => setModal(null), onRun: () => { setModal(null); setLeaderActions(false); acceptWorkflow(); } }),
    modal && modal.type === 'instruction' && ap(InstructionModal, { target: modal.target, onClose: () => setModal(null), onSend: () => { setModal(null); pushToast('INSTRUCTION SENT', 'Injected to ' + modal.target + '.'); } }),

    ap('div', { className: 'mobile-banner' }, 'HELM works best on desktop \u00b7 1280px+'),
  );
}

function InstructionModal({ target, onClose, onSend }) {
  const [txt, setTxt] = auseState('');
  return ap('div', { className: 'scrim', onClick: onClose },
    ap('div', { className: 'modal task-modal', style: { width: 420 }, onClick: e => e.stopPropagation() },
      ap('div', { className: 'tm-head' }, 'Instruct ' + target, ap('button', { className: 'icon-x', onClick: onClose }, '\u2715')),
      ap('div', { className: 'tm-body' },
        ap('div', { className: 'field' },
          ap('label', { className: 'field-label' }, 'Manual prompt'),
          ap('textarea', { autoFocus: true, rows: 4, placeholder: 'e.g. Prioritize the token refresh path before the UI polish\u2026', value: txt, onChange: e => setTxt(e.target.value) }))),
      ap('div', { className: 'tm-foot' },
        ap('button', { className: 'btn-ghost', onClick: onClose }, 'Cancel'),
        ap('button', { className: 'btn-primary', onClick: onSend }, 'Send \u2192'))),
  );
}

Object.assign(window, { HelmApp, TopBar, InstructionModal });

const _root = ReactDOM.createRoot(document.getElementById('root'));
_root.render(React.createElement(HelmApp));
