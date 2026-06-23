/* ============================================================
   HELM — Icon glyphs (simple SVG) + tiny shared bits
   ============================================================ */
const { createElement: h } = React;

function Svg(props) {
  const { size = 16, children, ...rest } = props;
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', ...rest }, children);
}

// ship's wheel / helm
const IconHelm = (p) => h(Svg, p,
  h('circle', { cx: 12, cy: 12, r: 3 }),
  h('circle', { cx: 12, cy: 12, r: 9 }),
  h('line', { x1: 12, y1: 1, x2: 12, y2: 5 }),
  h('line', { x1: 12, y1: 19, x2: 12, y2: 23 }),
  h('line', { x1: 1, y1: 12, x2: 5, y2: 12 }),
  h('line', { x1: 19, y1: 12, x2: 23, y2: 12 }),
  h('line', { x1: 4.2, y1: 4.2, x2: 7, y2: 7 }),
  h('line', { x1: 17, y1: 17, x2: 19.8, y2: 19.8 }),
  h('line', { x1: 19.8, y1: 4.2, x2: 17, y2: 7 }),
  h('line', { x1: 7, y1: 17, x2: 4.2, y2: 19.8 }),
);
const IconHex = (p) => h(Svg, p, h('path', { d: 'M12 2l8.5 5v10L12 22l-8.5-5V7z' }));
const IconBulb = (p) => h(Svg, p,
  h('path', { d: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12c.6.6 1 1.4 1 2.2V17h6v-.8c0-.8.4-1.6 1-2.2A7 7 0 0 0 12 2z' }));
const IconPlus = (p) => h(Svg, p, h('line', { x1: 12, y1: 5, x2: 12, y2: 19 }), h('line', { x1: 5, y1: 12, x2: 19, y2: 12 }));
const IconMinus = (p) => h(Svg, p, h('line', { x1: 5, y1: 12, x2: 19, y2: 12 }));
const IconFit = (p) => h(Svg, p,
  h('path', { d: 'M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4' }));
const IconMap = (p) => h(Svg, p,
  h('path', { d: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14' }));
const IconChevron = (p) => h(Svg, p, h('polyline', { points: '6 9 12 15 18 9' }));
const IconFolder = (p) => h(Svg, p, h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }));
const IconFile = (p) => h(Svg, p, h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }), h('polyline', { points: '14 2 14 8 20 8' }));
const IconSearch = (p) => h(Svg, p, h('circle', { cx: 11, cy: 11, r: 7 }), h('line', { x1: 21, y1: 21, x2: 16.5, y2: 16.5 }));
const IconPause = (p) => h(Svg, p, h('rect', { x: 6, y: 5, width: 4, height: 14 }), h('rect', { x: 14, y: 5, width: 4, height: 14 }));
const IconPlay = (p) => h(Svg, p, h('polygon', { points: '6 4 20 12 6 20 6 4' }));
const IconTrash = (p) => h(Svg, p, h('path', { d: 'M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6' }));
const IconCopy = (p) => h(Svg, p, h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }), h('path', { d: 'M5 15V5a2 2 0 0 1 2-2h10' }));
const IconBolt = (p) => h(Svg, p, h('polygon', { points: '13 2 4 14 11 14 10 22 20 9 13 9 13 2' }));
const IconPanelLeft = (p) => h(Svg, p, h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('line', { x1: 9, y1: 4, x2: 9, y2: 20 }));
const IconPanelRight = (p) => h(Svg, p, h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('line', { x1: 15, y1: 4, x2: 15, y2: 20 }));

// status indicator dot
function StatusInd({ status }) {
  return h('span', { className: 'status-ind ' + status, 'aria-label': 'status ' + status });
}

// tiny markdown renderer (headers, code fences, inline code, tables, lists, bold)
function renderMarkdown(md) {
  const lines = (md || '').split('\n');
  const out = []; let i = 0; let key = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (line.startsWith('```')) {
      const code = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++;
      out.push(h('pre', { key: key++ }, h('code', null, code.join('\n'))));
      continue;
    }
    if (line.startsWith('### ')) { out.push(h('h3', { key: key++ }, line.slice(4))); i++; continue; }
    if (line.startsWith('## ')) { out.push(h('h3', { key: key++ }, line.slice(3))); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      const parse = (r) => r.split('|').slice(1, -1).map(c => c.trim());
      const header = parse(rows[0]);
      const body = rows.slice(2).map(parse);
      out.push(h('table', { key: key++ },
        h('thead', null, h('tr', null, header.map((c, ci) => h('th', { key: ci }, inlineMd(c))))),
        h('tbody', null, body.map((r, ri) => h('tr', { key: ri }, r.map((c, ci) => h('td', { key: ci }, inlineMd(c))))))
      ));
      continue;
    }
    if (line.match(/^[-*] /) || line.match(/^- \[[ x]\]/)) {
      const items = [];
      while (i < lines.length && (lines[i].match(/^[-*] /) || lines[i].match(/^- \[[ x]\]/))) {
        let t = lines[i].replace(/^[-*] /, '');
        const cb = t.match(/^\[([ x])\] (.*)/);
        if (cb) { items.push(h('li', { key: items.length }, (cb[1] === 'x' ? '\u2611 ' : '\u2610 '), inlineMd(cb[2]))); }
        else { items.push(h('li', { key: items.length }, inlineMd(t))); }
        i++;
      }
      out.push(h('ul', { key: key++ }, items));
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(h('p', { key: key++ }, inlineMd(line)));
    i++;
  }
  return out;
}
function inlineMd(text) {
  const parts = []; let rest = text; let key = 0;
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/;
  let m;
  while ((m = rest.match(re))) {
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    if (m[2] !== undefined) parts.push(h('strong', { key: key++ }, m[2]));
    else if (m[3] !== undefined) parts.push(h('code', { key: key++ }, m[3]));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) parts.push(rest);
  return parts;
}

Object.assign(window, {
  Svg, IconHelm, IconHex, IconBulb, IconPlus, IconMinus, IconFit, IconMap, IconChevron,
  IconFolder, IconFile, IconSearch, IconPause, IconPlay, IconTrash, IconCopy, IconBolt,
  IconPanelLeft, IconPanelRight, StatusInd, renderMarkdown, inlineMd,
});
