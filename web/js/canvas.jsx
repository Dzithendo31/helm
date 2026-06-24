/* ============================================================
   HELM — Canvas: pan/zoom, edges, traveling cards, perimeter
   ============================================================ */
const { useState: cuseState, useRef: cuseRef, useEffect: cuseEffect, useCallback: cuseCallback } = React;

// cubic bezier helper for a point at t along a vertical-ish curve
function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const x = mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x;
  const y = mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y;
  return { x, y };
}
function edgePath(a, b) {
  const dy = (b.y - a.y);
  const c1 = { x: a.x, y: a.y + dy * 0.45 };
  const c2 = { x: b.x, y: b.y - dy * 0.45 };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, c1, c2 };
}
function hPath(a, b) {
  const dx = (b.x - a.x);
  const c1 = { x: a.x + dx * 0.5, y: a.y };
  const c2 = { x: b.x - dx * 0.5, y: b.y };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, c1, c2 };
}

// A card that travels along an edge using rAF
function TravelCard({ travel, from, to, c1, c2, onArrive }) {
  const ref = cuseRef(null);
  cuseEffect(() => {
    if (!from || !to) return;
    let raf, startT = null;
    const dur = travel.dur || 1800;
    const p0 = from, p3 = to;
    const cc1 = c1 || { x: from.x, y: from.y + (to.y - from.y) * 0.45 };
    const cc2 = c2 || { x: to.x, y: to.y - (to.y - from.y) * 0.45 };
    function frame(ts) {
      if (startT == null) startT = ts;
      let t = (ts - startT) / dur;
      if (t >= 1) { t = 1; }
      const e = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; // easeInOutQuad
      const pt = bezierPoint(p0, cc1, cc2, p3, e);
      if (ref.current) {
        ref.current.style.left = pt.x + 'px';
        ref.current.style.top = pt.y + 'px';
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else if (onArrive) onArrive(travel.id);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [from && from.x, from && from.y, to && to.x, to && to.y, travel.id]);

  if (!from || !to) return null;
  return React.createElement('div', {
    ref, className: 'travel-card' + (travel.frozen ? ' frozen' : ''),
    style: { left: from.x, top: from.y, transform: 'translate(-50%,-50%)',
             borderLeftColor: travel.color, borderLeftWidth: 3 },
  },
    React.createElement('span', { style: { color: travel.color } }, travel.icon),
    React.createElement('span', null, travel.label),
  );
}

function Canvas(props) {
  const { teamMode, optimizeMode, selected, blockedTeam, questionTeam, dockedMap, optCosts,
          cotText, showLeaderActions, leaderAlerting, travels, layoutVersion,
          onSelect, onSelectAgent, onAddAgent, onOpenArtifact,
          onAccept, onModify, onReject, zoom, offset, setZoom, setOffset, startMs, alertRing } = props;

  const vpRef = cuseRef(null);
  const nodeEls = cuseRef({});
  const [rects, setRects] = cuseState({});
  const panState = cuseRef(null);

  const measure = cuseCallback(() => {
    const next = {};
    Object.entries(nodeEls.current).forEach(([id, el]) => {
      if (!el) return;
      next[id] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    });
    setRects(next);
  }, []);

  cuseEffect(() => {
    const t = setTimeout(measure, 60);
    return () => clearTimeout(t);
  }, [teamMode, layoutVersion, showLeaderActions, cotText.length, measure]);

  cuseEffect(() => {
    const ro = new ResizeObserver(() => measure());
    Object.values(nodeEls.current).forEach(el => el && ro.observe(el));
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [teamMode, layoutVersion, measure]);

  const setRef = (id) => (el) => { if (el) nodeEls.current[id] = el; };

  // anchors
  const bottomMid = (r) => r ? { x: r.x + r.w / 2, y: r.y + r.h } : null;
  const topMid = (r) => r ? { x: r.x + r.w / 2, y: r.y } : null;
  const leftMid = (r) => r ? { x: r.x, y: r.y + r.h / 2 } : null;
  const rightMid = (r) => r ? { x: r.x + r.w, y: r.y + r.h / 2 } : null;

  const leader = rects['helm-leader'];
  const teamRects = { research: rects['research-team'], dev: rects['dev-team'], qa: rects['qa-team'], watch: rects['watchmen'] };

  // build edges
  const edges = [];
  if (leader) {
    ['research-team', 'dev-team', 'qa-team'].forEach(tid => {
      const r = rects[tid];
      if (r) edges.push({ id: 'h-' + tid, ...edgePath(bottomMid(leader), topMid(r)), kind: 'hier' });
    });
  }
  if (teamRects.research && teamRects.dev)
    edges.push({ id: 'pipe-rd', ...hPath(rightMid(teamRects.research), leftMid(teamRects.dev)), kind: 'pipe', from: 'research', to: 'dev' });
  if (teamRects.dev && teamRects.qa)
    edges.push({ id: 'pipe-dq', ...hPath(rightMid(teamRects.dev), leftMid(teamRects.qa)), kind: 'pipe', from: 'dev', to: 'qa' });
  if (teamRects.watch && teamRects.dev)
    edges.push({ id: 'watch-d', ...hPath(leftMid(teamRects.watch), rightMid(teamRects.dev)), kind: 'watch' });
  if (teamRects.watch && teamRects.qa)
    edges.push({ id: 'watch-q', ...hPath(leftMid(teamRects.watch), topMid(teamRects.qa)), kind: 'watch' });
  // blocker edge
  if (blockedTeam === 'dev-team' && teamRects.qa && teamRects.dev)
    edges.push({ id: 'blk', ...hPath(leftMid(teamRects.qa), rightMid(teamRects.dev)), kind: 'blocker' });

  // perimeter rect around all nodes
  let perim = null;
  const allR = Object.values(rects);
  if (allR.length >= 4) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    allR.forEach(r => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    const pad = 40;
    perim = { left: minX - pad, top: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
  }

  // pan handlers
  const onMouseDown = (e) => {
    if (e.target.closest('.node')) return;
    panState.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
  };
  cuseEffect(() => {
    const mm = (e) => {
      if (!panState.current) return;
      setOffset({ x: panState.current.ox + (e.clientX - panState.current.sx), y: panState.current.oy + (e.clientY - panState.current.sy) });
    };
    const mu = () => { panState.current = null; };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
  }, [offset]);

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(z => Math.max(0.4, Math.min(1.6, z - e.deltaY * 0.0015)));
  };

  const anchorOf = (id) => {
    const r = rects[id];
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  };

  return React.createElement('div', { className: 'canvas-wrap', onMouseDown, onWheel,
      style: { cursor: panState.current ? 'grabbing' : 'default' } },
    React.createElement('div', { className: 'canvas-dots', style: { transform: `translate(${offset.x % 22}px, ${offset.y % 22}px)` } }),

    React.createElement('div', { ref: vpRef, className: 'canvas-viewport',
        style: { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` } },

      // surveillance perimeter
      perim && React.createElement('div', { className: 'watch-perimeter', style: perim }),

      // edges
      React.createElement('svg', { className: 'canvas-edges' },
        React.createElement('defs', null,
          React.createElement('linearGradient', { id: 'g-rd', x1: '0', y1: '0', x2: '1', y2: '0' },
            React.createElement('stop', { offset: '0%', stopColor: '#9B6DFF' }),
            React.createElement('stop', { offset: '100%', stopColor: '#00C2D4' })),
          React.createElement('linearGradient', { id: 'g-dq', x1: '0', y1: '0', x2: '1', y2: '0' },
            React.createElement('stop', { offset: '0%', stopColor: '#00C2D4' }),
            React.createElement('stop', { offset: '100%', stopColor: '#2ECC71' })),
          React.createElement('marker', { id: 'arrow', markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto' },
            React.createElement('path', { d: 'M0,0 L6,3 L0,6', fill: 'none', stroke: '#7A8FA6', strokeWidth: 1.4 })),
        ),
        edges.map(e => {
          if (e.kind === 'hier')
            return React.createElement('path', { key: e.id, d: e.d, fill: 'none', stroke: '#F5A623',
              strokeWidth: 2, strokeOpacity: 0.55, strokeDasharray: '6 7',
              style: { animation: 'dashflow 1.2s linear infinite' } });
          if (e.kind === 'pipe')
            return React.createElement('path', { key: e.id, d: e.d, fill: 'none',
              stroke: `url(#g-${e.from[0]}${e.to[0]})`, strokeWidth: 1.6, strokeOpacity: 0.7 });
          if (e.kind === 'watch')
            return React.createElement('g', { key: e.id },
              React.createElement('path', { d: e.d, fill: 'none', stroke: '#FF3B30', strokeWidth: 1.2,
                strokeOpacity: 0.4, strokeDasharray: '3 6' }));
          if (e.kind === 'blocker')
            return React.createElement('path', { key: e.id, d: e.d, fill: 'none', stroke: '#FF3B30',
              strokeWidth: 2, strokeDasharray: '5 5', style: { animation: 'dashflow 0.8s linear infinite' } });
          return null;
        }),
      ),

      // traveling cards
      travels.map(tv => {
        const from = anchorOf(tv.fromId) || (tv.fromId === 'helm-leader' && leader ? bottomMid(leader) : null);
        const to = anchorOf(tv.toId);
        return React.createElement(TravelCard, { key: tv.id, travel: tv, from, to,
          c1: null, c2: null, onArrive: props.onTravelArrive });
      }),

      // alert ring
      alertRing && (() => {
        const r = rects['watchmen'];
        if (!r) return null;
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const size = 1600;
        return React.createElement('div', { key: alertRing, className: 'alert-ring',
          style: { left: cx - size/2, top: cy - size/2, width: size, height: size } });
      })(),

      // Helm-Leader
      React.createElement('div', { ref: setRef('helm-leader') },
        React.createElement(HelmLeaderNode, {
          layout: NODE_LAYOUT['helm-leader'], selected: selected === 'helm-leader',
          cotText, showActions: showLeaderActions, alerting: leaderAlerting,
          onClick: onSelect, onAccept, onModify, onReject,
        })),

      // Teams
      TEAMS.map(team => React.createElement('div', { key: team.id, ref: setRef(team.id) },
        React.createElement(TeamNode, {
          team, layout: NODE_LAYOUT[team.id], live: props.live, selected: selected === team.id,
          liveTeam: props.liveTeams && props.liveTeams[team.id],
          teamMode, optimizeMode, blocked: blockedTeam === team.id, question: questionTeam === team.id,
          dockedArtifacts: dockedMap[team.id], optCost: optCosts[team.id],
          isWatch: team.id === 'watchmen', startMs,
          onClick: onSelect, onSelectAgent, onAddAgent, onOpenArtifact,
        })),
      ),
    ),

    // controls
    React.createElement('div', { className: 'canvas-controls' },
      React.createElement('button', { className: 'cc-btn', onClick: () => setZoom(z => Math.min(1.6, z + 0.15)), title: 'Zoom in' }, React.createElement(IconPlus, { size: 16 })),
      React.createElement('button', { className: 'cc-btn', onClick: () => setZoom(z => Math.max(0.4, z - 0.15)), title: 'Zoom out' }, React.createElement(IconMinus, { size: 16 })),
      React.createElement('button', { className: 'cc-btn', onClick: () => { setZoom(0.62); setOffset({ x: 30, y: 44 }); }, title: 'Fit to view' }, React.createElement(IconFit, { size: 15 })),
      React.createElement('button', { className: 'cc-btn', onClick: props.onToggleMinimap, title: 'Mini-map', style: props.showMinimap ? { color: 'var(--role-dev)', borderColor: 'var(--helm-border-bright)' } : null }, React.createElement(IconMap, { size: 15 })),
      React.createElement('div', { className: 'zoom-readout' }, Math.round(zoom * 100) + '%'),
    ),

    // minimap
    props.showMinimap && React.createElement('div', { className: 'minimap' },
      React.createElement('svg', { width: '100%', height: '100%', viewBox: '0 0 1500 560' },
        edges.filter(e => e.kind !== 'watch').map(e => React.createElement('path', { key: e.id, d: e.d, fill: 'none', stroke: '#2A3F55', strokeWidth: 3 })),
        Object.entries(rects).map(([id, r]) => {
          const role = id === 'helm-leader' ? 'helm' : (teamById(id) ? teamById(id).role : 'dev');
          return React.createElement('rect', { key: id, x: r.x, y: r.y, width: r.w, height: r.h, rx: 10,
            fill: rgba(ROLE_META[role].color, 0.25), stroke: ROLE_META[role].color, strokeWidth: 2 });
        }),
      ),
    ),
  );
}

Object.assign(window, { Canvas, TravelCard, edgePath, hPath });
