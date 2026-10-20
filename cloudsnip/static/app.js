/* CloudSnip front-end: plain JavaScript, no build step. */
'use strict';
(() => {
  const TOKEN = document.querySelector('meta[name="cs-token"]').content;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ACTIVE = ['queued', 'fetching', 'downloading', 'analyzing'];

  // ------------------------------------------------------------------ icons
  const ICONS = {
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    toStart: '<path d="M6 5v14"/><path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none"/>',
    playSel: '<path d="M4 5v14M20 5v14"/><path d="M9 8.5v7l6-3.5z" fill="currentColor" stroke="none"/>',
    ear: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    heal: '<path d="M12 5v14M5 12h14"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8"/><path d="M7 21v-7h10v7"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
    note: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  $$('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
  const setIcon = (el, name) => { const old = el.querySelector('svg'); if (old) old.outerHTML = icon(name); };

  // ------------------------------------------------------------------ utilities
  function fmtTime(sec, decimals = 3) {
    if (sec == null || !isFinite(sec)) return '–';
    const sign = sec < 0 ? '−' : '';
    const f = 10 ** decimals;
    sec = Math.round(Math.abs(sec) * f) / f;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec - h * 3600 - m * 60;
    const ss = decimals ? s.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.round(s)).padStart(2, '0');
    return sign + (h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`);
  }
  function parseTime(str) {
    str = String(str).trim().replace(',', '.');
    if (!str) return NaN;
    const parts = str.split(':');
    if (parts.length > 3 || parts.some(p => p === '' || isNaN(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
  }
  function ago(ts) {
    const s = Date.now() / 1000 - ts;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cloudsnip.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('cloudsnip.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ------------------------------------------------------------------ server access
  // Poll results are dropped if any edit was sent while they were in flight, so the UI
  // never flickers back to stale data.
  const net = { inflight: 0, epoch: 0 };
  async function api(method, path, body) {
    const opts = { method, headers: { 'X-Token': TOKEN } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const mutating = method !== 'GET';
    if (mutating) { net.inflight++; net.epoch++; }
    try {
      let res;
      try { res = await fetch(path, opts); } catch {
        setOffline(true);
        throw new Error('CloudSnip is not reachable. Is it still running?');
      }
      setOffline(false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const err = new Error(data.error || `${res.status} ${res.statusText}`); err.status = res.status; throw err; }
      return data;
    } finally {
      if (mutating) { net.inflight--; net.epoch++; }
    }
  }
  const mediaUrl = (tid, kind, pid = S.pid) => `/media/${pid}/${tid}/${kind}?t=${encodeURIComponent(TOKEN)}`;
  function setOffline(off) { $('#offline').hidden = !off; }

  function toast(msg, kind = 'info', ms = 3200) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, ms);
  }

  function ask({ title, message, ok = 'OK', cancel = 'Cancel', extra = null, danger = false }) {
    const dlg = $('#askDlg');
    $('#askTitle').textContent = title;
    $('#askMsg').textContent = message;
    $('#askOk').textContent = ok;
    $('#askOk').className = danger ? 'btn danger' : 'btn primary';
    $('#askCancel').textContent = cancel;
    $('#askExtra').hidden = !extra;
    $('#askExtra').textContent = extra || '';
    dlg.returnValue = '';
    return new Promise(resolve => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue || 'cancel'), { once: true });
      dlg.showModal();
      $('#askOk').focus();
    });
  }

  // ------------------------------------------------------------------ state
  const S = {
    config: null,
    pid: null,
    pl: null,
    editsByPid: new Map(),   // pid -> Map(tid -> {cuts, undo, redo})
    peaks: new Map(),        // `${pid}/${tid}` -> {P, max}
    pollTimer: 0,
    folderTouched: false,
    autoSelected: false,
  };
  const edits = () => {
    if (!S.editsByPid.has(S.pid)) S.editsByPid.set(S.pid, new Map());
    return S.editsByPid.get(S.pid);
  };
  let PEAK_RATE = 100;

  // Everything about the track open in the editor.
  const E = {
    tid: null, dur: 0, peaks: null, peakMax: 1, loaded: false, loadSeq: 0, usePreview: false,
    start: 0, pps: 1, fit: true,           // view: left edge (s) and zoom (pixels per second)
    sel: null, head: 0,                    // selection [a, b] and playhead (s)
    playing: false, mode: null,            // mode: {stopAt, skip:[a,b], returnTo}
    skipCuts: true, drag: null, ovDrag: null, ovCols: null,
  };
  const audio = $('#player');
  const cv = $('#waveCanvas'), ov = $('#overview');
  const css = getComputedStyle(document.documentElement);
  const C = {};
  ['wave', 'wave-peak', 'wave-sel', 'wave-sel-peak', 'wave-cut', 'wave-cut-peak', 'cut-bg', 'cut-edge', 'sel-bg', 'sel-edge', 'ruler-bg', 'ruler-text', 'tick', 'mid',
    'ov-wave', 'ov-cut', 'ov-view', 'ov-view-edge'].forEach(k => { C[k] = css.getPropertyValue('--c-' + k).trim(); });

  const track = id => S.pl && S.pl.tracks.find(t => t.id === id);

  // ------------------------------------------------------------------ cut maths
  // Cuts are sorted, non-overlapping [start, end] ranges (seconds) that get removed on export.
  const round4 = v => Math.round(v * 1e4) / 1e4;
  function normCuts(list, dur) {
    const r = list
      .map(([a, b]) => {
        let s = clamp(Math.min(a, b), 0, dur), e = clamp(Math.max(a, b), 0, dur);
        if (s < 0.002) s = 0;
        if (e > dur - 0.002) e = dur;
        return [s, e];
      })
      .filter(([a, b]) => b - a >= 0.001)
      .sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const c of r) {
      const last = out[out.length - 1];
      if (last && c[0] <= last[1] + 0.0005) last[1] = Math.max(last[1], c[1]);
      else out.push([c[0], c[1]]);
    }
    return out.map(([a, b]) => [round4(a), round4(b)]);
  }
  const addCut = (cuts, a, b) => normCuts([...cuts, [a, b]], E.dur);
  function subCut(cuts, a, b) {
    const out = [];
    for (const [s, e] of cuts) {
      if (e <= a || s >= b) { out.push([s, e]); continue; }
      if (s < a) out.push([s, a]);
      if (e > b) out.push([b, e]);
    }
    return normCuts(out, E.dur);
  }
  const keepOnly = (cuts, a, b) => normCuts([...cuts, [0, a], [b, E.dur]], E.dur);
  const cutTotal = cuts => cuts.reduce((s, [a, b]) => s + b - a, 0);
  const sameCuts = (x, y) => x.length === y.length && x.every((c, i) => Math.abs(c[0] - y[i][0]) < 2e-4 && Math.abs(c[1] - y[i][1]) < 2e-4);
  function inCuts(cuts, t) {
    for (const [a, b] of cuts) { if (t < a) return false; if (t < b) return true; }
    return false;
  }
  function toResult(cuts, t) {
    let r = t;
    for (const [a, b] of cuts) { if (a >= t) break; r -= Math.min(b, t) - a; }
    return r;
  }

  function curCuts(tid = E.tid) {
    const ed = edits().get(tid);
    if (ed) return ed.cuts;
    const t = track(tid);
    return t ? t.cuts : [];
  }
  function isDirty(tid) {
    const ed = edits().get(tid), t = track(tid);
    return !!(ed && t && t.status === 'ready' && !sameCuts(ed.cuts, t.cuts));
  }
  function editState(tid = E.tid) {
    let ed = edits().get(tid);
    if (!ed) {
      const t = track(tid);
      ed = { cuts: t ? t.cuts.map(c => c.slice()) : [], undo: [], redo: [] };
      edits().set(tid, ed);
    }
    return ed;
  }
  function commit(newCuts) {
    const ed = editState();
    if (sameCuts(ed.cuts, newCuts)) return false;
    if (E.dur - cutTotal(newCuts) < 0.1) { toast("You can't cut away the entire track.", 'error'); return false; }
    ed.undo.push(ed.cuts);
    if (ed.undo.length > 300) ed.undo.shift();
    ed.redo = [];
    ed.cuts = newCuts;
    afterEdit();
    return true;
  }
  function undo() {
    const ed = edits().get(E.tid);
    if (!ed || !ed.undo.length) return;
    ed.redo.push(ed.cuts);
    ed.cuts = ed.undo.pop();
    afterEdit();
  }
  function redo() {
    const ed = edits().get(E.tid);
    if (!ed || !ed.redo.length) return;
    ed.undo.push(ed.cuts);
    ed.cuts = ed.redo.pop();
    afterEdit();
  }
  function afterEdit() {
    drawAll();
    updateEditorUI();
    refreshRow(E.tid);
    renderExportStatus();
  }

  // ------------------------------------------------------------------ editing actions
  const hasSel = () => !!(E.sel && E.peaks);
  function cutSelection() {
    if (!hasSel()) return;
    const [a, b] = E.sel;
    if (commit(addCut(curCuts(), a, b))) { setSel(null); setHead(a); }
  }
  function keepSelection() {
    if (!hasSel()) return;
    const [a, b] = E.sel;
    if (commit(keepOnly(curCuts(), a, b))) { setSel(null); setHead(a); }
  }
  function restoreSelection() {
    if (!hasSel()) return;
    if (!commit(subCut(curCuts(), E.sel[0], E.sel[1]))) toast('Nothing was cut inside the selection.');
  }
  function discardChanges() {
    const t = track(E.tid);
    if (t) commit(t.cuts.map(c => c.slice()));
  }
  async function saveTrack(tid = E.tid, quiet = false) {
    const ed = edits().get(tid);
    if (!ed || !isDirty(tid)) return true;
    try {
      const t = await api('PUT', `/api/playlists/${S.pid}/tracks/${tid}`, { cuts: ed.cuts });
      patchTrack(t);
      ed.cuts = t.cuts.map(c => c.slice());
      if (tid === E.tid) afterEdit(); else refreshRow(tid);
      if (!quiet) toast('Track saved', 'ok', 1800);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }
  async function restoreOriginal() {
    const t = track(E.tid);
    if (!t || (!curCuts().length && !t.cuts.length)) return;
    const r = await ask({
      title: 'Restore the original?',
      message: 'This removes every cut on this track and saves it, so it goes back to exactly what was downloaded.\nYou can still undo it with Ctrl+Z.',
      ok: 'Restore original', danger: true,
    });
    if (r !== 'ok') return;
    const ed = editState();
    if (ed.cuts.length) { ed.undo.push(ed.cuts); ed.redo = []; ed.cuts = []; }
    afterEdit();
    if (await saveTrack(E.tid, true)) toast('Original restored', 'ok', 1800);
  }
  function setIn() {
    if (!E.peaks) return;
    const h = E.head;
    setSel(E.sel && E.sel[1] > h + 0.01 ? [h, E.sel[1]] : [h, E.dur]);
  }
  function setOut() {
    if (!E.peaks) return;
    const h = E.head;
    setSel(E.sel && E.sel[0] < h - 0.01 ? [E.sel[0], h] : [0, h]);
  }

  // ------------------------------------------------------------------ selection & playhead
  const clampT = t => clamp(t, 0, E.dur);
  function setSel(sel) {
    if (sel) {
      let [a, b] = sel.map(clampT);
      if (b < a) [a, b] = [b, a];
      sel = b - a >= 0.005 ? [a, b] : null;
    }
    E.sel = sel;
    drawMain();
    updateEditorUI();
  }
  function setHead(t, fromUser = true) {
    E.head = clampT(t);
    if (E.playing) {
      if (fromUser) E.mode = null;
      audio.currentTime = skipForward(E.head);
    }
    followHead();
    positionHeads();
    updateClock();
  }

  // ------------------------------------------------------------------ playback
  function skipRanges() {
    const r = E.skipCuts ? curCuts().slice() : [];
    if (E.mode && E.mode.skip) r.push(E.mode.skip);
    return r;
  }
  function skipForward(t, lookahead = 0) {
    const ranges = skipRanges();
    for (let moved = true; moved;) {
      moved = false;
      for (const [a, b] of ranges) if (t >= a - lookahead && t < b) { t = b; moved = true; }
    }
    return t;
  }
  function play(from = null, mode = null) {
    if (!E.peaks) return;
    let t = from == null ? E.head : from;
    if (!mode && t >= E.dur - 0.05) t = 0;
    E.mode = mode;
    t = skipForward(t);
    if (t >= E.dur - 0.005) return;
    audio.currentTime = t;
    E.head = t;
    E.playing = true;
    updatePlayButton();
    audio.play().catch(err => {
      if (err.name === 'AbortError') return;
      E.playing = false;
      updatePlayButton();
      toast(`Playback failed: ${err.message}`, 'error');
    });
    requestAnimationFrame(tick);
  }
  function pause() {
    audio.pause();
    if (E.playing) E.head = audio.currentTime;
    E.playing = false;
    E.mode = null;
    updatePlayButton();
    positionHeads();
    updateClock();
  }
  const togglePlay = () => (E.playing ? pause() : play());
  function playSelection() {
    if (!hasSel()) return;
    play(E.sel[0], { stopAt: E.sel[1], returnTo: E.sel[0] });
  }
  function audition() {
    if (!hasSel()) return;
    const [a, b] = E.sel;
    play(Math.max(0, a - 3), { skip: [a, b], stopAt: Math.min(E.dur, b + 3), returnTo: a });
  }
  function tick() {
    if (!E.playing) return;
    let t = audio.currentTime;
    // Jump over removed parts a few ms early, so you never hear the start of a cut.
    const next = skipForward(t, 0.012);
    if (next !== t) {
      if (next >= E.dur - 0.005) { finishPlayback(E.mode && E.mode.returnTo); return; }
      audio.currentTime = next;
      t = next;
    }
    if (E.mode && E.mode.stopAt != null && t >= E.mode.stopAt) { finishPlayback(E.mode.returnTo); return; }
    E.head = t;
    followHead();
    positionHeads();
    updateClock();
    requestAnimationFrame(tick);
  }
  function finishPlayback(returnTo) {
    audio.pause();
    E.playing = false;
    E.mode = null;
    E.head = returnTo != null ? returnTo : E.dur;
    updatePlayButton();
    positionHeads();
    updateClock();
  }
  audio.addEventListener('ended', () => { if (E.playing) finishPlayback(null); });
  audio.addEventListener('error', () => {
    if (!E.tid || !audio.getAttribute('src')) return;
    if (!E.usePreview) {
      // The browser can't play this codec; ask the app for a lossless FLAC copy instead.
      E.usePreview = true;
      audio.src = mediaUrl(E.tid, 'preview');
    } else {
      toast('This track could not be played in your browser.', 'error');
      pause();
    }
  });
  function updatePlayButton() {
    setIcon($('#playBtn'), E.playing ? 'pause' : 'play');
  }

  // ------------------------------------------------------------------ view geometry
  const viewW = () => cv.clientWidth || 1;
  const fitPps = () => viewW() / Math.max(E.dur, 0.001);
  const span = () => viewW() / E.pps;
  const xAt = t => (t - E.start) * E.pps;
  const tAt = x => E.start + x / E.pps;
  function clampView() {
    E.start = clamp(E.start, 0, Math.max(0, E.dur - span()));
  }
  function zoomAt(factor, t) {
    if (!E.peaks) return;
    const min = fitPps(), max = 2000;
    const pps = clamp(E.pps * factor, min, max);
    if (pps === E.pps) return;
    const x = xAt(t);
    E.pps = pps;
    E.start = t - x / pps;
    E.fit = pps <= min * 1.0001;
    clampView();
    drawAll();
  }
  const zoomBy = f => zoomAt(f, E.playing || E.head > E.start && E.head < E.start + span() ? E.head : E.start + span() / 2);
  function zoomFit() {
    E.fit = true;
    E.pps = fitPps();
    E.start = 0;
    drawAll();
  }
  function followHead() {
    if (E.fit || !E.peaks) return;
    const x = xAt(E.head), w = viewW();
    if (x > w * 0.94 || x < 0) {
      E.start = E.head - (E.playing ? w * 0.06 : w * 0.5) / E.pps;
      clampView();
      drawMain();
      drawOverview();
    }
  }

  // ------------------------------------------------------------------ drawing
  function prepCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, w, h, dpr];
  }
  let hatchTile = null;
  function hatch(ctx) {
    if (!hatchTile) {
      hatchTile = document.createElement('canvas');
      hatchTile.width = hatchTile.height = 10;
      const x = hatchTile.getContext('2d');
      x.strokeStyle = C['cut-edge'];
      x.globalAlpha = 0.28;
      x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(-2, 12); x.lineTo(12, -2);
      x.moveTo(-2, 2); x.lineTo(2, -2);
      x.moveTo(8, 12); x.lineTo(12, 8);
      x.stroke();
    }
    return ctx.createPattern(hatchTile, 'repeat');
  }
  const RULER = 22;
  const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  function rulerLabel(t, step) {
    const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return fmtTime(t, dec);
  }

  function drawMain() {
    const [ctx, W, H, dpr] = prepCanvas(cv);
    ctx.clearRect(0, 0, W, H);
    if (!E.peaks) return;
    const top = RULER, wh = H - RULER, mid = top + wh / 2, amp = wh / 2 - 6;
    const cuts = curCuts();
    const t0 = E.start, t1 = E.start + W / E.pps;

    ctx.fillStyle = C.mid;
    ctx.fillRect(0, Math.round(mid), W, 1);

    // removed regions: tinted background
    ctx.fillStyle = C['cut-bg'];
    for (const [a, b] of cuts) if (b > t0 && a < t1) ctx.fillRect(xAt(a), top, (b - a) * E.pps, wh);
    // selection background
    if (E.sel) {
      ctx.fillStyle = C['sel-bg'];
      ctx.fillRect(xAt(E.sel[0]), top, (E.sel[1] - E.sel[0]) * E.pps, wh);
    }

    // waveform, one bar per device pixel: a dim peak envelope with the brighter RMS body
    // on top, coloured by kept / selected / removed
    const P = E.peaks, R = E.rms, n = P.length, scale = amp / E.peakMax, step = 1 / dpr;
    const paths = { keep: [new Path2D(), new Path2D()], sel: [new Path2D(), new Path2D()], cut: [new Path2D(), new Path2D()] };
    let ci = 0;
    for (let x = 0; x < W; x += step) {
      const ta = t0 + x / E.pps, tb = t0 + (x + step) / E.pps;
      if (ta >= E.dur) break;
      const i0 = Math.floor(ta * PEAK_RATE);
      const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(tb * PEAK_RATE)));
      let p = 0, r = 0;
      for (let i = i0; i < i1; i++) { if (P[i] > p) p = P[i]; if (R[i] > r) r = R[i]; }
      const hp = Math.max(0.5, p * scale), hr = Math.max(0.5, Math.min(p, r) * scale);
      const tm = (ta + tb) / 2;
      while (ci < cuts.length && cuts[ci][1] <= tm) ci++;
      const removed = ci < cuts.length && cuts[ci][0] <= tm;
      const selected = E.sel && tm >= E.sel[0] && tm <= E.sel[1];
      const [peakPath, rmsPath] = paths[removed ? 'cut' : selected ? 'sel' : 'keep'];
      peakPath.rect(x, mid - hp, step, hp * 2);
      rmsPath.rect(x, mid - hr, step, hr * 2);
    }
    for (const [kind, color] of [['keep', 'wave'], ['sel', 'wave-sel'], ['cut', 'wave-cut']]) {
      ctx.fillStyle = C[color + '-peak']; ctx.fill(paths[kind][0]);
      ctx.fillStyle = C[color]; ctx.fill(paths[kind][1]);
    }

    // removed regions: hatch, edges and a length label
    ctx.font = '11px ui-monospace, Consolas, monospace';
    for (const [a, b] of cuts) {
      if (b <= t0 || a >= t1) continue;
      const xa = xAt(a), xb = xAt(b);
      ctx.fillStyle = hatch(ctx);
      ctx.fillRect(xa, top, xb - xa, wh);
      ctx.fillStyle = C['cut-edge'];
      ctx.fillRect(Math.round(xa), top, 1, wh);
      ctx.fillRect(Math.round(xb) - 1, top, 1, wh);
      if (xb - xa > 70) {
        const label = `cut ${fmtTime(b - a, 1)}`;
        const lx = Math.max(xa, 0) + 6;
        if (lx + ctx.measureText(label).width < xb - 4) ctx.fillText(label, lx, top + 15);
      }
    }
    // selection edges with grab handles
    if (E.sel) {
      ctx.fillStyle = C['sel-edge'];
      for (const t of E.sel) {
        const x = Math.round(xAt(t));
        if (x < -8 || x > W + 8) continue;
        ctx.fillRect(x - 1, top, 2, wh);
        ctx.fillRect(x - 4, top, 8, 10);
        ctx.fillRect(x - 4, H - 10, 8, 10);
      }
    }

    // ruler
    ctx.fillStyle = C['ruler-bg'];
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillStyle = C.tick;
    ctx.fillRect(0, RULER - 1, W, 1);
    const stepT = TICK_STEPS.find(s => s * E.pps >= 90) || 3600;
    const minor = stepT / 5;
    ctx.fillStyle = C.tick;
    for (let k = Math.floor(t0 / minor); k * minor <= t1; k++) ctx.fillRect(Math.round(xAt(k * minor)), RULER - 5, 1, 4);
    ctx.fillStyle = C['ruler-text'];
    for (let k = Math.floor(t0 / stepT); k * stepT <= t1; k++) {
      const t = k * stepT, x = Math.round(xAt(t));
      ctx.fillStyle = C.tick;
      ctx.fillRect(x, RULER - 10, 1, 9);
      ctx.fillStyle = C['ruler-text'];
      ctx.fillText(rulerLabel(t, stepT), x + 4, 13);
    }
  }

  function drawOverview() {
    const [ctx, W, H] = prepCanvas(ov);
    ctx.clearRect(0, 0, W, H);
    if (!E.peaks) return;
    const cols = Math.max(1, Math.floor(W));
    if (!E.ovCols || E.ovCols.length !== cols) {
      const P = E.peaks, per = P.length / cols, out = new Float32Array(cols);
      for (let x = 0; x < cols; x++) {
        let m = 0;
        const i1 = Math.min(P.length, Math.ceil((x + 1) * per));
        for (let i = Math.floor(x * per); i < i1; i++) if (P[i] > m) m = P[i];
        out[x] = m / E.peakMax;
      }
      E.ovCols = out;
    }
    const mid = H / 2, amp = H / 2 - 4, cuts = curCuts();
    const keep = new Path2D(), cut = new Path2D();
    for (let x = 0; x < cols; x++) {
      const h = Math.max(0.5, E.ovCols[x] * amp);
      (inCuts(cuts, (x + 0.5) / W * E.dur) ? cut : keep).rect(x, mid - h, 1, h * 2);
    }
    ctx.fillStyle = C['ov-wave']; ctx.fill(keep);
    ctx.fillStyle = C['ov-cut']; ctx.fill(cut);
    if (!E.fit) {
      const x0 = E.start / E.dur * W, x1 = Math.min(W, (E.start + span()) / E.dur * W);
      ctx.fillStyle = C['ov-view'];
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H);
      ctx.strokeStyle = C['ov-view-edge'];
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
    }
  }

  function positionHeads() {
    const ph = $('#playhead'), oh = $('#ovHead');
    if (!E.peaks) { ph.hidden = oh.hidden = true; return; }
    const x = xAt(E.head);
    ph.hidden = x < -2 || x > viewW() + 2;
    ph.style.transform = `translateX(${x}px)`;
    oh.hidden = false;
    oh.style.transform = `translateX(${(E.head / E.dur) * ov.clientWidth}px)`;
  }
  function drawAll() {
    drawMain();
    drawOverview();
    positionHeads();
  }
  new ResizeObserver(() => {
    if (!E.peaks) return;
    if (E.fit) E.pps = fitPps();
    else E.pps = Math.max(E.pps, fitPps());
    clampView();
    drawAll();
  }).observe($('#wave'));

  // ------------------------------------------------------------------ waveform mouse
  function hoverAt(x) {
    const line = $('#hoverLine');
    if (!E.peaks || x == null) { line.hidden = true; return; }
    line.hidden = false;
    line.style.transform = `translateX(${x}px)`;
    $('#hoverTime').textContent = fmtTime(clampT(tAt(x)), E.pps > 200 ? 3 : 1);
    $('#hoverTime').style.transform = x > viewW() - 90 ? 'translateX(calc(-100% - 12px))' : '';
  }
  function nearEdge(x) {
    if (!E.sel) return null;
    if (Math.abs(x - xAt(E.sel[0])) <= 6) return 0;
    if (Math.abs(x - xAt(E.sel[1])) <= 6) return 1;
    return null;
  }
  cv.addEventListener('pointerdown', ev => {
    if (!E.peaks || ev.button !== 0) return;
    cv.setPointerCapture(ev.pointerId);
    const x = ev.offsetX, t = clampT(tAt(x));
    const edge = nearEdge(x);
    let anchor = t, moved = false;
    if (edge != null) { anchor = E.sel[1 - edge]; moved = true; }
    else if (ev.shiftKey) {
      anchor = E.sel ? (Math.abs(t - E.sel[0]) < Math.abs(t - E.sel[1]) ? E.sel[1] : E.sel[0]) : E.head;
      moved = true;
      setSel([anchor, t]);
    }
    E.drag = { anchor, x0: x, moved };
  });
  cv.addEventListener('pointermove', ev => {
    const x = ev.offsetX;
    hoverAt(x >= 0 && x <= viewW() ? x : null);
    if (!E.drag) {
      cv.style.cursor = nearEdge(x) != null ? 'ew-resize' : 'text';
      return;
    }
    if (!E.drag.moved && Math.abs(x - E.drag.x0) < 3) return;
    E.drag.moved = true;
    if (!E.fit && (x < 0 || x > viewW())) {   // drag past the edge scrolls the view
      E.start += (x < 0 ? x : x - viewW()) / E.pps * 0.25;
      clampView();
      drawOverview();
    }
    setSel([E.drag.anchor, clampT(tAt(clamp(x, 0, viewW())))]);
    positionHeads();
  });
  cv.addEventListener('pointerup', ev => {
    const d = E.drag;
    E.drag = null;
    if (!d) return;
    if (!d.moved) { setSel(null); setHead(clampT(tAt(ev.offsetX))); }
  });
  cv.addEventListener('pointerleave', () => { if (!E.drag) hoverAt(null); });
  cv.addEventListener('dblclick', ev => {
    const t = tAt(ev.offsetX);
    const c = curCuts().find(([a, b]) => t >= a && t <= b);
    if (c) setSel([c[0], c[1]]);
  });
  cv.addEventListener('wheel', ev => {
    if (!E.peaks) return;
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1;
    const horizontal = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey;
    if (horizontal) {
      const d = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
      E.start += d / E.pps;
      clampView();
      drawAll();
    } else {
      zoomAt(Math.exp(-ev.deltaY * unit * 0.0018), tAt(ev.offsetX));
    }
    hoverAt(ev.offsetX);
  }, { passive: false });

  // overview: click/drag to move the visible window
  const ovWrap = $('#overviewWrap');
  ovWrap.addEventListener('pointerdown', ev => {
    if (!E.peaks || ev.button !== 0) return;
    ovWrap.setPointerCapture(ev.pointerId);
    const t = ev.offsetX / ov.clientWidth * E.dur;
    if (E.fit) { setSel(null); setHead(t); return; }
    const inside = t >= E.start && t <= E.start + span();
    E.ovDrag = { offset: inside ? t - E.start : span() / 2 };
    E.start = t - E.ovDrag.offset;
    clampView();
    drawAll();
  });
  ovWrap.addEventListener('pointermove', ev => {
    if (!E.ovDrag) return;
    E.start = ev.offsetX / ov.clientWidth * E.dur - E.ovDrag.offset;
    clampView();
    drawAll();
  });
  ovWrap.addEventListener('pointerup', () => { E.ovDrag = null; });

  // ------------------------------------------------------------------ editor UI
  function updateClock() {
    const cur = fmtTime(E.head), el = $('#tCur');
    if (el.textContent !== cur) el.textContent = cur;
  }
  function updateEditorUI() {
    const t = track(E.tid);
    const ready = !!(t && t.status === 'ready' && E.peaks);
    const cuts = ready ? curCuts() : [];
    const ed = edits().get(E.tid);
    const dirty = ready && isDirty(E.tid);
    const sel = ready && !!E.sel;

    $('#tDur').textContent = fmtTime(E.dur || (t && t.duration) || 0);
    const removed = cutTotal(cuts);
    $('#tResult').textContent = removed > 0 ? `→ ${fmtTime(E.dur - removed, 1)} after cuts` : '';
    $('#tResult').title = removed > 0 ? `${fmtTime(removed)} removed in ${plural(cuts.length, 'cut')}` : '';

    for (const id of ['toStart', 'playBtn', 'zoomIn', 'zoomOut', 'zoomFit', 'setIn', 'setOut']) $('#' + id).disabled = !ready;
    for (const id of ['playSel', 'audition', 'cutBtn', 'keepBtn']) $('#' + id).disabled = !sel;
    $('#restoreSelBtn').disabled = !sel || !cuts.some(([a, b]) => b > E.sel[0] && a < E.sel[1]);
    $('#undoBtn').disabled = !ready || !ed || !ed.undo.length;
    $('#redoBtn').disabled = !ready || !ed || !ed.redo.length;
    $('#discardBtn').disabled = !dirty;
    $('#saveBtn').disabled = !dirty;
    $('#restoreBtn').disabled = !ready || (!cuts.length && !(t && t.cuts.length));
    $('#selStart').disabled = $('#selEnd').disabled = !ready;

    const active = document.activeElement;
    if (active !== $('#selStart')) $('#selStart').value = sel ? fmtTime(E.sel[0]) : '';
    if (active !== $('#selEnd')) $('#selEnd').value = sel ? fmtTime(E.sel[1]) : '';
    $('#selLen').textContent = sel ? `${fmtTime(E.sel[1] - E.sel[0])} long` : ready ? 'drag on the waveform' : '';

    const chip = $('#edEdited');
    if (t && t.status === 'ready' && (cuts.length || dirty)) {
      chip.hidden = false;
      chip.textContent = dirty ? 'Unsaved changes' : `${plural(cuts.length, 'cut')} saved`;
    } else chip.hidden = true;
  }

  function renderEditorMeta(t) {
    const title = $('#edTitle'), artist = $('#edArtist');
    if (document.activeElement !== title) title.value = t.title || '';
    if (document.activeElement !== artist) artist.value = t.artist || '';
    title.placeholder = `Track ${t.index}`;
    const img = $('#edCover');
    if (t.cover) {
      const src = mediaUrl(t.id, 'cover');
      if (img.dataset.src !== src) { img.src = src; img.dataset.src = src; }
      img.hidden = false;
    } else { img.hidden = true; img.dataset.src = ''; }
    $('#edQuality').textContent = t.quality || 'Quality: pending';
    $('#edLink').href = t.permalink || t.url;

    const notice = $('#edNotice');
    if (t.status === 'error') {
      notice.hidden = false;
      notice.className = 'notice error';
      notice.innerHTML = '';
      notice.append(`Download failed: ${t.error || 'unknown error'}`);
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = 'Retry';
      b.onclick = () => retryTrack(t.id);
      notice.append(b);
    } else if (t.warning) {
      notice.hidden = false;
      notice.className = 'notice';
      notice.textContent = t.warning;
    } else notice.hidden = true;

    const msg = $('#waveMsg');
    const waiting = {
      queued: 'Waiting in the download queue…',
      fetching: 'Getting track info…',
      downloading: `Downloading… ${Math.round((t.progress || 0) * 100)}%`,
      analyzing: 'Analyzing audio…',
      error: 'This track could not be downloaded.',
    }[t.status];
    if (waiting) { msg.hidden = false; msg.textContent = waiting; }
    else if (t.status === 'ready' && E.peaks) msg.hidden = true;
  }

  function showWaveMsg(text) {
    const msg = $('#waveMsg');
    msg.hidden = !text;
    if (text) msg.textContent = text;
  }

  function selectTrack(tid) {
    if (!tid || E.tid === tid) return;
    if (E.playing) pause();
    E.tid = tid;
    E.loaded = false;
    E.peaks = null;
    E.ovCols = null;
    E.sel = null;
    E.head = 0;
    E.mode = null;
    E.dur = 0;
    audio.removeAttribute('src');
    audio.load();
    $$('#trackList .track').forEach(li => li.classList.toggle('selected', li.dataset.id === tid));
    const li = $(`#trackList .track[data-id="${CSS.escape(tid)}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
    $('#edEmpty').hidden = true;
    $('#edBody').hidden = false;
    const t = track(tid);
    if (!t) return;
    drawAll();
    renderEditorMeta(t);
    updateEditorUI();
    updateClock();
    if (t.status === 'ready') loadMedia(t);
  }
  function selectAdjacent(dir) {
    if (!S.pl || !S.pl.tracks.length) return;
    const i = S.pl.tracks.findIndex(t => t.id === E.tid);
    const next = S.pl.tracks[clamp(i + dir, 0, S.pl.tracks.length - 1)];
    if (next) selectTrack(next.id);
  }

  async function loadMedia(t) {
    const seq = ++E.loadSeq;
    E.loaded = true;
    showWaveMsg('Loading waveform…');
    const key = `${S.pid}/${t.id}`;
    try {
      let cached = S.peaks.get(key);
      if (!cached) {
        const res = await fetch(mediaUrl(t.id, 'peaks'));
        if (!res.ok) throw new Error('Could not load the waveform.');
        // interleaved bytes: peak, rms, peak, rms, …
        const raw = new Uint8Array(await res.arrayBuffer());
        const n = raw.length >> 1, P = new Uint8Array(n), R = new Uint8Array(n);
        let max = 8;
        for (let i = 0; i < n; i++) {
          P[i] = raw[2 * i];
          R[i] = raw[2 * i + 1];
          if (P[i] > max) max = P[i];
        }
        cached = { P, R, max };
        S.peaks.set(key, cached);
        if (S.peaks.size > 40) S.peaks.delete(S.peaks.keys().next().value);
      }
      if (seq !== E.loadSeq || E.tid !== t.id) return;
      E.peaks = cached.P;
      E.rms = cached.R;
      E.peakMax = cached.max;
      E.ovCols = null;
      E.dur = t.duration;
      E.usePreview = false;
      audio.src = mediaUrl(t.id, 'audio');
      E.fit = true;
      E.pps = fitPps();
      E.start = 0;
      showWaveMsg(null);
      drawAll();
      updateEditorUI();
      updateClock();
    } catch (e) {
      if (seq === E.loadSeq) { E.loaded = false; showWaveMsg(e.message); }
    }
  }

  async function saveMeta(field, value) {
    const t = track(E.tid);
    if (!t || (t[field] || '') === value.trim()) return;
    try {
      patchTrack(await api('PUT', `/api/playlists/${S.pid}/tracks/${t.id}`, { [field]: value }));
    } catch (e) { toast(e.message, 'error'); }
  }

  // ------------------------------------------------------------------ track list
  const rows = new Map();
  function trackRow(t) {
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.id = t.id;
    li.innerHTML = `
      <input type="checkbox" class="inc" title="Include this track when saving the playlist">
      <span class="num"></span>
      <span class="thumb">${icon('note')}<img alt="" hidden></span>
      <span class="meta"><span class="t-title"></span><span class="t-sub"></span></span>
      <span class="state"><span class="t-status"></span><span class="bar"><i></i></span></span>`;
    li.addEventListener('click', ev => {
      if (ev.target.closest('.inc, .retry')) return;
      selectTrack(t.id);
    });
    $('.inc', li).addEventListener('change', ev => setIncluded(t.id, ev.target.checked));
    return li;
  }
  function updateRow(li, t) {
    li.classList.toggle('selected', t.id === E.tid);
    li.classList.toggle('excluded', !t.included);
    li.dataset.status = t.status;
    li.title = t.error || t.warning || '';
    $('.inc', li).checked = t.included;
    $('.num', li).textContent = String(t.index).padStart(2, '0');
    const img = $('.thumb img', li);
    if (t.cover && !img.dataset.loaded) {
      img.dataset.loaded = '1';
      img.onload = () => { img.hidden = false; const s = $('.thumb svg', li); if (s) s.remove(); };
      img.src = mediaUrl(t.id, 'cover');
    }
    $('.t-title', li).textContent = t.title || `Track ${t.index}`;
    $('.t-sub', li).textContent = t.artist || (t.status === 'ready' ? '' : ' ');

    const st = $('.t-status', li);
    const cuts = t.status === 'ready' ? curCuts(t.id) : [];
    const dirty = isDirty(t.id);
    let html = '';
    switch (t.status) {
      case 'queued': html = 'Queued'; break;
      case 'fetching': html = '<span class="spin"></span>'; break;
      case 'downloading': html = `${Math.round((t.progress || 0) * 100)}%`; break;
      case 'analyzing': html = '<span class="spin"></span>'; break;
      case 'error': html = 'Failed <button class="btn tiny ghost retry">Retry</button>'; break;
      default: {
        const removed = cutTotal(cuts);
        html = removed > 0
          ? `<span class="badge-edit" title="${plural(cuts.length, 'cut')}">${icon('scissors')}</span>${fmtTime(t.duration - removed, 0)}`
          : fmtTime(t.duration, 0);
        if (dirty) html = `<span class="dot" title="Unsaved edits"></span>${html}`;
      }
    }
    if (st.dataset.html !== html) {
      st.dataset.html = html;
      st.innerHTML = html;
      const r = $('.retry', st);
      if (r) r.addEventListener('click', ev => { ev.stopPropagation(); retryTrack(t.id); });
    }
    $('.bar i', li).style.width = `${Math.round((t.progress || 0) * 100)}%`;
  }
  function refreshRow(tid) {
    const li = rows.get(tid), t = track(tid);
    if (li && t) updateRow(li, t);
  }
  function renderTracks() {
    const list = $('#trackList');
    const seen = new Set();
    S.pl.tracks.forEach((t, i) => {
      let li = rows.get(t.id);
      if (!li) { li = trackRow(t); rows.set(t.id, li); }
      updateRow(li, t);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
      seen.add(t.id);
    });
    for (const [id, li] of rows) if (!seen.has(id)) { li.remove(); rows.delete(id); }

    const inc = S.pl.tracks.filter(t => t.included).length;
    const all = $('#incAll');
    all.checked = inc > 0 && inc === S.pl.tracks.length;
    all.indeterminate = inc > 0 && inc < S.pl.tracks.length;
    $('#retryFailed').hidden = !S.pl.tracks.some(t => t.status === 'error');
  }
  function patchTrack(t) {
    if (!S.pl) return;
    const i = S.pl.tracks.findIndex(x => x.id === t.id);
    if (i >= 0) S.pl.tracks[i] = t;
    refreshRow(t.id);
    if (t.id === E.tid) renderEditorMeta(t);
  }
  async function setIncluded(tid, included) {
    try { patchTrack(await api('PUT', `/api/playlists/${S.pid}/tracks/${tid}`, { included })); renderTracks(); renderExportStatus(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function retryTrack(tid) {
    try { patchTrack(await api('POST', `/api/playlists/${S.pid}/tracks/${tid}/retry`)); poll(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ------------------------------------------------------------------ playlist view
  function applyPlaylist(pl) {
    const first = !S.pl || S.pl.id !== pl.id;
    S.pl = pl;
    $('#crumb').hidden = false;
    $('#plTitle').textContent = pl.title || (pl.status === 'resolving' ? 'Reading playlist…' : pl.url);
    document.title = pl.title ? `${pl.title} · CloudSnip` : 'CloudSnip';
    const n = pl.tracks.length;
    const ready = pl.tracks.filter(t => t.status === 'ready').length;
    const busy = pl.tracks.filter(t => ACTIVE.includes(t.status)).length;
    const failed = pl.tracks.filter(t => t.status === 'error').length;
    const stats = [plural(n, 'track')];
    if (busy) stats.push(`${ready} ready, ${busy} downloading`);
    if (failed) stats.push(`${failed} failed`);
    $('#plStats').textContent = n ? stats.join(' · ') : '';

    const rm = $('#resolveMsg');
    if (pl.status === 'resolving') {
      rm.hidden = false; rm.className = 'resolve-msg';
      rm.innerHTML = '<span class="spin"></span> Reading the playlist from SoundCloud…';
    } else if (pl.error) {
      rm.hidden = false; rm.className = 'resolve-msg error';
      rm.textContent = pl.tracks.length ? `Couldn't refresh: ${pl.error}` : pl.error;
    } else rm.hidden = true;
    $('#refreshBtn').disabled = pl.status === 'resolving';

    renderTracks();

    if (!S.folderTouched && (first || document.activeElement !== $('#exFolder'))) $('#exFolder').value = pl.suggested_folder || '';
    renderExportStatus();

    if (!E.tid && !S.autoSelected && n) {
      S.autoSelected = true;
      selectTrack((pl.tracks.find(t => t.status === 'ready') || pl.tracks[0]).id);
    }
    const t = track(E.tid);
    if (E.tid && !t) { E.tid = null; $('#edBody').hidden = true; $('#edEmpty').hidden = false; }
    if (t) {
      renderEditorMeta(t);
      if (t.status === 'ready' && !E.loaded) loadMedia(t);
      updateEditorUI();
    }
  }

  async function poll() {
    clearTimeout(S.pollTimer);
    if (!S.pid) return;
    const pid = S.pid, epoch = net.epoch;
    let pl = null;
    try {
      pl = await api('GET', `/api/playlists/${pid}`);
    } catch (e) {
      if (e.status === 404 && pid === S.pid) {
        toast('That playlist no longer exists.', 'error');
        location.hash = '#/';
        return;
      }
    }
    if (pid !== S.pid) return;
    if (pl && epoch === net.epoch && net.inflight === 0) applyPlaylist(pl);
    const busy = !pl || pl.status === 'resolving' || pl.tracks.some(t => ACTIVE.includes(t.status)) ||
      (pl.export && pl.export.status === 'running');
    S.pollTimer = setTimeout(poll, document.hidden ? 4000 : busy ? 700 : 2500);
  }

  function openPlaylist(pid) {
    $('#home').hidden = true;
    $('#workspace').hidden = false;
    if (S.pid === pid && S.pl) { poll(); return; }
    if (E.playing) pause();
    S.pid = pid;
    S.pl = null;
    S.folderTouched = false;
    S.autoSelected = false;
    E.tid = null;
    E.peaks = null;
    audio.removeAttribute('src');
    rows.clear();
    $('#trackList').innerHTML = '';
    $('#edBody').hidden = true;
    $('#edEmpty').hidden = false;
    $('#plTitle').textContent = 'Loading…';
    $('#plStats').textContent = '';
    $('#crumb').hidden = false;
    initExportForm();
    poll();
  }

  // ------------------------------------------------------------------ home
  async function showHome() {
    clearTimeout(S.pollTimer);
    if (E.playing) pause();
    $('#workspace').hidden = true;
    $('#home').hidden = false;
    $('#crumb').hidden = true;
    document.title = 'CloudSnip';
    S.pid = null;
    S.pl = null;
    E.tid = null;
    E.peaks = null;
    rows.clear();
    $('#trackList').innerHTML = '';
    setTimeout(() => $('#urlInput').focus(), 0);
    try {
      renderRecent(await api('GET', '/api/sessions'));
    } catch (e) { /* offline banner already shown */ }
  }
  function renderRecent(list) {
    const ul = $('#recentList');
    ul.innerHTML = '';
    $('#recentWrap').hidden = !list.length;
    for (const s of list) {
      const li = document.createElement('li');
      li.className = 'recent-item';
      const main = document.createElement('div');
      main.className = 'r-main';
      const title = document.createElement('div');
      title.className = 'r-title';
      title.textContent = s.title || s.url;
      const meta = document.createElement('div');
      meta.className = 'r-meta';
      const bits = [plural(s.tracks, 'track')];
      if (s.ready < s.tracks) bits.push(`${s.ready} downloaded`);
      if (s.edited) bits.push(`${s.edited} edited`);
      bits.push(ago(s.updated));
      meta.textContent = bits.join(' · ');
      main.append(title, meta);
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = 'Delete the downloaded files for this playlist';
      del.innerHTML = icon('trash');
      del.addEventListener('click', async ev => {
        ev.stopPropagation();
        const r = await ask({
          title: 'Delete this playlist from CloudSnip?',
          message: `"${s.title || s.url}"\n\nThis deletes the downloaded tracks and your unsaved cuts from CloudSnip's workspace. Playlists you already saved to a folder are not touched.`,
          ok: 'Delete', danger: true,
        });
        if (r !== 'ok') return;
        try {
          await api('DELETE', `/api/playlists/${s.id}`);
          S.editsByPid.delete(s.id);
          li.remove();
          $('#recentWrap').hidden = !ul.children.length;
        } catch (e) { toast(e.message, 'error'); }
      });
      li.append(main, del);
      li.addEventListener('click', () => { location.hash = `#/p/${s.id}`; });
      ul.append(li);
    }
  }
  $('#loadForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const url = $('#urlInput').value.trim();
    if (!url) { $('#urlInput').focus(); return; }
    const btn = $('#loadBtn');
    btn.disabled = true;
    try {
      const { id } = await api('POST', '/api/playlists', { url });
      $('#urlInput').value = '';
      location.hash = `#/p/${id}`;
    } catch (e) { toast(e.message, 'error', 5000); }
    finally { btn.disabled = false; }
  });

  // ------------------------------------------------------------------ export
  function initExportForm() {
    const cfg = S.config, st = cfg.settings;
    const fmt = $('#exFormat');
    fmt.innerHTML = '';
    for (const f of cfg.formats) {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.available ? f.label : `${f.label} (unavailable)`;
      o.disabled = !f.available;
      fmt.append(o);
    }
    fmt.value = st.format;
    const nm = $('#exNaming');
    nm.innerHTML = '';
    for (const n of cfg.naming) {
      const o = document.createElement('option');
      o.value = n.id;
      o.textContent = n.label;
      nm.append(o);
    }
    nm.value = st.naming;
    $('#exCover').checked = !!st.embed_cover;
    updateCoverOption();
  }
  function updateCoverOption() {
    const f = S.config.formats.find(x => x.id === $('#exFormat').value);
    const supported = !!(f && f.cover);
    $('#exCover').disabled = !supported;
    $('#exCover').closest('label').title = supported ? 'Embed the SoundCloud artwork in each file' : 'WAV files can\'t carry cover art; pick FLAC or MP3 for that';
  }
  $('#exFormat').addEventListener('change', updateCoverOption);
  $('#exFolder').addEventListener('input', () => { S.folderTouched = true; });

  function renderExportStatus() {
    if (!S.pl) return;
    const ex = S.pl.export;
    const box = $('#exStatus');
    const btn = $('#exportBtn');
    const running = ex && ex.status === 'running';
    btn.disabled = running || !S.pl.tracks.length;
    btn.lastChild.textContent = running ? 'Saving…' : 'Save playlist';
    box.innerHTML = '';
    if (running) {
      const line = document.createElement('div');
      line.className = 'ex-line';
      line.innerHTML = '<span class="spin"></span>';
      line.append(`Saving ${Math.min(ex.done + 1, ex.total)} of ${ex.total}`);
      const cur = document.createElement('span');
      cur.className = 'current dim';
      cur.textContent = ex.current || '';
      const bar = document.createElement('div');
      bar.className = 'progress';
      bar.innerHTML = `<i style="width:${Math.round(ex.done / ex.total * 100)}%"></i>`;
      box.append(line, cur, bar);
      return;
    }
    if (ex && (ex.status === 'done' || ex.status === 'interrupted')) {
      const line = document.createElement('div');
      line.className = 'ex-line';
      const okSpan = document.createElement('span');
      okSpan.className = ex.files ? 'ok' : 'err';
      okSpan.textContent = ex.status === 'interrupted'
        ? `Interrupted after ${ex.files} of ${ex.total}`
        : `✓ Saved ${ex.files} of ${plural(ex.total, 'track')}`;
      line.append(okSpan);
      if (ex.files) {
        const open = document.createElement('button');
        open.className = 'btn tiny';
        open.textContent = 'Open folder';
        open.onclick = () => api('POST', '/api/open-folder', { path: ex.folder }).catch(e => toast(e.message, 'error'));
        line.append(open);
      }
      box.append(line);
      if (ex.errors && ex.errors.length) {
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = `${ex.errors.length} not saved`;
        const ul = document.createElement('ul');
        for (const er of ex.errors) {
          const li = document.createElement('li');
          li.textContent = `${er.title}: ${er.error}`;
          ul.append(li);
        }
        det.append(sum, ul);
        box.append(det);
      }
      return;
    }
    const inc = S.pl.tracks.filter(t => t.included);
    const editedN = inc.filter(t => (edits().get(t.id) ? curCuts(t.id) : t.cuts).length).length;
    box.textContent = `${plural(inc.length, 'track')} selected${editedN ? ` · ${editedN} edited` : ''}`;
  }

  async function doExport() {
    if (!S.pl) return;
    const dirty = S.pl.tracks.filter(t => isDirty(t.id));
    if (dirty.length) {
      const r = await ask({
        title: 'Unsaved edits',
        message: `${plural(dirty.length, 'track')} ${dirty.length === 1 ? 'has' : 'have'} edits you haven't saved yet.`,
        ok: 'Save edits & continue', extra: 'Ignore those edits', cancel: 'Cancel',
      });
      if (r === 'cancel') return;
      if (r === 'ok') {
        for (const t of dirty) if (!(await saveTrack(t.id, true))) return;
      }
    }
    const included = S.pl.tracks.filter(t => t.included);
    const notReady = included.filter(t => t.status !== 'ready');
    if (notReady.length) {
      const busy = notReady.some(t => ACTIVE.includes(t.status));
      const r = await ask({
        title: busy ? 'Still downloading' : 'Some tracks are missing',
        message: `${plural(notReady.length, 'track')} ${notReady.length === 1 ? "isn't" : "aren't"} downloaded${busy ? ' yet' : ''} and will be skipped.${busy ? '\nYou can wait and save again later.' : ''}`,
        ok: 'Save the rest', cancel: busy ? 'Wait' : 'Cancel',
      });
      if (r !== 'ok') return;
    }
    try {
      const pl = await api('POST', `/api/playlists/${S.pid}/export`, {
        format: $('#exFormat').value,
        folder: $('#exFolder').value,
        naming: $('#exNaming').value,
        cover: $('#exCover').checked,
      });
      S.config.settings.format = $('#exFormat').value;
      S.config.settings.naming = $('#exNaming').value;
      S.config.settings.embed_cover = $('#exCover').checked;
      applyPlaylist(pl);
      poll();
    } catch (e) { toast(e.message, 'error', 5000); }
  }
  $('#exportBtn').addEventListener('click', doExport);
  $('#exBrowse').addEventListener('click', async () => {
    const btn = $('#exBrowse');
    btn.disabled = true;
    try {
      const { path } = await api('POST', '/api/pick-folder', { initial: $('#exFolder').value });
      if (path) { $('#exFolder').value = path; S.folderTouched = true; }
    } catch (e) { toast(e.message, 'error', 5000); $('#exFolder').focus(); }
    finally { btn.disabled = false; }
  });

  // ------------------------------------------------------------------ settings, help, quit
  $('#settingsBtn').addEventListener('click', () => {
    const st = S.config.settings;
    $('#setToken').value = '';
    $('#setToken').placeholder = st.has_token ? 'A token is saved (leave empty to keep it)' : 'Paste a token to use your account';
    $('#tokenState').innerHTML = st.has_token ? ' <a href="#" id="clearToken">Remove the saved token</a>' : '';
    const clr = $('#clearToken');
    if (clr) clr.addEventListener('click', ev => { ev.preventDefault(); $('#setToken').value = ''; $('#setToken').dataset.clear = '1'; $('#tokenState').textContent = ' Token will be removed when you save.'; });
    $('#setToken').dataset.clear = '';
    $('#setExportDir').value = st.export_dir;
    $('#setParallel').value = st.parallel_downloads;
    $('#aboutInfo').innerHTML = '';
    for (const line of [`CloudSnip ${S.config.version}`, `yt-dlp ${S.config.ytdlp}`, S.config.ffmpeg, `Workspace: ${S.config.workspace}`]) {
      const d = document.createElement('div');
      d.textContent = line;
      $('#aboutInfo').append(d);
    }
    $('#settingsDlg').returnValue = '';
    $('#settingsDlg').showModal();
  });
  $('#settingsDlg').addEventListener('close', async () => {
    if ($('#settingsDlg').returnValue !== 'save') return;
    const data = { export_dir: $('#setExportDir').value, parallel_downloads: Number($('#setParallel').value) || 3 };
    const tok = $('#setToken').value.trim();
    if (tok) data.oauth_token = tok;
    else if ($('#setToken').dataset.clear) data.oauth_token = '';
    try {
      S.config.settings = await api('PUT', '/api/settings', data);
      toast('Settings saved', 'ok', 1800);
      if (tok) toast('Tip: use "Retry" on failed or preview-only tracks to download them with your account.', 'info', 6000);
    } catch (e) { toast(e.message, 'error', 5000); }
  });
  $('#helpBtn').addEventListener('click', () => $('#helpDlg').showModal());
  $('#quitBtn').addEventListener('click', async () => {
    const dirtyN = S.pl ? S.pl.tracks.filter(t => isDirty(t.id)).length : 0;
    const r = await ask({
      title: 'Quit CloudSnip?',
      message: `This stops the app. Downloads in progress continue next time you start it.${dirtyN ? `\n\n${plural(dirtyN, 'track')} with unsaved edits will lose those edits.` : ''}`,
      ok: 'Quit', danger: true,
    });
    if (r !== 'ok') return;
    try { await api('POST', '/api/shutdown'); } catch { /* already gone */ }
    clearTimeout(S.pollTimer);
    window.onbeforeunload = null;
    document.body.innerHTML = '<div class="bye">CloudSnip has stopped. You can close this tab.<br>Start it again any time with <code>CloudSnip.bat</code> or <code>py run.py</code>.</div>';
  });

  // ------------------------------------------------------------------ wiring
  $('#playBtn').addEventListener('click', togglePlay);
  $('#toStart').addEventListener('click', () => setHead(0));
  $('#playSel').addEventListener('click', playSelection);
  $('#audition').addEventListener('click', audition);
  $('#cutBtn').addEventListener('click', cutSelection);
  $('#keepBtn').addEventListener('click', keepSelection);
  $('#restoreSelBtn').addEventListener('click', restoreSelection);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#discardBtn').addEventListener('click', discardChanges);
  $('#restoreBtn').addEventListener('click', restoreOriginal);
  $('#saveBtn').addEventListener('click', () => saveTrack());
  $('#setIn').addEventListener('click', setIn);
  $('#setOut').addEventListener('click', setOut);
  $('#zoomIn').addEventListener('click', () => zoomBy(2));
  $('#zoomOut').addEventListener('click', () => zoomBy(0.5));
  $('#zoomFit').addEventListener('click', zoomFit);
  $('#prevTrack').addEventListener('click', () => selectAdjacent(-1));
  $('#nextTrack').addEventListener('click', () => selectAdjacent(1));
  $('#refreshBtn').addEventListener('click', async () => {
    try { await api('POST', `/api/playlists/${S.pid}/refresh`); poll(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#retryFailed').addEventListener('click', async () => {
    try { await api('POST', `/api/playlists/${S.pid}/retry`); poll(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#incAll').addEventListener('change', async ev => {
    try { await api('POST', `/api/playlists/${S.pid}/include`, { included: ev.target.checked }); poll(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#skipCuts').addEventListener('change', ev => { E.skipCuts = ev.target.checked; });
  const vol = $('#volume');
  vol.value = store.get('volume', 0.9);
  audio.volume = Number(vol.value);
  vol.addEventListener('input', () => { audio.volume = Number(vol.value); store.set('volume', audio.volume); });

  for (const [id, field] of [['#edTitle', 'title'], ['#edArtist', 'artist']]) {
    const input = $(id);
    input.addEventListener('change', () => saveMeta(field, input.value));
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { const t = track(E.tid); input.value = (t && t[field]) || ''; input.blur(); } });
  }
  // Each box moves only its own edge, like "Set in" / "Set out" do.
  function applyTimeInput(edge, input) {
    if (!E.peaks) return;
    if (!input.value.trim()) { updateEditorUI(); return; }
    const v = parseTime(input.value);
    if (!isFinite(v)) {
      toast('Use times like 1:23.5 (minutes:seconds) or 83.5 (seconds).', 'error');
      updateEditorUI();
      return;
    }
    const t = clampT(v);
    if (edge === 0) setSel(E.sel && E.sel[1] > t + 0.005 ? [t, E.sel[1]] : [t, E.dur]);
    else setSel(E.sel && E.sel[0] < t - 0.005 ? [E.sel[0], t] : [0, t]);
  }
  [['#selStart', 0], ['#selEnd', 1]].forEach(([id, edge]) => {
    const input = $(id);
    input.addEventListener('change', () => applyTimeInput(edge, input));
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
  });
  // keep keyboard focus off the toolbar buttons so Space always means play/pause
  $$('.transport .btn, .tools .btn, .ed-nav .icon-btn').forEach(b => b.addEventListener('mousedown', ev => ev.preventDefault()));

  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
    if (ev.key === '?' ) { $('#helpDlg').showModal(); return; }
    if ($('#workspace').hidden || !E.tid) return;
    const k = ev.key, mod = ev.ctrlKey || ev.metaKey;
    if (mod) {
      const l = k.toLowerCase();
      if (l === 's') { ev.preventDefault(); saveTrack(); }
      else if (l === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
      else if (l === 'y') { ev.preventDefault(); redo(); }
      return;
    }
    if (ev.altKey) return;
    const actions = {
      ' ': togglePlay,
      Delete: cutSelection, Backspace: cutSelection, x: cutSelection, X: cutSelection,
      k: keepSelection, K: keepSelection,
      r: restoreSelection, R: restoreSelection,
      i: setIn, I: setIn, o: setOut, O: setOut,
      p: playSelection, P: playSelection,
      a: audition, A: audition,
      Escape: () => setSel(null),
      Home: () => setHead(0), End: () => setHead(E.dur),
      ArrowLeft: () => setHead(E.head - (ev.shiftKey ? 5 : 1)),
      ArrowRight: () => setHead(E.head + (ev.shiftKey ? 5 : 1)),
      ArrowUp: () => selectAdjacent(-1), ArrowDown: () => selectAdjacent(1),
      '+': () => zoomBy(1.6), '=': () => zoomBy(1.6), '-': () => zoomBy(1 / 1.6), '0': zoomFit,
    };
    const fn = actions[k];
    if (fn) { ev.preventDefault(); fn(); }
  });

  window.addEventListener('beforeunload', ev => {
    for (const [pid, map] of S.editsByPid) {
      for (const [tid, ed] of map) {
        const t = pid === S.pid && track(tid);
        if (t && !sameCuts(ed.cuts, t.cuts)) { ev.preventDefault(); ev.returnValue = ''; return; }
      }
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pid) poll(); });

  function route() {
    const m = location.hash.match(/^#\/p\/([A-Za-z0-9_-]+)/);
    if (m) openPlaylist(m[1]); else showHome();
  }
  window.addEventListener('hashchange', route);

  (async function boot() {
    try {
      S.config = await api('GET', '/api/state');
      PEAK_RATE = S.config.peak_rate;
    } catch (e) {
      document.body.innerHTML = `<div class="bye">Couldn't reach CloudSnip: ${e.message}</div>`;
      return;
    }
    route();
  })();
})();
