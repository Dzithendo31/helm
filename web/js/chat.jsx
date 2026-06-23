/* ============================================================
   HELM — Helm-Leader chat (conversational command interface)
   ============================================================ */
const ch = React.createElement;
const { useRef: chuseRef, useEffect: chuseEffect, useState: chuseState } = React;

// Mocked, context-aware reply engine for the Helm-Leader.
// Returns { text, action?: {kind, label} }
function leaderReply(raw, ctx) {
  const t = (raw || '').toLowerCase();
  const tok = fmtTokens(ctx.tokenCount);
  const cost = fmtCost(ctx.tokenCount);

  if (/(^|\s)(hi|hey|hello|yo|captain|ahoy)(\s|$|!|\.)/.test(t))
    return { text: `Captain on deck. \u2693 I have Research, Dev, QA and the WatchMen underway on "${ctx.taskTitle}". Burn so far is ${tok} (${cost}). What's the order?` };

  if (/(block|blocker|jwt|frozen|stuck|why.*red|halt)/.test(t)) {
    if (ctx.blocked)
      return { text: `Dev Team is frozen on a CRITICAL blocker from the WatchMen \u2014 a JWT secret is being logged in plain text at api/routes/auth.ts:94. Nothing merges until it's cleared. I can route the fix to Dev now and re-queue the re-review.`, action: { kind: 'resolve', label: 'Assign Fix \u2192 Dev' } };
    return { text: `No active blockers right now \u2014 the perimeter is clear. If QA or the WatchMen flag a CRITICAL issue, I'll freeze the affected task and surface a decision to you here.` };
  }

  if (/(optimi|cost|cheaper|expensive|token|save|budget|burn)/.test(t))
    return { text: `Current run is projected at ${tok} (${cost}). I see two savings: collapse the Dev Team 3\u21921 agent (~12.4k) and run QA sequentially (~6.2k) \u2014 roughly a 38% reduction. Want me to open Optimize Mode so you can review and apply?`, action: { kind: 'optimize', label: '\ud83d\udca1 Open Optimize Mode' } };

  if (/(brain|graph|knowledge|codebase|understand|map|mental model)/.test(t))
    return { text: `The teams have built a shared model of the repo \u2014 auth/ and the JWT path are "hot" right now. I can open the Brain View so you can see what we know and what's still unexplored.`, action: { kind: 'brain', label: '\u2b22 Open Brain View' } };

  if (/(team|who|agent|roster|crew|members|how many)/.test(t))
    return { text: `Five units under HELM: Research (Diana, Evan) scouting the auth model \u2192 Dev (Ava, Ben, Carlos) building it \u2192 QA (Fiona, George) reviewing. The WatchMen (Iris, Jax) watch everything continuously. Flip TEAM mode to see each crew expand.` };

  if (/(status|progress|going|update|where are we|how.*we doing|sitrep|report)/.test(t))
    return { text: `Sitrep: Research is ~88% done on the brief, Dev is mid-build on the auth components, QA is reviewing changelog #1. ${ctx.blocked ? 'One CRITICAL blocker is freezing Dev (JWT leak). ' : 'No blockers. '}Run burn: ${tok} (${cost}).` };

  if (/(spawn|workflow|build|implement|add|create|new task|feature|refactor|fix|do |make )/.test(t))
    return { text: `Understood. I'll break that into sub-tasks and assign Research + Dev + QA, with the WatchMen on the perimeter. Open the task brief and I'll plan the workflow on the canvas for your approval.`, action: { kind: 'newtask', label: '\u26a1 Draft a New Task' } };

  if (/(accept|approve|go|ship|proceed|run it|do it)/.test(t))
    return { text: `Aye. Locking the workflow and spawning the teams now \u2014 watch the canvas as the artifacts start flowing.`, action: { kind: 'accept', label: '\u2713 Accept Workflow' } };

  if (/(thank|nice|great|good job|well done)/.test(t))
    return { text: `That's the crew, not me \u2014 but I'll pass it along. Standing by for the next order, Captain.` };

  return { text: `I can plan and route work, report status, surface blockers, and tune cost. Try: "what's the status?", "why is Dev blocked?", "optimize this run", or hand me a new task to orchestrate.` };
}

const CHAT_CHIPS = [
  "What's the status?",
  'Why is Dev blocked?',
  'Optimize this run',
  'Spawn a new workflow',
];

function HelmChat({ chatLog, onSend, onAction, tokenCount }) {
  const [text, setText] = chuseState('');
  const bodyRef = chuseRef(null);
  const color = ROLE_META.helm.color;

  chuseEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [chatLog]);

  const send = (msg) => {
    const v = (msg != null ? msg : text).trim();
    if (!v) return;
    onSend(v);
    setText('');
  };

  return ch('div', { className: 'helm-chat' },
    ch('div', { className: 'hc-head' },
      ch('span', { className: 'hc-avatar' }, '\u25c9\u25c9'),
      ch('div', { style: { flex: 1 } },
        ch('div', { className: 'hc-name' }, 'HELM-LEADER'),
        ch('div', { className: 'hc-status' }, ch('span', { className: 'hc-live' }), 'orchestrating \u00b7 ', fmtTokens(tokenCount), ' tokens')),
    ),

    ch('div', { className: 'hc-thread', ref: bodyRef },
      chatLog.map(m => ch('div', { key: m.id, className: 'hc-msg ' + m.role },
        m.role === 'helm' && ch('span', { className: 'hc-msg-ico' }, '\u2b22'),
        ch('div', { className: 'hc-bubble' },
          ch('span', null, m.text),
          m.streaming && ch('span', { className: 'hc-cursor' }),
          m.action && !m.streaming && ch('button', { className: 'hc-action', onClick: () => onAction(m.action.kind) }, m.action.label),
        ),
      )),
    ),

    ch('div', { className: 'hc-chips' },
      CHAT_CHIPS.map(c => ch('button', { key: c, className: 'hc-chip', onClick: () => send(c) }, c))),

    ch('div', { className: 'hc-input-row' },
      ch('input', { className: 'hc-input', placeholder: 'Order the Helm-Leader\u2026', value: text,
        onChange: e => setText(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter') send(); } }),
      ch('button', { className: 'hc-send', onClick: () => send(), title: 'Send' }, '\u2191')),
  );
}

Object.assign(window, { HelmChat, leaderReply, CHAT_CHIPS });
