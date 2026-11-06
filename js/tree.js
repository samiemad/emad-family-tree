(function () {
  const data = JSON.parse(document.getElementById('people-data').textContent);
  if (!data.length) return;
  const byId = Object.fromEntries(data.map(p => [p.id, p]));

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dates = p => [p.born, p.died].some(Boolean) ? `${p.born || '?'}${p.died ? ' – ' + p.died : ''}` : '';

  const startId = new URLSearchParams(location.search).get('id');
  const mainId = byId[startId] ? startId : byId[window.TREE_ROOT] ? window.TREE_ROOT : data[0].id;

  const chart = f3.createChart('#FamilyChart', data)
    .setTransitionTime(700)
    .setCardXSpacing(260)
    .setCardYSpacing(150)
    .setSingleParentEmptyCard(false)
    // a big family doesn't fit on one screen: show two generations each way,
    // clicking anyone re-centres the tree on them
    .setAncestryDepth(2)
    .setProgenyDepth(2)
    // eldest first: by `order` among siblings; birth year only when an order is missing
    .setSortChildrenFunction((a, b) => a.data.order && b.data.order
      ? a.data.order - b.data.order
      : (+a.data.born || 0) - (+b.data.born || 0));

  const card = chart.setCardHtml()
    .setStyle('imageRect')
    .setCardImageField('photo')
    .setCardDisplay([d => esc(d.data.name), d => esc(dates(d.data))])
    .setMiniTree(true)
    .setOnHoverPathToMain()
    .setOnCardClick((e, d) => {
      card.onCardClickDefault(e, d); // re-centre the tree on this person
      select(d.data.id);
    });

  chart.updateMainId(mainId);
  chart.updateTree({ initial: true });

  // --- side panel -------------------------------------------------------
  const panel = document.getElementById('panel');
  const $ = id => document.getElementById(id);
  function select(id) {
    const p = byId[id];
    if (!p) return;
    const d = p.data;
    $('panel-name').textContent = d.name;
    $('panel-dates').textContent = [dates(d), d.place].filter(Boolean).join(' · ');
    $('panel-summary').textContent = d.summary;
    $('panel-link').href = d.url;
    const img = $('panel-photo');
    img.hidden = !d.photo;
    if (d.photo) img.src = d.photo;
    panel.hidden = false;
    history.replaceState(null, '', '?id=' + encodeURIComponent(id));
  }
  panel.querySelector('.close').onclick = () => { panel.hidden = true; };
  if (startId && byId[startId]) select(startId);

  // --- toolbar ----------------------------------------------------------
  const list = $('people-list');
  data.slice().sort((a, b) => a.data.name.localeCompare(b.data.name)).forEach(p => {
    const o = document.createElement('option');
    o.value = p.data.name;
    o.label = dates(p.data);
    list.appendChild(o);
  });
  $('search').addEventListener('change', e => {
    const p = data.find(p => p.data.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (!p) return;
    chart.updateMainId(p.id);
    chart.updateTree({ tree_position: 'main_to_middle' });
    select(p.id);
    e.target.value = '';
    e.target.blur();
  });

  $('fit').onclick = () => chart.updateTree({ tree_position: 'fit' });
  let horizontal = false;
  $('orient').onclick = () => {
    horizontal = !horizontal;
    horizontal ? chart.setOrientationHorizontal() : chart.setOrientationVertical();
    chart.updateTree({ tree_position: 'fit' });
  };
})();
