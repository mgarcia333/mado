'use strict';

const $ = s => document.querySelector(s);
const stage = $('#stage');
const store = chrome.storage.local;

// Posiciones iniciales (x, y, ancho, alto en % de la ventana), copiadas del boceto.
const SKETCH = [[6.5, 10, 15.5, 17], [8, 40, 15, 20], [27.5, 10, 26.5, 38], [60, 13, 29, 34], [60, 61.5, 25, 21]];
const uid = () => Math.random().toString(36).slice(2, 9);

let cfg;                 // { bg:{color,fit}, tiles:[{id,x,y,w,h,url,shape,fit}] }
let imgs = {};           // id -> dataURL de cada cuadro
let bgImg = null;        // dataURL del fondo
let favicon = null;      // dataURL del icono de la pestaña
let editing = false;
let drag = null;
let curId = null;        // cuadro abierto en el editor
let pending = {};        // cambios sin guardar del editor

/* ---------- Almacenamiento ---------- */

function save() {
  store.set({ cfg });
  try { localStorage.setItem('bgc', cfg.bg.color); } catch {}
}

(async function init() {
  const d = await store.get(null);
  for (const k in d) if (k.startsWith('img_')) imgs[k.slice(4)] = d[k];
  bgImg = d.bgimg || null;
  favicon = d.favicon || null;
  applyFav();
  if (d.cfg) {
    cfg = d.cfg;
  } else {
    cfg = {
      bg: { color: '#202124', fit: 'cover' },
      tiles: SKETCH.map(([x, y, w, h]) => ({ id: uid(), x, y, w, h, url: '', shape: 'rect', fit: 'cover' })),
    };
    save();
    setEdit(true);
  }
  applyBg();
  render();
  // Si se pulsó el icono desde otra pestaña, el service worker deja aquí el aviso.
  const s = await chrome.storage.session.get('edit');
  if (s.edit) { chrome.storage.session.remove('edit'); setEdit(true); }
})();

/* ---------- Utilidades ---------- */

function normUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : '';
  } catch { return ''; }
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const snap = v => Math.round(v * 2) / 2;
const readFile = f => new Promise((ok, err) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = err;
  r.readAsDataURL(f);
});

// Reduce y comprime la imagen para que ocupe poco y cargue rápido.
async function compress(file, max) {
  if (file.type === 'image/svg+xml' || (file.type === 'image/gif' && file.size < 3e6)) return readFile(file);
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/webp', 0.85);
}

/* ---------- Pintado ---------- */

function applyBg() {
  const h = document.documentElement.style;
  h.backgroundColor = cfg.bg.color;
  h.backgroundImage = bgImg ? `url(${bgImg})` : 'none';
  h.backgroundSize = cfg.bg.fit;
}

function applyFav() {
  let l = $('#ico');
  if (favicon) {
    if (!l) {
      l = document.createElement('link');
      l.id = 'ico';
      l.rel = 'icon';
      document.head.append(l);
    }
    l.href = favicon;
  } else l?.remove();
  try {
    if (favicon) localStorage.setItem('fav', favicon); else localStorage.removeItem('fav');
  } catch {}
}

// Recorta al centro y reduce a 64x64 para que el icono sea ligero.
async function compressIcon(file) {
  if (file.type === 'image/svg+xml') return readFile(file);
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 64, 64);
  bmp.close();
  return c.toDataURL('image/png');
}

function render() {
  stage.textContent = '';
  const frag = document.createDocumentFragment();
  for (const t of cfg.tiles) frag.append(buildTile(t));
  stage.append(frag);
}

function buildTile(t) {
  const a = document.createElement('a');
  a.dataset.id = t.id;
  a.draggable = false;
  a.innerHTML = '<button class="del" title="Eliminar">✕</button><i class="rs"></i>';
  paint(a, t);
  return a;
}

function paint(a, t) {
  const url = normUrl(t.url);
  const src = imgs[t.id];
  a.className = `tile s-${t.shape}${src ? '' : ' noimg'}${url ? '' : ' nourl'}`;
  a.style.cssText = `left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%`;
  if (url) a.href = url; else a.removeAttribute('href');
  a.dataset.label = url ? new URL(url).hostname : 'Clic para editar';
  let im = a.querySelector('img');
  if (src) {
    if (!im) {
      im = new Image();
      im.alt = '';
      im.draggable = false;
      a.prepend(im);
    }
    if (im.getAttribute('src') !== src) im.src = src;
    im.style.objectFit = t.fit;
  } else if (im) im.remove();
}

const find = id => cfg.tiles.find(t => t.id === id);
const elOf = id => stage.querySelector(`[data-id="${id}"]`);

/* ---------- Modo edición ---------- */

function setEdit(v) {
  editing = v;
  document.body.classList.toggle('edit', v);
}

// El icono de la extensión (service worker) alterna el modo edición.
chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'edit') setEdit(!editing); });
$('#bDone').onclick = () => setEdit(false);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && editing && !document.querySelector('dialog[open]')) setEdit(false);
});

// Evita navegar al hacer clic en un cuadro mientras se edita.
stage.addEventListener('click', e => {
  if (!editing) return;
  e.preventDefault();
  const del = e.target.closest('.del');
  if (del) removeTile(del.closest('.tile').dataset.id);
});

// Arrastrar para mover, esquina inferior derecha para redimensionar.
stage.addEventListener('pointerdown', e => {
  if (!editing || e.button !== 0 || e.target.closest('.del')) return;
  const el = e.target.closest('.tile');
  if (!el) return;
  const t = find(el.dataset.id);
  drag = {
    t, el, mode: e.target.classList.contains('rs') ? 'size' : 'move',
    x: e.clientX, y: e.clientY, ox: t.x, oy: t.y, ow: t.w, oh: t.h, moved: false,
  };
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
});

