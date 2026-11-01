// Illustrated tree: the chosen person is the trunk, descendants are branches,
// ancestors are roots. Height is time: a branch starts at the person's birth
// (forking off their parent's branch) and grows until their death, or today.
(function () {
  const people = JSON.parse(document.getElementById('people-data').textContent);
  if (!people.length) return;
  const byId = new Map(people.map(p => [p.id, p]));

  const NOW = new Date().getFullYear();
  const GEN = 28;     // assumed years per generation when a birth year is missing
  const PX = 7;       // minimum pixels per year above ground (stretched for wide trees)
  const RPX = 4 / 7;  // below ground, relative to above (roots are compressed)
  const COL = 190;    // horizontal space per person
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const C = {
    sky: '#f6f3ee', soil: '#d9c7ad', soilDeep: '#b89c7b', grass: '#8fae6b',
    bark: '#5e4634', root: '#6e5441', ink: '#2b2620', muted: '#7a7065', soilInk: '#4a3a2c',
    living: ['#7fa35b', '#6b9a4e', '#94b86a', '#5d8a47', '#a5c47a'],
    past: ['#d9a441', '#c97a3a', '#b5662f', '#e0b860', '#a8743d'],
  };

  // ---- dates ---------------------------------------------------------------
  const yearOf = s => { const m = String(s ?? '').match(/\d{4}/); return m ? +m[0] : null; };
  const born = new Map();
  people.forEach(p => {
    const y = yearOf(p.data.born), d = yearOf(p.data.died);
    if (y) born.set(p.id, y);
    else if (d) born.set(p.id, d - 60);   // only the year of death is known
  });
  for (let changed = true; changed;) {     // estimate the rest from relatives, generation by generation
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
  const died = id => yearOf(byId.get(id).data.died);
  const isLiving = id => !died(id) && born.get(id) > NOW - 100;
  const endYear = id => Math.max(born.get(id) + 4, died(id) ?? (isLiving(id) ? NOW : born.get(id) + 75));
  const span = d => [d.born, d.died].some(Boolean) ? `${d.born || '?'} – ${d.died || ''}`.trim() : '';

  // ---- helpers ---------------------------------------------------------------
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const easeOut = t => 1 - Math.pow(1 - t, 2.6);
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
  let related = () => true;
  let content = null;          // bounding box of the drawing itself (not the endless sky/soil)   // set per render: (hoveredId) => Set of ids to keep highlighted

  function render(rootId) {
    world.selectAll('*').remove();
    const ground = born.get(rootId);

    // Descendants, laid out as a tidy tree with each parent centred over their
    // children. A parent's own crown gets a slot of its own among their children,
    // except a parent of an only child: there the line carries straight on and
    // the parent's crown sits half a column off to the side.
    const kidsOf = new Map(), parentOf = new Map(), depthOf = new Map([[rootId, 0]]), seen = new Set([rootId]);
    const order = [rootId];
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const ks = byId.get(id).rels.children
        .filter(k => byId.has(k) && !seen.has(k))
        .sort((a, b) => {   // eldest first: `order` among siblings, else (estimated) birth year
          const oa = byId.get(a).data.order, ob = byId.get(b).data.order;
          return oa && ob ? oa - ob : born.get(a) - born.get(b);
        });
      ks.forEach(k => { seen.add(k); parentOf.set(k, id); depthOf.set(k, depthOf.get(id) + 1); });
      kidsOf.set(id, ks);
      order.push(...ks);
    }
    const maxDepth = Math.max(...depthOf.values());
    const descendants = id => kidsOf.get(id).flatMap(k => [k, ...descendants(k)]);
    // Every crown hangs an invisible stem down to the deepest generation, so the
    // tidy layout keeps all crowns apart, whatever generation they belong to.
    const stem = depth => depth < maxDepth ? [{ stem: true, children: stem(depth + 1) }] : undefined;
    const crown = (id, depth, self) => ({ id, self, children: stem(depth) });
    const aside = new Set();
    const hier = (function build(id) {
      const ks = kidsOf.get(id), depth = depthOf.get(id);
      if (!ks.length) return crown(id, depth, false);
      const children = ks.map(build);
      const crowded = descendants(id).some(k => Math.abs(endYear(k) - endYear(id)) < 14);
      if (ks.length > 1 || crowded) children.splice(Math.ceil(ks.length / 2) - (depth % 2) * (ks.length % 2), 0, crown(id, depth + 1, true));
      else aside.add(id);
      return { id, children };
    })(rootId);
    const tip = new Map(), centre = new Map();
    d3.tree().nodeSize([COL, 1]).separation((a, b) => a.parent === b.parent ? 1 : 1.1)(d3.hierarchy(hier))
      .each(n => {
        if (n.data.stem) return;
        if (n.data.self || !tip.has(n.data.id)) tip.set(n.data.id, n.x);
        if (!n.data.self) centre.set(n.data.id, n.x);
      });
    // an only child's parent puts their crown on the side away from the child's crown
    [...order].reverse().filter(id => aside.has(id)).forEach(id => {
      const away = Math.sign(centre.get(id) - tip.get(kidsOf.get(id)[0])) || (depthOf.get(id) % 2 ? 1 : -1);
      tip.set(id, centre.get(id) + away * COL / 2);
    });
    const X = id => tip.get(id) - centre.get(rootId);

    // A big family is far wider than it is tall. Stretch time so the drawing keeps
    // roughly the screen's proportions, and thicken branches to match.
    const xs = [...tip.values()], el = svg.node().getBoundingClientRect();
    const spanX = Math.max(...xs) - Math.min(...xs) + COL;
    const spanYears = Math.max(...order.map(endYear)) - ground + 30;
    const px = Math.max(PX, spanX * (el.width ? el.height / el.width : 0.6) * 0.7 / spanYears);
    const grow = Math.sqrt(px / PX);
    const Y = year => year >= ground ? -(year - ground) * px : (ground - year) * px * RPX;

    const descYears = new Map();
    (function collect(id) {
      const ys = kidsOf.get(id).flatMap(k => [born.get(k), ...collect(k)]);
      descYears.set(id, ys);
      return ys;
    })(rootId);
    // Thickness follows how much of the family is still to come from this branch.
    const thickness = (id, year) =>
      grow * 2.4 + grow * 5 * Math.sqrt(descYears.get(id).reduce((s, y) => s + 1 / (1 + Math.exp((year - y) / 2)), 0));

    const geo = new Map();
    const xAt = (id, year) => {
      const g = geo.get(id);
      return g.sx + (g.tx - g.sx) * easeOut(clamp01((year - g.b) / (g.e - g.b)));
    };
    order.forEach(id => {
      const b = born.get(id), e = endYear(id);
      const sx = id === rootId ? 0 : xAt(parentOf.get(id), b);
      geo.set(id, { b, e, sx, tx: X(id) });
    });

    // Ancestors: a pedigree fanning out underground.
    const anc = [], childOf = new Map(), seenA = new Set([rootId]);
    (function dig(id, x, spread) {
      const ps = byId.get(id).rels.parents.filter(p => byId.has(p) && !seenA.has(p));
      ps.forEach((p, i) => {
        seenA.add(p);
        childOf.set(p, id);
        const ax = x + (i - (ps.length - 1) / 2) * spread;
        anc.push({ id: p, x: ax });
        dig(p, ax, Math.max(spread * 0.62, COL * 0.9));
      });
    })(rootId, 0, COL * 1.7);
    const ancX = new Map(anc.map(a => [a.id, a.x]).concat([[rootId, 0]]));
    const ancCount = new Map();
    (function count(id) {
      const n = anc.filter(a => childOf.get(a.id) === id).reduce((s, a) => s + 1 + count(a.id), 0);
      ancCount.set(id, n);
      return n;
    })(rootId);

    const bgLayer = world.append('g'), rootLayer = world.append('g'), branchLayer = world.append('g'),
      leafLayer = world.append('g'), labelLayer = world.append('g');

    // roots
    anc.forEach(({ id, x }) => {
      const c = childOf.get(id), cx = ancX.get(c), cy = c === rootId ? 0 : Y(born.get(c));
      const ty = Y(born.get(id)), w0 = grow * (3 + 3.5 * Math.sqrt(1 + ancCount.get(id)));
      const g = rootLayer.append('g').attr('data-id', id);
      g.append('path').attr('fill', C.root)
        .attr('d', taper(t => cx + (x - cx) * easeOut(t), t => cy + (ty - cy) * t, t => w0 - (w0 - 1.6) * t));
      const rand = rng(id);
      for (let i = 0; i < 4; i++) {   // rootlets
        const a = Math.PI / 2 + (rand() - 0.5) * 2.2, l = 14 + rand() * 20;
        g.append('path').attr('stroke', C.root).attr('stroke-width', 1).attr('fill', 'none')
          .attr('d', `M${x},${ty} q${Math.cos(a) * l * 0.5 + 4},${Math.sin(a) * l * 0.5} ${Math.cos(a) * l},${Math.sin(a) * l}`);
      }
    });

    // branches + foliage
    order.forEach(id => {
      const { b, e } = geo.get(id), living = isLiving(id), rand = rng(id);
      const flare = id === rootId ? t => 1 + 1.4 * Math.pow(1 - t, 8) : () => 1;
      branchLayer.append('path').attr('data-id', id).attr('fill', C.bark)
        .attr('d', taper(t => xAt(id, b + t * (e - b)), t => Y(b + t * (e - b)),
          t => thickness(id, b + t * (e - b)) * flare(t), 48));
      const g = leafLayer.append('g').attr('data-id', id), palette = living ? C.living : C.past;
      for (let i = 0; i < 9; i++) {   // leaves along the outer part of the branch
        const yr = b + (0.4 + rand() * 0.55) * (e - b);
        leaves(g, xAt(id, yr), Y(yr), 3, palette, rand, 9, 0.8);
      }
      // crown: soft blobs of colour with individual leaves on top
      for (let i = 0; i < 5; i++) {
        g.append('circle').attr('cx', X(id) + (rand() - 0.5) * 40).attr('cy', Y(e) + (rand() - 0.6) * 24)
          .attr('r', 16 + rand() * 12).attr('fill', palette[i % palette.length]).attr('opacity', 0.28);
      }
      leaves(g, X(id), Y(e) - 2, living ? 34 : 24, palette, rand, 30);
    });

    // labels
    const label = (id, x, y, below) => {
      const d = byId.get(id).data;
      const onSoil = below, halo = onSoil ? C.soil : C.sky;
      const g = labelLayer.append('g').attr('data-id', id).attr('class', 'label')
        .attr('transform', `translate(${x},${y})`).attr('text-anchor', 'middle')
        .attr('paint-order', 'stroke').attr('stroke', halo).attr('stroke-width', 4).attr('stroke-linejoin', 'round');
      g.append('text').attr('font-size', 14).attr('font-weight', 650)
        .attr('fill', onSoil ? C.soilInk : C.ink).text(d.name);
      g.append('text').attr('y', 16).attr('font-size', 12).attr('fill', onSoil ? C.soilInk : C.muted)
        .attr('direction', 'ltr').attr('unicode-bidi', 'bidi-override')   // "1921 – 1998" in order on right-to-left pages too
        .text(span(d));
      if (!below) {
        const partners = byId.get(id).rels.spouses.filter(s => byId.has(s));
        partners.forEach((s, i) => {
          g.append('text').attr('class', 'spouse').attr('data-spouse', s)
            .attr('y', 32 + i * 15).attr('font-size', 12).attr('fill', C.muted)
            .text('♥ ' + byId.get(s).data.name);
        });
        // lift the label so its last line clears the foliage
        g.attr('transform', `translate(${x},${y - 46 - partners.length * 15})`);
      }
    };
    order.forEach(id => label(id, X(id), Y(geo.get(id).e)));
    anc.forEach(({ id, x }) => label(id, x, Y(born.get(id)) + 54, true));

    // ground, sky and time grid behind everything
    const bb = world.node().getBBox(), pad = 60;
    content = { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: Math.max(bb.y + bb.height + pad, 120) - bb.y + pad };
    const m = Math.max(4000, 2 * content.width, 2 * content.height);   // sky and soil reach well past the edges
    const x0 = content.x - m, x1 = content.x + content.width + m, top = content.y - m, bottom = content.y + content.height + m;
    const gx = content.x + 4;
    const defs = bgLayer.append('defs');
    defs.append('linearGradient').attr('id', 'soil-grad').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
      .selectAll('stop').data([[0, C.soil], [1, C.soilDeep]]).join('stop')
      .attr('offset', d => d[0]).attr('stop-color', d => d[1]);
    bgLayer.append('rect').attr('x', x0).attr('y', top).attr('width', x1 - x0).attr('height', -top).attr('fill', C.sky);
    bgLayer.append('rect').attr('x', x0).attr('y', 0).attr('width', x1 - x0).attr('height', bottom).attr('fill', 'url(#soil-grad)');
    const grid = bgLayer.append('g').attr('font-size', 11);
    const firstYear = Math.ceil((ground - (content.y + content.height) / (px * RPX)) / 25) * 25;
    for (let yr = firstYear; Y(yr) > content.y + 20; yr += 25) {
      if (Math.abs(yr - ground) < 6) continue;
      const under = Y(yr) > 0;
      grid.append('line').attr('x1', x0).attr('x2', x1).attr('y1', Y(yr)).attr('y2', Y(yr))
        .attr('stroke', under ? C.soilInk : C.muted).attr('stroke-opacity', 0.15).attr('stroke-dasharray', '2 6');
      grid.append('text').attr('x', gx).attr('y', Y(yr) - 5)
        .attr('fill', under ? C.soilInk : C.muted).attr('fill-opacity', 0.7).text(yr);
    }
    const tufts = d3.range(x0, x1, Math.max(9, (x1 - x0) / 3000)).map((x, i) => `M${x},2 l${2 + (i % 3)},-${5 + ((i * 7) % 6)} l${2 + (i % 2)},${5 + ((i * 7) % 6)}`);
    bgLayer.append('path').attr('d', `M${x0},0 H${x1} ` + tufts.join(' ')).attr('stroke', C.grass)
      .attr('stroke-width', 2).attr('fill', C.grass).attr('stroke-linejoin', 'round');
    bgLayer.append('text').attr('x', gx).attr('y', -8).attr('font-size', 11).attr('font-weight', 600)
      .attr('fill', C.muted).text(ground);

    // what stays lit when hovering someone: their line back to the trunk/ground,
    // everything that grows out of them, and nothing else
    related = id => {
      const keep = new Set([id]);
      for (let p = parentOf.get(id); p; p = parentOf.get(p)) keep.add(p);
      for (let c = childOf.get(id); c; c = childOf.get(c)) keep.add(c);
      const down = [id];
      while (down.length) kidsOf.get(down.pop())?.forEach(k => { keep.add(k); down.push(k); });
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
    const k = Math.min(el.width / bb.width, (el.height - top) / bb.height) * 0.98;
    const t = d3.zoomIdentity.translate(el.width / 2 - k * (bb.x + bb.width / 2), top + (el.height - top) / 2 - k * (bb.y + bb.height / 2)).scale(k);
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
    const spouse = e.target.closest('[data-spouse]');
    const el = spouse ? null : e.target.closest('[data-id]');
    const id = spouse ? spouse.dataset.spouse : el?.dataset.id;
    if (id) select(id);
  });

  const $ = id => document.getElementById(id);
  const panel = $('panel');
  const growBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'grow', textContent: (window.I18N || {}).growHere || 'Grow tree from here' });
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
    growBtn.hidden = id === current;
    panel.hidden = false;
  }
  panel.querySelector('.close').onclick = () => { panel.hidden = true; };

  const sel = $('root-select');
  [...people].sort((a, b) => a.data.name.localeCompare(b.data.name)).forEach(p =>
    sel.add(new Option(`${p.data.name}${p.data.born ? ' (' + p.data.born + ')' : ''}`, p.id)));
  sel.onchange = () => setRoot(sel.value);

  let current;
  function setRoot(id) {
    current = id;
    sel.value = id;
    panel.hidden = true;
    history.replaceState(null, '', '?root=' + encodeURIComponent(id));
    render(id);
  }

  $('fit').onclick = () => fit();
  $('download').onclick = () => {
    const bb = content;
    const clone = svg.node().cloneNode(true);
    clone.querySelector('g').removeAttribute('transform');
    clone.querySelectorAll('[opacity]').forEach(n => n.closest('[data-id]') === n && n.removeAttribute('opacity'));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
    clone.removeAttribute('style');
    clone.setAttribute('width', Math.round(bb.width));
    clone.setAttribute('height', Math.round(bb.height));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([clone.outerHTML], { type: 'image/svg+xml' }));
    a.download = `family-tree-${current}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const fromUrl = new URLSearchParams(location.search).get('root');
  setRoot(byId.has(fromUrl) ? fromUrl : byId.has(window.TREE_ROOT) ? window.TREE_ROOT : people[0].id);
  addEventListener('resize', () => fit(0));
})();
