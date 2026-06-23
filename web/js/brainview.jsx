/* ============================================================
   HELM — Brain View: D3 force-directed knowledge graph (canvas)
   ============================================================ */
const bv = React.createElement;
const { useRef: buseRef, useEffect: buseEffect, useState: buseState } = React;

const TYPE_STYLE = {
  dir:     { shape: 'hex', r: 13, color: '#3E5876', label: 'Directory' },
  file:    { shape: 'circle', r: 8, color: '#7A8FA6', label: 'File' },
  fn:      { shape: 'square', r: 6, color: '#9B6DFF', label: 'Function / Export' },
  concept: { shape: 'rrect', r: 11, color: '#B9A5FF', label: 'Concept / Domain' },
  ext:     { shape: 'diamond', r: 7, color: '#3D5165', label: 'External dependency' },
};
const CLUSTER_COLOR = { src: '#00C2D4', api: '#9B6DFF', tests: '#2ECC71', domain: '#B9A5FF' };

function BrainView({ onClose }) {
  const wrapRef = buseRef(null);
  const canvasRef = buseRef(null);
  const simRef = buseRef(null);
  const nodesRef = buseRef(null);
  const stateRef = buseRef({ cluster: 'directory', filter: 'all', query: '', time: 100, hover: null, particles: [] });
  const [, force] = buseState(0);
  const [ui, setUi] = buseState({ cluster: 'directory', filter: 'all', query: '', time: 100 });
  const [tooltip, setTooltip] = buseState(null);
  const [full, setFull] = buseState(false);

  buseEffect(() => { stateRef.current.cluster = ui.cluster; stateRef.current.filter = ui.filter; stateRef.current.query = ui.query.toLowerCase(); stateRef.current.time = ui.time; applyClusterForce(); }, [ui]);

  function applyClusterForce() {
    const sim = simRef.current; if (!sim) return;
    const W = canvasRef.current.width / (window.devicePixelRatio || 1);
    const H = canvasRef.current.height / (window.devicePixelRatio || 1);
    const mode = stateRef.current.cluster;
    const keys = mode === 'directory' ? ['src', 'api', 'tests', 'domain']
      : mode === 'domain' ? ['domain', 'src', 'api', 'tests']
      : ['dev', 'research', 'qa', 'watch', null];
    const centers = {};
    keys.forEach((k, i) => {
      const ang = (i / keys.length) * Math.PI * 2;
      centers[k] = { x: W / 2 + Math.cos(ang) * W * 0.24, y: H / 2 + Math.sin(ang) * H * 0.26 };
    });
    const keyOf = (n) => mode === 'agent' ? (n.role || null) : n.cluster;
    sim.force('x', d3.forceX(n => (centers[keyOf(n)] || { x: W / 2 }).x).strength(0.08));
    sim.force('y', d3.forceY(n => (centers[keyOf(n)] || { y: H / 2 }).y).strength(0.08));
    sim.alphaTarget(0.08).restart();
    setTimeout(() => sim && sim.alphaTarget(0.02), 600);
  }

  buseEffect(() => {
    if (!window.d3) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const dpr = window.devicePixelRatio || 1;
    function resize() {
      const r = wrap.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    }
    resize();
    const ctx = canvas.getContext('2d');

    const nodes = BRAIN_NODES.map((n, i) => ({ ...n, idx: i }));
    const links = BRAIN_LINKS.map(l => ({ ...l, source: l.s, target: l.t }));
    nodesRef.current = nodes;

    const W = canvas.width / dpr, H = canvas.height / dpr;
    nodes.forEach(n => { n.x = W / 2 + (Math.random() - 0.5) * 200; n.y = H / 2 + (Math.random() - 0.5) * 200; });

    const sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-140))
      .force('link', d3.forceLink(links).id(d => d.id).distance(l => l.k === 'imports' ? 60 : 80).strength(0.5))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(d => (TYPE_STYLE[d.type].r) + 14))
      .velocityDecay(0.28)
      .alphaTarget(0.02);
    simRef.current = sim;
    applyClusterForce();

    // particles for hot nodes
    const st = stateRef.current;
    function spawnParticles() {
      nodes.forEach(n => {
        if (n.state === 'hot' && Math.random() < 0.06) {
          st.particles.push({ x: n.x, y: n.y, vy: -0.4 - Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.3, life: 1, color: n.role ? ROLE_META[n.role].color : '#00C2D4' });
        }
      });
      if (st.particles.length > 120) st.particles.splice(0, st.particles.length - 120);
    }

    let raf, tphase = 0;
    function draw() {
      tphase += 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#030508';
      ctx.fillRect(0, 0, W, H);

      // cluster boundaries
      if (st.cluster !== 'none') {
        const groups = {};
        nodes.forEach(n => { const k = st.cluster === 'agent' ? (n.role || 'none') : n.cluster; (groups[k] = groups[k] || []).push(n); });
        Object.entries(groups).forEach(([k, gn]) => {
          if (gn.length < 2 || k === 'none') return;
          let cx = 0, cy = 0; gn.forEach(n => { cx += n.x; cy += n.y; }); cx /= gn.length; cy /= gn.length;
          let rad = 0; gn.forEach(n => { rad = Math.max(rad, Math.hypot(n.x - cx, n.y - cy)); });
          rad += 36;
          const col = st.cluster === 'agent' ? (ROLE_META[k] ? ROLE_META[k].color : '#3D5165') : (CLUSTER_COLOR[k] || '#3D5165');
          ctx.beginPath(); ctx.ellipse(cx, cy, rad * 1.15, rad, 0, 0, Math.PI * 2);
          ctx.fillStyle = rgba(col, 0.06); ctx.fill();
          ctx.strokeStyle = rgba(col, 0.18); ctx.lineWidth = 1; ctx.stroke();
          ctx.font = '9px "JetBrains Mono", monospace'; ctx.fillStyle = rgba(col, 0.6);
          ctx.fillText((k || '').toUpperCase(), cx - rad * 0.9, cy - rad + 2);
        });
      }

      const q = st.query;
      const dim = (n) => (q && !n.label.toLowerCase().includes(q)) || (st.filter === 'hot' && n.state !== 'hot') || (st.filter === 'files' && n.type !== 'file') || (st.filter === 'fns' && n.type !== 'fn');
      const timeFade = st.time / 100;

      // edges
      links.forEach(l => {
        const s = l.source, t = l.target;
        if (dim(s) && dim(t)) ctx.globalAlpha = 0.05; else ctx.globalAlpha = 0.5 * timeFade;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = l.k === 'similar' ? '#9B6DFF' : (l.k === 'inherits' ? '#F5A623' : '#2A3F55');
        ctx.lineWidth = l.k === 'imports' ? 1.4 : 1;
        if (l.k === 'calls') { ctx.setLineDash([4, 4]); ctx.lineDashOffset = -tphase * 0.4; }
        else if (l.k === 'similar') { ctx.setLineDash([1, 5]); }
        else ctx.setLineDash([]);
        ctx.stroke(); ctx.setLineDash([]);
      });
      ctx.globalAlpha = 1;

      // particles
      spawnParticles();
      st.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= 0.02; });
      st.particles = st.particles.filter(p => p.life > 0);
      st.particles.forEach(p => {
        ctx.globalAlpha = p.life * 0.7; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // nodes
      nodes.forEach(n => {
        const ts = TYPE_STYLE[n.type];
        const ss = BRAIN_STATE_STYLE[n.state];
        const col = (n.type === 'fn' && n.role) ? ROLE_META[n.role].color : (n.role && n.state === 'hot' ? ROLE_META[n.role].color : ts.color);
        let alpha = ss.opacity * timeFade;
        if (dim(n)) alpha *= 0.18;
        const isHover = st.hover === n.id;
        ctx.globalAlpha = alpha;

        // glow
        if (ss.glow > 0 && !dim(n)) {
          const pulse = n.state === 'hot' ? (0.6 + 0.4 * Math.sin(tphase * 0.08)) : 1;
          ctx.shadowColor = col; ctx.shadowBlur = ss.glow * pulse;
        } else ctx.shadowBlur = 0;

        ctx.fillStyle = n.state === 'unknown' ? 'transparent' : col;
        ctx.strokeStyle = col; ctx.lineWidth = isHover ? 2.2 : 1.4;
        const r = ts.r * (isHover ? 1.25 : 1);
        drawShape(ctx, ts.shape, n.x, n.y, r);
        if (n.state === 'unknown') ctx.stroke(); else { ctx.fill(); if (isHover) ctx.stroke(); }
        ctx.shadowBlur = 0;

        // hot inner pulse ring
        if (n.state === 'hot' && !dim(n)) {
          const rr = r + 4 + (tphase * 0.4 % 12);
          ctx.globalAlpha = alpha * Math.max(0, 0.5 - (rr - r) / 26);
          ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
        }

        // labels (LOD)
        const showLabel = isHover || n.type === 'dir' || n.type === 'concept' || (n.state === 'hot');
        if (showLabel && !dim(n)) {
          ctx.globalAlpha = Math.min(1, alpha + 0.3);
          ctx.font = (n.type === 'dir' ? '10px' : '9px') + ' "JetBrains Mono", monospace';
          ctx.fillStyle = isHover ? '#E8EDF2' : '#7A8FA6';
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y + r + 11);
          ctx.textAlign = 'start';
        }
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }
    draw();

    // interaction
    function nodeAt(mx, my) {
      let best = null, bd = 18;
      nodes.forEach(n => { const d = Math.hypot(n.x - mx, n.y - my); if (d < bd + TYPE_STYLE[n.type].r) { bd = d; best = n; } });
      return best;
    }
    let dragNode = null;
    const getXY = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = (e) => { const { x, y } = getXY(e); const n = nodeAt(x, y); if (n) { dragNode = n; n.fx = n.x; n.fy = n.y; sim.alphaTarget(0.15).restart(); } };
    const onMove = (e) => {
      const { x, y } = getXY(e);
      if (dragNode) { dragNode.fx = x; dragNode.fy = y; return; }
      const n = nodeAt(x, y);
      st.hover = n ? n.id : null;
      if (n) setTooltip({ x: e.clientX, y: e.clientY, node: n });
      else setTooltip(null);
      canvas.style.cursor = n ? 'pointer' : 'grab';
    };
    const onUp = () => { if (dragNode) { dragNode.fx = null; dragNode.fy = null; dragNode = null; sim.alphaTarget(0.02); } };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf); sim.stop();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', resize);
    };
  }, [full]);

  function drawShape(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (shape === 'diamond') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
    else if (shape === 'rrect') { const w = r * 2.4, hh2 = r * 1.5, rad = 5; ctx.moveTo(x - w/2 + rad, y - hh2/2); ctx.arcTo(x + w/2, y - hh2/2, x + w/2, y + hh2/2, rad); ctx.arcTo(x + w/2, y + hh2/2, x - w/2, y + hh2/2, rad); ctx.arcTo(x - w/2, y + hh2/2, x - w/2, y - hh2/2, rad); ctx.arcTo(x - w/2, y - hh2/2, x + w/2, y - hh2/2, rad); ctx.closePath(); }
    else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
  }

  const stage = bv('div', { className: 'brain-stage', ref: wrapRef, style: full ? { position: 'fixed', inset: 0, zIndex: 120 } : null },
    bv('canvas', { ref: canvasRef, className: 'brain-canvas' }),

    bv('div', { className: 'brain-controls' },
      bv('div', { className: 'brain-panel' },
        bv('div', { className: 'bp-label' }, 'CLUSTER BY'),
        bv('div', { className: 'brain-seg' },
          [['directory', 'Dir'], ['domain', 'Domain'], ['agent', 'Agent']].map(([v, l]) =>
            bv('button', { key: v, className: ui.cluster === v ? 'on' : '', onClick: () => setUi(u => ({ ...u, cluster: v })) }, l)))),

      bv('div', { className: 'brain-panel' },
        bv('div', { className: 'bp-label' }, 'FILTER'),
        bv('div', { className: 'brain-seg' },
          [['all', 'All'], ['hot', 'Hot'], ['files', 'Files'], ['fns', 'Fns']].map(([v, l]) =>
            bv('button', { key: v, className: ui.filter === v ? 'on' : '', onClick: () => setUi(u => ({ ...u, filter: v })) }, l)))),

      bv('div', { className: 'brain-panel' },
        bv('div', { className: 'bp-label' }, 'SEARCH'),
        bv('input', { className: 'brain-search', placeholder: 'highlight nodes\u2026', value: ui.query, onChange: e => setUi(u => ({ ...u, query: e.target.value })) })),

      bv('div', { className: 'brain-panel' },
        bv('div', { className: 'bp-label' }, 'TIME SCRUBBER \u00b7 replay learning'),
        bv('div', { className: 'brain-scrubber' },
          bv('input', { type: 'range', min: 0, max: 100, value: ui.time, onChange: e => setUi(u => ({ ...u, time: +e.target.value })) }),
          bv('span', { className: 'mono-num', style: { fontSize: 10, color: 'var(--text-muted)', width: 34 } }, ui.time + '%'))),

      bv('div', { className: 'brain-panel' },
        bv('div', { className: 'bp-label' }, 'LEGEND'),
        Object.entries(TYPE_STYLE).map(([k, v]) =>
          bv('div', { key: k, className: 'brain-legend-row' },
            bv('span', { style: { width: 11, height: 11, display: 'inline-block', borderRadius: v.shape === 'circle' ? '50%' : (v.shape === 'rrect' ? 3 : 0), transform: v.shape === 'diamond' ? 'rotate(45deg)' : 'none', background: v.color, border: k === 'ext' ? 'none' : 'none' } }),
            v.label)),
      ),
    ),

    tooltip && bv('div', { className: 'brain-tooltip', style: { left: Math.min(tooltip.x + 14, window.innerWidth - 260), top: tooltip.y + 14 } },
      bv('div', { className: 'btt-name' }, tooltip.node.label),
      bv('div', { className: 'btt-meta' }, TYPE_STYLE[tooltip.node.type].label + ' \u00b7 ' + tooltip.node.state.toUpperCase()),
      tooltip.node.role && bv('div', { className: 'btt-meta', style: { color: ROLE_META[tooltip.node.role].color } }, 'last touched by ' + ROLE_META[tooltip.node.role].name)),
  );

  if (full) {
    return bv('div', null, stage,
      bv('div', { style: { position: 'fixed', top: 16, right: 16, zIndex: 130, display: 'flex', gap: 8 } },
        bv('button', { className: 'tb-btn', onClick: () => setFull(false) }, '\u2922 Dock'),
        bv('button', { className: 'tb-btn', onClick: onClose }, '\u2715 Close')),
    );
  }

  return bv('div', { className: 'drawer', style: { width: 600 } },
    bv('div', { className: 'drawer-head' },
      bv('div', { className: 'drawer-title', style: { color: 'var(--role-research)' } }, bv(IconHex, { size: 16 }), 'BRAIN VIEW'),
      bv('div', { style: { display: 'flex', gap: 6 } },
        bv('button', { className: 'icon-x', onClick: () => setFull(true), title: 'Full screen' }, '\u26f6'),
        bv('button', { className: 'icon-x', onClick: onClose }, '\u2715'))),
    bv('div', { style: { flex: 1, position: 'relative' } }, stage),
  );
}

Object.assign(window, { BrainView });