stage.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) / innerWidth * 100;
  const dy = (e.clientY - drag.y) / innerHeight * 100;
  if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
  drag.moved = true;
  const t = drag.t;
  if (drag.mode === 'move') {
    t.x = clamp(snap(drag.ox + dx), 0, 100 - t.w);
    t.y = clamp(snap(drag.oy + dy), 0, 100 - t.h);
  } else {
    t.w = clamp(snap(drag.ow + dx), 3, 100 - t.x);
    t.h = clamp(snap(drag.oh + dy), 3, 100 - t.y);
  }
  drag.el.style.cssText = `left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%`;
});

stage.addEventListener('pointerup', () => {
  if (!drag) return;
  const { moved, t } = drag;
  drag = null;
  if (moved) save(); else openTile(t.id);
});

stage.addEventListener('pointercancel', () => { drag = null; });

function removeTile(id) {
  cfg.tiles = cfg.tiles.filter(t => t.id !== id);
  delete imgs[id];
  store.remove('img_' + id);
  save();
  elOf(id)?.remove();
}

$('#bAdd').onclick = () => {
  const n = cfg.tiles.length % 6;
  const t = { id: uid(), x: 35 + n * 2, y: 30 + n * 2, w: 18, h: 24, url: '', shape: 'rect', fit: 'cover' };
  cfg.tiles.push(t);
  save();
  stage.append(buildTile(t));
  openTile(t.id);
};

// Soltar una imagen sobre un cuadro la asigna directamente.
stage.addEventListener('dragover', e => { if (editing) e.preventDefault(); });
stage.addEventListener('drop', async e => {
  if (!editing) return;
  e.preventDefault();
  const el = e.target.closest('.tile');
  const f = e.dataTransfer.files[0];
  if (!el || !f || !f.type.startsWith('image/')) return;
  await setTileImg(el.dataset.id, await compress(f, 900));
});

async function setTileImg(id, data) {
  if (data) { imgs[id] = data; await store.set({ ['img_' + id]: data }); }
  else { delete imgs[id]; await store.remove('img_' + id); }
  const t = find(id);
  if (t) paint(elOf(id), t);
}

/* ---------- Editor de cuadro ---------- */

const dTile = $('#dTile');

function openTile(id) {
  const t = find(id);
  curId = id;
  pending = {};
  $('#tUrl').value = t.url;
  $('#tShape').value = t.shape;
  $('#tFit').value = t.fit;
  $('#tFile').value = '';
  showPrev(imgs[id]);
  dTile.returnValue = '';
  dTile.showModal();
  $('#tUrl').focus();
}

function showPrev(src) {
  const p = $('#tPrev');
  if (src) p.src = src; else p.removeAttribute('src');
}

$('#tFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  pending.img = await compress(f, 900);
  showPrev(pending.img);
};
$('#tClr').onclick = () => { pending.img = null; $('#tFile').value = ''; showPrev(null); };
$('#tCancel').onclick = () => dTile.close('cancel');
$('#tDel').onclick = () => { dTile.close('del'); removeTile(curId); };

dTile.addEventListener('close', async () => {
  if (dTile.returnValue !== 'ok') return;
  const t = find(curId);
  if (!t) return;
  t.url = $('#tUrl').value.trim();
  t.shape = $('#tShape').value;
  t.fit = $('#tFit').value;
  save();
  if ('img' in pending) await setTileImg(curId, pending.img);
  else paint(elOf(curId), t);
});

/* ---------- Editor de fondo ---------- */

const dBg = $('#dBg');

$('#bBg').onclick = () => {
  $('#bgColor').value = cfg.bg.color;
  $('#bgFit').value = cfg.bg.fit === 'cover' || cfg.bg.fit === 'contain' ? cfg.bg.fit : '100% 100%';
  $('#bgFile').value = '';
  $('#icoFile').value = '';
  if (favicon) $('#icoPrev').src = favicon; else $('#icoPrev').removeAttribute('src');
  dBg.showModal();
};
$('#icoFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  favicon = await compressIcon(f);
  await store.set({ favicon });
  $('#icoPrev').src = favicon;
  applyFav();
};
$('#icoClr').onclick = () => {
  favicon = null;
  $('#icoFile').value = '';
  $('#icoPrev').removeAttribute('src');
  store.remove('favicon');
  applyFav();
};
$('#bgColor').oninput = e => { cfg.bg.color = e.target.value; applyBg(); };
$('#bgColor').onchange = save;
$('#bgFit').onchange = e => { cfg.bg.fit = e.target.value; applyBg(); save(); };
$('#bgFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  bgImg = await compress(f, 2560);
  await store.set({ bgimg: bgImg });
  applyBg();
};
$('#bgClr').onclick = () => {
  bgImg = null;
  $('#bgFile').value = '';
  store.remove('bgimg');
  applyBg();
};

/* ---------- Exportar / importar ---------- */

$('#bExp').onclick = async () => {
  const d = await store.get(null);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
  a.download = 'mosaico-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('#bImp').onclick = () => $('#impFile').click();
$('#impFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d.cfg || !Array.isArray(d.cfg.tiles) || !d.cfg.bg) throw 0;
    const ok = {};
    for (const k in d) if (k === 'cfg' || k === 'bgimg' || k === 'favicon' || k.startsWith('img_')) ok[k] = d[k];
    await store.clear();
    await store.set(ok);
    try {
      localStorage.setItem('bgc', d.cfg.bg.color);
      if (ok.favicon) localStorage.setItem('fav', ok.favicon); else localStorage.removeItem('fav');
    } catch {}
    location.reload();
  } catch {
    alert('Archivo de copia no válido.');
  }
  e.target.value = '';
};
