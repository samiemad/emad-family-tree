// Illustrated tree: the chosen person is the trunk, descendants are branches,
// ancestors are roots. Each generation is one level: a person with children
// sits where his branch forks into theirs; a person without children ends in a
// crown. Only a few generations are drawn at a time (?down=2&up=2), with
// buttons and "+N" buds to show more.
(function () {
  const people = JSON.parse(document.getElementById('people-data').textContent);
  if (!people.length) return;
  const byId = new Map(people.map(p => [p.id, p]));
  const T = Object.assign({ growHere: 'Grow tree from here', showMore: 'Show more' }, window.I18N || {});

  const NOW = new Date().getFullYear();
  const GEN = 28;       // assumed years per generation when a birth year is missing
  const LEVEL = 175;    // height of one generation above ground
  const RLEVEL = 125;   // depth of one generation below ground
  const COL = 150;      // horizontal space per crown
  const MIN_ZOOM = 0.6; // never shrink below this when fitting: pan instead
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const C = {
    sky: '#f6f3ee', soil: '#d9c7ad', soilDeep: '#b89c7b', grass: '#8fae6b', tag: '#fffdf9', tagLine: '#cdbfa9',
    bark: '#5e4634', root: '#6e5441', ink: '#2b2620', muted: '#7a7065', soilInk: '#4a3a2c',
    living: ['#7fa35b', '#6b9a4e', '#94b86a', '#5d8a47', '#a5c47a'],
    past: ['#d9a441', '#c97a3a', '#b5662f', '#e0b860', '#a8743d'],
  };

  // ---- dates (only to tell the living from the dead, and to order siblings) ----
  const yearOf = s => { const m = String(s ?? '').match(/\d{4}/); return m ? +m[0] : null; };
  const born = new Map();
  people.forEach(p => {
    const y = yearOf(p.data.born), d = yearOf(p.data.died);
    if (y) born.set(p.id, y);
    else if (d) born.set(p.id, d - 60);
  });
  for (let changed = true; changed;) {     // estimate the rest from relatives
    changed = false;
    people.forEach(p => {
      if (born.has(p.id)) return;
      const near = ids => ids.filter(id => born.has(id)).map(id => born.get(id));
      const ps = near(p.rels.parents), cs = near(p.rels.children), ss = near(p.rels.spouses);
      const y = ps.length ? Math.max(...ps) + GEN : cs.length ? Math.min(...cs) - GEN : ss.length ? ss[0] : null;
      if (y !== null) { born.set(p.id, y); changed = true; }
    });
  }
  people.forEach(p => born.has(p.id) || born.set(p.id, NOW - 40));
  const isLiving = id => !yearOf(byId.get(id).data.died) && born.get(id) > NOW - 100;
  const span = d => [d.born, d.died].some(Boolean) ? `${d.born || '?'} – ${d.died || ''}`.trim() : '';

  const childrenOf = id => byId.get(id).rels.children.filter(k => byId.has(k)).sort((a, b) => {
    const oa = byId.get(a).data.order, ob = byId.get(b).data.order;   // `order` among siblings, else birth year
    return oa && ob ? oa - ob : born.get(a) - born.get(b);
  });
  const parentsOf = id => byId.get(id).rels.parents.filter(p => byId.has(p));
  const countBelow = (id, seen = new Set([id])) => childrenOf(id).reduce((n, k) =>
    seen.has(k) ? n : (seen.add(k), n + 1 + countBelow(k, seen)), 0);

  // ---- helpers ---------------------------------------------------------------
  const easeOut = t => 1 - Math.pow(1 - t, 2.2);
  const rng = seed => {
    let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const smooth = d3.line().curve(d3.curveBasis);
  // A filled shape following centreline (x(t), y(t)) with width w(t), t in 0..1.
  function taper(x, y, w, n = 32) {
    const L = [], R = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, t2 = Math.min(1, t + 0.002), t1 = t2 - 0.002;
      const dx = x(t2) - x(t1), dy = y(t2) - y(t1), len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, h = w(t) / 2;
      L.push([x(t) + nx * h, y(t) + ny * h]);
      R.push([x(t) - nx * h, y(t) - ny * h]);
    }
    return smooth([...L, ...R.reverse()]) + 'Z';
  }
  const LEAF = 'M0,0 C4,-5 11,-5 16,0 C11,5 4,5 0,0Z';
  function leaves(g, x, y, n, palette, rand, spread = 14, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = rand() * spread;
      g.append('path').attr('d', LEAF)
        .attr('fill', palette[Math.floor(rand() * palette.length)])
        .attr('opacity', 0.85 + rand() * 0.15)
        .attr('transform', `translate(${x + Math.cos(a) * r},${y + Math.sin(a) * r * 0.7}) rotate(${rand() * 360}) scale(${size * (0.7 + rand() * 0.5)})`);
    }
  }

  // ---- drawing -------------------------------------------------------------
  const svg = d3.select('#grove').attr('font-family', FONT);
  const world = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.15, 4]).on('zoom', e => world.attr('transform', e.transform));
  svg.call(zoom).on('dblclick.zoom', null);
  let related = () => new Set();
  let content = null;   // bounding box of the drawing itself (not the endless sky/soil)

  const state = { root: null, down: 2, up: 2 };

  function render() {
    const rootId = state.root;
    world.selectAll('*').remove();

    // Descendants, `down` generations: a tidy tree, each parent centred over his children.
    const seen = new Set([rootId]);
    const hier = (function build(id, depth) {
      const node = { id, hidden: 0 };
      const ks = childrenOf(id).filter(k => !seen.has(k));
      if (depth >= state.down) { node.hidden = countBelow(id); return node; }
      ks.forEach(k => seen.add(k));
      if (ks.length) node.children = ks.map(k => build(k, depth + 1));
      return node;
    })(rootId, 0);
    const pos = new Map(), parentOf = new Map(), kidsOf = new Map(), hidden = new Map(), order = [];
    const h = d3.hierarchy(hier);
    d3.tree().nodeSize([COL, LEVEL]).separation((a, b) => a.parent === b.parent ? 1 : 1.2)(h);
    h.each(n => {
      pos.set(n.data.id, { x: n.x - h.x, y: -(n.depth + 1) * LEVEL });
      kidsOf.set(n.data.id, (n.children || []).map(c => c.data.id));
      if (n.parent) parentOf.set(n.data.id, n.parent.data.id);
      hidden.set(n.data.id, n.data.hidden);
      order.push(n.data.id);
    });
    const below = new Map();   // visible descendants, for branch thickness
    [...order].reverse().forEach(id => below.set(id, kidsOf.get(id).reduce((s, k) => s + 1 + below.get(k), 0)));
    const width = id => 3 + 2.4 * Math.sqrt(1 + below.get(id));

    // Ancestors, `up` generations: a pedigree fanning out underground.
    const anc = [], childOf = new Map(), seenA = new Set([rootId]);
    (function dig(id, x, spread, level) {
      if (level >= state.up) return;
      parentsOf(id).filter(p => !seenA.has(p)).forEach((p, i, ps) => {
        seenA.add(p);
        childOf.set(p, id);
        const ax = x + (i - (ps.length - 1) / 2) * spread;
        anc.push({ id: p, x: ax, y: (level + 1) * RLEVEL, more: level + 1 >= state.up && parentsOf(p).length > 0 });
        dig(p, ax, Math.max(spread * 0.6, COL * 0.9), level + 1);
      });
    })(rootId, 0, COL * 1.4, 0);
    const ancPos = new Map(anc.map(a => [a.id, a]).concat([[rootId, { x: 0, y: 0 }]]));

    const bgLayer = world.append('g'), rootLayer = world.append('g'), branchLayer = world.append('g'),
      leafLayer = world.append('g'), labelLayer = world.append('g');

    // roots
    anc.forEach(({ id, x, y }) => {
      const c = ancPos.get(childOf.get(id));
      const w0 = 3 + 2.2 * Math.sqrt(1 + anc.filter(a => a.y >= y).length);
      const g = rootLayer.append('g').attr('data-id', id);
      g.append('path').attr('fill', C.root)
        .attr('d', taper(t => c.x + (x - c.x) * easeOut(t), t => c.y + (y - c.y) * t, t => w0 - (w0 - 2) * t));
      const rand = rng(id);
      for (let i = 0; i < 4; i++) {   // rootlets
        const a = Math.PI / 2 + (rand() - 0.5) * 2.2, l = 14 + rand() * 18;
        g.append('path').attr('stroke', C.root).attr('stroke-width', 1).attr('fill', 'none')
          .attr('d', `M${x},${y} q${Math.cos(a) * l * 0.5 + 4},${Math.sin(a) * l * 0.5} ${Math.cos(a) * l},${Math.sin(a) * l}`);
      }
    });

    // branches: from the parent's fork (or the ground) up to the person's own point
    order.forEach(id => {
      const p = pos.get(id), from = id === rootId ? { x: 0, y: 0 } : pos.get(parentOf.get(id));
      const w = width(id), wFrom = id === rootId ? w * 1.5 : Math.min(w * 1.15, width(parentOf.get(id)));
      const flare = id === rootId ? t => 1 + 0.9 * Math.pow(1 - t, 6) : () => 1;
      const tipW = kidsOf.get(id).length ? w : Math.max(2, w * 0.6);
      branchLayer.append('path').attr('data-id', id).attr('fill', C.bark)
        .attr('d', taper(t => from.x + (p.x - from.x) * easeOut(t), t => from.y + (p.y - from.y) * t,
          t => (wFrom + (tipW - wFrom) * t) * flare(t), 40));
      const rand = rng(id), g = leafLayer.append('g').attr('data-id', id), palette = isLiving(id) ? C.living : C.past;
      for (let i = 0; i < 5; i++) {   // a few leaves along the branch
        const t = 0.35 + rand() * 0.55;
        leaves(g, from.x + (p.x - from.x) * easeOut(t), from.y + (p.y - from.y) * t, 2, palette, rand, 8, 0.75);
      }
      if (!kidsOf.get(id).length) {   // crown: soft blobs of colour with leaves on top
        for (let i = 0; i < 5; i++) {
          g.append('circle').attr('cx', p.x + (rand() - 0.5) * 40).attr('cy', p.y - 10 + (rand() - 0.6) * 22)
            .attr('r', 15 + rand() * 11).attr('fill', palette[i % palette.length]).attr('opacity', 0.28);
        }
        leaves(g, p.x, p.y - 12, isLiving(id) ? 30 : 22, palette, rand, 28);
      } else {
        leaves(g, p.x, p.y, 6, palette, rand, 16, 0.8);   // a little foliage at the fork
      }
    });

    // labels
    const name = id => byId.get(id).data.name;
    const textLines = (g, id, fill, sub) => {
      const d = byId.get(id).data;
      g.append('text').attr('font-size', 14).attr('font-weight', 650).attr('fill', fill).text(d.name);
      const s = span(d);
      if (s) g.append('text').attr('y', 16).attr('font-size', 12).attr('fill', sub)
        .text('\u2066' + s + '\u2069');   // left-to-right isolate: "1921 – 1998" in order on right-to-left pages too
      return s ? 2 : 1;
    };
    const more = (parent, x, y, n, title, onClick) => {
      const g = parent.append('g').attr('class', 'more').attr('transform', `translate(${x},${y})`).style('cursor', 'pointer');
      g.append('title').text(title);
      const t = n ? `+${n}` : '⋯';
      const w = 14 + t.length * 8;
      g.append('rect').attr('x', -w / 2).attr('y', -11).attr('width', w).attr('height', 22).attr('rx', 11)
        .attr('fill', C.tag).attr('stroke', C.tagLine);
      g.append('text').attr('y', 5).attr('font-size', 13).attr('font-weight', 650).attr('fill', C.muted)
        .text('\u2066' + t + '\u2069');
      g.on('click', e => { e.stopPropagation(); onClick(); });
    };
    order.forEach(id => {
      const p = pos.get(id), forks = kidsOf.get(id).length > 0;
      const g = labelLayer.append('g').attr('data-id', id).attr('class', 'label').attr('text-anchor', 'middle');
      if (forks) {
        // a name tag sitting on the fork itself
        const inner = g.append('g');
        const lines = textLines(inner, id, C.ink, C.muted);
        const w = Math.max(...inner.selectAll('text').nodes().map(n => n.getComputedTextLength())) + 22;
        const top = -16, hgt = lines === 2 ? 40 : 24;
        g.insert('rect', 'g').attr('x', -w / 2).attr('y', top).attr('width', w).attr('height', hgt).attr('rx', 10)
          .attr('fill', C.tag).attr('stroke', C.tagLine);
        g.attr('transform', `translate(${p.x},${p.y - (hgt / 2 + top)})`);
      } else {
        g.attr('paint-order', 'stroke').attr('stroke', C.sky).attr('stroke-width', 4).attr('stroke-linejoin', 'round');
        const lines = textLines(g, id, C.ink, C.muted);
        const lift = 44 + (lines - 1) * 16;
        g.attr('transform', `translate(${p.x},${p.y - lift})`);
        if (hidden.get(id)) more(labelLayer, p.x, p.y - lift - 30, hidden.get(id), T.showMore, () => setDepth('down', 1));
      }
    });
    anc.forEach(({ id, x, y, more: hasMore }) => {
      const g = labelLayer.append('g').attr('data-id', id).attr('class', 'label').attr('text-anchor', 'middle')
        .attr('paint-order', 'stroke').attr('stroke', C.soil).attr('stroke-width', 4).attr('stroke-linejoin', 'round')
        .attr('transform', `translate(${x},${y + 40})`);
      const lines = textLines(g, id, C.soilInk, C.soilInk);
      if (hasMore) more(labelLayer, x, y + 40 + lines * 16 + 18, 0, T.showMore, () => setDepth('up', 1));
    });

    // ground and sky behind everything
    const bb = world.node().getBBox(), pad = 50;
    content = { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: Math.max(bb.y + bb.height + pad, 80) - bb.y + pad };
    const m = Math.max(4000, 2 * content.width, 2 * content.height);   // sky and soil reach well past the edges
    const x0 = content.x - m, x1 = content.x + content.width + m, top = content.y - m, bottom = content.y + content.height + m;
    const defs = bgLayer.append('defs');
    defs.append('linearGradient').attr('id', 'soil-grad').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
      .selectAll('stop').data([[0, C.soil], [1, C.soilDeep]]).join('stop')
      .attr('offset', d => d[0]).attr('stop-color', d => d[1]);
    bgLayer.append('rect').attr('x', x0).attr('y', top).attr('width', x1 - x0).attr('height', -top).attr('fill', C.sky);
    bgLayer.append('rect').attr('x', x0).attr('y', 0).attr('width', x1 - x0).attr('height', bottom).attr('fill', 'url(#soil-grad)');
    const tufts = d3.range(x0, x1, Math.max(9, (x1 - x0) / 3000)).map((x, i) => `M${x},2 l${2 + (i % 3)},-${5 + ((i * 7) % 6)} l${2 + (i % 2)},${5 + ((i * 7) % 6)}`);
    bgLayer.append('path').attr('d', `M${x0},0 H${x1} ` + tufts.join(' ')).attr('stroke', C.grass)
      .attr('stroke-width', 2).attr('fill', C.grass).attr('stroke-linejoin', 'round');

    // what stays lit when hovering someone: their line back to the trunk and down
    // through the roots, everything that grows out of them, and nothing else
    related = id => {
      const keep = new Set([id]);
      for (let p = parentOf.get(id); p; p = parentOf.get(p)) keep.add(p);
      for (let c = childOf.get(id); c; c = childOf.get(c)) keep.add(c);
      const down = [id];
      while (down.length) (kidsOf.get(down.pop()) || []).forEach(k => { keep.add(k); down.push(k); });
      const up = [id];
      while (up.length) { const cur = up.pop(); anc.filter(a => childOf.get(a.id) === cur).forEach(a => { keep.add(a.id); up.push(a.id); }); }
      return keep;
    };
    fit(0);
  }

  // ---- interaction ---------------------------------------------------------
  function fit(duration = 600) {
    const bb = content, el = svg.node().getBoundingClientRect();
    if (!bb || !el.width) return;
    const top = 64;   // keep the top clear of the toolbar
    let k = Math.min(el.width / bb.width, (el.height - top) / bb.height) * 0.98;
    let cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    if (k < MIN_ZOOM) {   // too big to read whole: keep names readable, centre on the trunk, pan for the rest
      k = MIN_ZOOM;
      cx = 0;
      const visible = (el.height - top) / k;
      if (bb.height > visible) cy = Math.max(bb.y + visible / 2, Math.min(bb.y + bb.height - visible / 2, -LEVEL));
    }
    const t = d3.zoomIdentity.translate(el.width / 2 - k * cx, top + (el.height - top) / 2 - k * cy).scale(k);
    svg.transition().duration(duration).call(zoom.transform, t);
  }

  svg.on('mouseover', e => {
    const el = e.target.closest('[data-id]');
    if (!el) return;
    const keep = related(el.dataset.id);
    world.selectAll('[data-id]').attr('opacity', function () { return keep.has(this.dataset.id) ? 1 : 0.18; });
  }).on('mouseout', e => {
    if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-id]')) world.selectAll('[data-id]').attr('opacity', 1);
  }).on('click', e => {
    const el = e.target.closest('[data-id]');
    if (el) select(el.dataset.id);
  });

  const $ = id => document.getElementById(id);
  const panel = $('panel');
  const growBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'grow', textContent: T.growHere });
  panel.querySelector('.panel-actions').appendChild(growBtn);
  function select(id) {
    const d = byId.get(id).data;
    $('panel-name').textContent = d.name;
    $('panel-dates').textContent = [span(d), d.place].filter(Boolean).join(' · ');
    $('panel-summary').textContent = d.summary;
    $('panel-link').href = d.url;
    $('panel-photo').hidden = !d.photo;
    if (d.photo) $('panel-photo').src = d.photo;
    growBtn.onclick = () => setRoot(id);
    growBtn.hidden = id === state.root;
    panel.hidden = false;
  }
  panel.querySelector('.close').onclick = () => { panel.hidden = true; };

  const sel = $('root-select');
  [...people].sort((a, b) => a.data.name.localeCompare(b.data.name)).forEach(p =>
    sel.add(new Option(`${p.data.name}${p.data.born ? ' (' + p.data.born + ')' : ''}`, p.id)));
  sel.onchange = () => setRoot(sel.value);

  const LIMIT = 12;
  function updateUrl() {
    const q = new URLSearchParams({ root: state.root });
    if (state.down !== 2) q.set('down', state.down);
    if (state.up !== 2) q.set('up', state.up);
    history.replaceState(null, '', '?' + q);
    $('down-n').textContent = state.down;
    $('up-n').textContent = state.up;
    $('down-less').disabled = state.down <= 0;
    $('up-less').disabled = state.up <= 0;
  }
  function setDepth(which, delta) {
    state[which] = Math.max(0, Math.min(LIMIT, state[which] + delta));
    updateUrl();
    render();
  }
  function setRoot(id) {
    state.root = id;
    sel.value = id;
    panel.hidden = true;
    updateUrl();
    render();
  }
  $('down-less').onclick = () => setDepth('down', -1);
  $('down-more').onclick = () => setDepth('down', 1);
  $('up-less').onclick = () => setDepth('up', -1);
  $('up-more').onclick = () => setDepth('up', 1);

  $('fit').onclick = () => fit();
  $('download').onclick = () => {
    const bb = content;
    const clone = svg.node().cloneNode(true);
    clone.querySelector('g').removeAttribute('transform');
    clone.querySelectorAll('.more').forEach(n => n.remove());
    clone.querySelectorAll('[opacity]').forEach(n => n.closest('[data-id]') === n && n.removeAttribute('opacity'));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
    clone.removeAttribute('style');
    clone.setAttribute('width', Math.round(bb.width));
    clone.setAttribute('height', Math.round(bb.height));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([clone.outerHTML], { type: 'image/svg+xml' }));
    a.download = `family-tree-${state.root}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const q = new URLSearchParams(location.search);
  const num = (v, d) => (v !== null && /^\d+$/.test(v)) ? Math.min(LIMIT, +v) : d;
  state.down = num(q.get('down'), 2);
  state.up = num(q.get('up'), 2);
  const fromUrl = q.get('root');
  setRoot(byId.has(fromUrl) ? fromUrl : byId.has(window.TREE_ROOT) ? window.TREE_ROOT : people[0].id);
  addEventListener('resize', () => fit(0));
})();
