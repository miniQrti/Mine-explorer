import { createGame, reveal, toggleFlag, getPlayerView, generateFloor, validateFloor } from './engine.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport'), board = $('board');
const TILE = 48, SAVE_KEY = 'mine-explorer.run.v1', PREF_KEY = 'mine-explorer.preferences.v1';
const flagSVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 27V5" stroke="#cdb889" stroke-width="2"/><path d="m11 6 14 4-14 7Z" fill="#bd7651"/><path d="M6 27h10" stroke="#b1ac84" stroke-width="2"/></svg>';
const entranceSVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 29V10l4-5h10l4 5v19Z" fill="#665538"/><path d="M11 29V12h10v17Z" fill="#171e16"/><path d="M5 11h22M9 6h14M8 11v18m16-18v18" stroke="#bd9151" stroke-width="3"/><path d="M27 9v7" stroke="#382d19" stroke-width="2"/><rect x="25" y="15" width="5" height="6" rx="1" fill="#f5ca75"/></svg>';
const stairsSVG = '<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M5 5h26v26H5Z" fill="#151c15"/><path d="M8 9h19v5H11v5h13v5H14v5" fill="none" stroke="#c2ac7c" stroke-width="3"/><path d="M29 6v10" stroke="#cba763" stroke-width="2"/><circle cx="29" cy="10" r="3" fill="#f2cb72"/></svg>';
const mineSVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8"/><path d="M16 3v26M3 16h26M7 7l18 18M7 25 25 7" stroke="currentColor" stroke-width="3"/><circle cx="13" cy="12" r="2" fill="#ddac87"/></svg>';

function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ } }
const storedPreferences = readStore(PREF_KEY, {});
const preferences = { sound: false, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, noteDismissed: false, best: { expedition: 1, retry: 1 }, ...storedPreferences };
preferences.best = { expedition: 1, retry: 1, ...preferences.best };
let state = null, mode = 'expedition', actions = [], busy = false, generationId = 0, pendingMode = null, lastRequest = null;
let camera = { x: 0, y: 0, zoom: 1 }, focusIndex = null, worker = null, audioContext = null;
let cameraBounds = viewport.getBoundingClientRect();
const pointerState = new Map();
let gesture = null, holdTimer = null, touchFlagUntil = 0;
const announce = message => { $('announcement').textContent = message; };
const formatDepth = value => String(value).padStart(3, '0');
function savePreferences() { writeStore(PREF_KEY, preferences); }
function persist() { if (state) writeStore(SAVE_KEY, { version: 2, generationVersion: state.floor.generationVersion ?? 2, depth: state.floor.depth, seed: state.floor.seed, mode, actions }); }
function freshSeed() { const values = new Uint32Array(3); crypto.getRandomValues(values); return [...values].map(v => v.toString(36)).join('-'); }
function sound(kind) {
  if (!preferences.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const frequency = kind === 'lost' ? 95 : kind === 'exit' ? 660 : kind === 'flag' ? 340 : 240;
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'exit' ? 990 : frequency * .65, audioContext.currentTime + .13);
    gain.gain.setValueAtTime(.04, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .18);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .2);
  } catch { /* Sound is optional. */ }
}
function updateCamera() { cameraBounds = viewport.getBoundingClientRect(); board.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`; $('zoom-level').textContent = `${Math.round(camera.zoom * 100)}%`; $('zoom-out').disabled = camera.zoom <= .7; $('zoom-in').disabled = camera.zoom >= 1.8; }
function centerBoard() {
  if (!state) return;
  const cells = getPlayerView(state).cells.filter(c => c.kind !== 'fog');
  const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
  const bounds = viewport.getBoundingClientRect();
  const shift = bounds.width > 1000 && !preferences.noteDismissed ? 85 : 0;
  camera.x = bounds.width / 2 + shift - (minX + maxX + 1) / 2 * TILE * camera.zoom;
  camera.y = bounds.height / 2 - (minY + maxY + 1) / 2 * TILE * camera.zoom;
  updateCamera();
}
function centerEntrance() {
  if (!state) return;
  const cell = state.floor.cells[state.floor.entrance], bounds = viewport.getBoundingClientRect();
  camera.x = bounds.width / 2 - (cell.x + .5) * TILE * camera.zoom;
  camera.y = bounds.height / 2 - (cell.y + .5) * TILE * camera.zoom;
  updateCamera();
}
function zoomTo(value, clientX, clientY) {
  const next = Math.max(.7, Math.min(1.8, value)), bounds = viewport.getBoundingClientRect();
  const x = clientX == null ? bounds.width / 2 : clientX - bounds.left, y = clientY == null ? bounds.height / 2 : clientY - bounds.top;
  const ratio = next / camera.zoom;
  camera.x = x - (x - camera.x) * ratio; camera.y = y - (y - camera.y) * ratio; camera.zoom = next; updateCamera();
}
function dismissNote() { preferences.noteDismissed = true; $('field-note').hidden = true; savePreferences(); }
function render() {
  if (!state) return;
  const activeIndex = Number(document.activeElement?.dataset?.index);
  const hadBoardFocus = board.contains(document.activeElement);
  const view = getPlayerView(state);
  const visible = view.cells.filter(cell => cell.kind !== 'fog');
  if (focusIndex == null || !visible.some(c => c.index === focusIndex && c.kind !== 'rock')) focusIndex = visible.find(c => c.kind === 'covered')?.index ?? state.floor.entrance;
  board.replaceChildren();
  for (const cell of visible) {
    const index = cell.index, isRock = cell.kind === 'rock', exploded = state.exploded === index;
    const element = document.createElement(isRock ? 'span' : 'button');
    element.className = `cell ${cell.kind}${cell.flagged ? ' flagged' : ''}${cell.clue ? ` clue-${cell.clue}` : ''}${cell.entrance ? ' entrance' : ''}${cell.stairs ? ' stairs' : ''}${exploded ? ' exploded' : ''}`;
    element.dataset.index = index;
    element.style.left = `${cell.x * TILE}px`; element.style.top = `${cell.y * TILE}px`;
    const position = `Column ${cell.x + 1}, row ${cell.y + 1}`;
    if (isRock) { element.setAttribute('role', 'img'); element.setAttribute('aria-label', `${position}, solid rock`); }
    else {
      element.type = 'button'; element.tabIndex = index === focusIndex ? 0 : -1;
      element.setAttribute('aria-label', `${position}, ${exploded ? 'exploded mine' : cell.stairs ? `stairs down, ${cell.clue} adjacent mines` : cell.entrance ? `entrance, ${cell.clue} adjacent mines` : cell.kind === 'covered' ? cell.flagged ? 'flagged covered tile' : 'covered tile, available to reveal' : `${cell.clue} adjacent mines`}`);
      if (cell.kind === 'covered') element.setAttribute('aria-pressed', String(!!cell.flagged));
      if (state.status !== 'playing') element.setAttribute('aria-disabled', 'true');
      if (exploded) element.innerHTML = mineSVG;
      else if (cell.flagged) element.innerHTML = flagSVG;
      else if (cell.stairs) element.innerHTML = stairsSVG;
      else if (cell.entrance) element.innerHTML = entranceSVG + '<span class="entrance-label">ENTRY</span>' + (cell.clue ? '<span class="entrance-clue">' + cell.clue + '</span>' : '');
      else if (cell.kind === 'revealed' && cell.clue) element.textContent = cell.clue;
    }
    board.append(element);
  }
  $('depth').textContent = formatDepth(state.floor.depth);
  preferences.best[mode] = Math.max(Number(preferences.best[mode]) || 1, state.floor.depth); savePreferences();
  $('best').textContent = formatDepth(preferences.best[mode]);
  $('mode-label').textContent = mode === 'expedition' ? 'EXPEDITION' : 'FLOOR RETRY';
  $('field-note').hidden = preferences.noteDismissed || state.status !== 'playing';
  const outcome = $('outcome'); outcome.hidden = state.status === 'playing';
  if (state.status === 'lost') {
    outcome.innerHTML = `<span class="eyebrow">THE MINE KEEPS ITS SECRETS</span><h2>A wrong turn.</h2><p>${mode === 'expedition' ? 'Your expedition ends here. A new cave awaits at floor 1.' : `Take another route. A fresh cave awaits on floor ${state.floor.depth}.`}</p><button id="retry-button" class="primary">${mode === 'expedition' ? 'Start a new expedition' : 'Retry this floor'} <span>↻</span></button>`;
    $('retry-button').addEventListener('click', () => beginFloor(mode === 'expedition' ? 1 : state.floor.depth));
  } else if (state.status === 'exit') {
    outcome.innerHTML = '<span class="eyebrow">THERE IS ALWAYS A LITTLE MORE</span><h2>The way down.</h2><p>You found the stairs. Another unexplored cave lies below.</p><button id="descend-button" class="primary">Descend to floor ' + (state.floor.depth + 1) + '<span>↓</span></button>';
    $('descend-button').addEventListener('click', () => beginFloor(state.floor.depth + 1));
  } else outcome.replaceChildren();
  if (hadBoardFocus) board.querySelector(`[data-index="${activeIndex}"]`)?.focus({ preventScroll: true });
}
function act(kind, index) {
  if (!state || busy || document.querySelector('dialog[open]')) return;
  const changed = kind === 'flag' ? toggleFlag(state, index) : reveal(state, index);
  if (!changed) return;
  focusIndex = index; actions.push({ kind, index }); persist(); render();
  if (kind === 'flag') { sound('flag'); announce(state.flags.has(index) ? 'Flag placed.' : 'Flag removed.'); }
  else { sound(state.status); announce(state.status === 'lost' ? 'You hit a mine. ' + (mode === 'expedition' ? 'Start a new expedition at floor 1.' : 'Retry this floor with a fresh cave.') : state.status === 'exit' ? 'Stairs found. You can descend to the next floor.' : `${state.floor.cells[index].clue} adjacent mines. ${state.revealed.size} floor tiles explored.`); }
  if (state.status !== 'playing') $('outcome').querySelector('button')?.focus({ preventScroll: true });
}
function installFloor(floor, restoreActions = []) {
  state = createGame(floor); actions = [];
  for (const action of restoreActions) {
    if (!action || !Number.isInteger(action.index) || !['flag', 'reveal'].includes(action.kind)) continue;
    const changed = action.kind === 'flag' ? toggleFlag(state, action.index) : reveal(state, action.index);
    if (changed) actions.push(action);
  }
  focusIndex = null; camera.zoom = 1; busy = false;
  document.body.classList.remove('loading'); $('loading').hidden = true;
  render(); if (restoreActions.length) centerBoard(); else centerEntrance(); persist(); announce(`Floor ${floor.depth}. ${mode === 'expedition' ? 'Expedition' : 'Floor retry'} mode. ${restoreActions.length ? 'Your exploration has been restored.' : 'Start at the gold ENTRY tile.'} Reveal covered tiles along the edge of explored ground.`);
}
function generationFailed(message) {
  busy = true; $('loading').hidden = false; document.body.classList.add('loading');
  $('loading').querySelector('h2').textContent = 'This passage needs another look.';
  $('loading').querySelector('p').textContent = 'We could not verify this cave. Try generating a fresh one.';
  $('generation-retry').hidden = false; announce('Cave generation did not complete. Use Try again to generate another cave.');
  console.warn('Mine Explorer generation:', message);
}
function getWorker() {
  if (!worker) worker = new Worker(new URL('./generator-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
async function beginFloor(depth = 1, options = {}) {
  const id = ++generationId, seed = options.seed ?? freshSeed();
  lastRequest = { depth }; busy = true; gesture = null; clearTimeout(holdTimer); pointerState.clear();
  document.body.classList.add('loading'); $('loading').hidden = false; $('outcome').hidden = true;
  $('loading').querySelector('h2').textContent = 'Lighting the way…';
  $('loading').querySelector('p').textContent = 'Finding a cave with a logical path.'; $('generation-retry').hidden = true;
  try {
    const floor = await new Promise((resolve, reject) => {
      const generationWorker = getWorker();
      const timeout = setTimeout(() => { generationWorker.terminate(); worker = null; reject(new Error('Generation timed out.')); }, 20000);
      const cleanup = () => { clearTimeout(timeout); generationWorker.removeEventListener('message', onMessage); generationWorker.removeEventListener('error', onError); };
      const onMessage = ({ data }) => { if (data.id !== id) return; cleanup(); data.error ? reject(new Error(data.error)) : resolve(data.floor); };
      const onError = event => { cleanup(); generationWorker.terminate(); if (worker === generationWorker) worker = null; reject(new Error(event.message)); };
      generationWorker.addEventListener('message', onMessage); generationWorker.addEventListener('error', onError);
      generationWorker.postMessage({ id, depth, seed, generationVersion: options.generationVersion ?? 2 });
    });
    if (id !== generationId) return;
    if (!floor.validation?.solvable) throw new Error('A validated floor was not returned.');
    installFloor(floor, options.actions || []);
  } catch (error) { if (id === generationId) generationFailed(error.message); }
}

function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }
function tileFromTarget(target) { const cell = target.closest?.('.cell'); return cell && cell.tagName === 'BUTTON' ? Number(cell.dataset.index) : null; }
viewport.addEventListener('pointerdown', event => {
  if (pointerState.size && !pointerState.has(event.pointerId) && gesture) { cancelHold(); gesture.blocked = true; }
  if (event.target.closest('.topline,.field-note,.map-controls,.outcome,.loading-panel') || event.button !== 0 || busy) return;
  const point = { x: event.clientX, y: event.clientY }; pointerState.set(event.pointerId, point);
  viewport.setPointerCapture(event.pointerId);
  if (pointerState.size === 1) {
    gesture = { start: point, origin: { x: camera.x, y: camera.y }, index: tileFromTarget(event.target), moved: false, blocked: false };
    if (gesture.index != null && event.pointerType !== 'mouse') holdTimer = setTimeout(() => {
      if (!gesture || gesture.moved || gesture.blocked || pointerState.size !== 1) return;
      gesture.blocked = true; touchFlagUntil = Date.now() + 1200; act('flag', gesture.index);
    }, 480);
  } else {
    cancelHold(); gesture.blocked = true; gesture.moved = true;
    const [a, b] = [...pointerState.values()];
    gesture.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: camera.zoom, midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
});
viewport.addEventListener('pointermove', event => {
  if (!pointerState.has(event.pointerId) || !gesture) return;
  pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointerState.size >= 2) {
    cancelHold(); gesture.blocked = true;
    const [a, b] = [...pointerState.values()], midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (gesture.pinch) { zoomTo(gesture.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gesture.pinch.distance), midpoint.x, midpoint.y); camera.x += midpoint.x - gesture.pinch.midpoint.x; camera.y += midpoint.y - gesture.pinch.midpoint.y; gesture.pinch.midpoint = midpoint; updateCamera(); }
    return;
  }
  if (gesture.blocked) return;
  const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y;
  if (Math.hypot(dx, dy) > 7) { gesture.moved = true; cancelHold(); }
  if (gesture.moved) { camera.x = gesture.origin.x + dx; camera.y = gesture.origin.y + dy; updateCamera(); }
});
function finishPointer(event, canceled = false) {
  if (!pointerState.has(event.pointerId)) return;
  cancelHold(); pointerState.delete(event.pointerId);
  if (canceled && gesture) gesture.blocked = true;
  if (!pointerState.size) {
    const ended = gesture; gesture = null;
    if (ended && !ended.blocked && !ended.moved && ended.index != null && !canceled) act('reveal', ended.index);
  } else if (gesture) gesture.blocked = true;
}
viewport.addEventListener('pointerup', event => finishPointer(event));
viewport.addEventListener('pointercancel', event => finishPointer(event, true));
viewport.addEventListener('lostpointercapture', event => { if (pointerState.has(event.pointerId)) finishPointer(event, true); });
viewport.addEventListener('contextmenu', event => { if (event.target.closest('.cell,#board')) { event.preventDefault(); if (gesture?.blocked || event.pointerType === 'touch' || Date.now() < touchFlagUntil) return; const index = tileFromTarget(event.target); if (index != null) act('flag', index); } });
board.addEventListener('click', event => { if (event.detail === 0) { const index = tileFromTarget(event.target); if (index != null) act('reveal', index); } });
board.addEventListener('focusin', event => { const index = tileFromTarget(event.target); if (index != null) { focusIndex = index; board.querySelectorAll('button').forEach(cell => { cell.tabIndex = Number(cell.dataset.index) === index ? 0 : -1; }); } });
board.addEventListener('keydown', event => {
  const index = tileFromTarget(event.target); if (index == null || !state) return;
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); act('flag', index); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const current = state.floor.cells[index], dx = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0, dy = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  const candidates = getPlayerView(state).cells.filter(c => c.kind !== 'fog' && c.kind !== 'rock' && (dx ? (c.x - current.x) * dx > 0 : (c.y - current.y) * dy > 0));
  candidates.sort((a, b) => { const score = c => Math.abs(c.x - current.x) + Math.abs(c.y - current.y) + (dx ? Math.abs(c.y - current.y) : Math.abs(c.x - current.x)) * 5; return score(a) - score(b); });
  if (candidates[0]) {
    focusIndex = candidates[0].index; const element = board.querySelector(`[data-index="${focusIndex}"]`); element.focus({ preventScroll: true });
    const bounds = element.getBoundingClientRect(), area = viewport.getBoundingClientRect();
    if (bounds.left < area.left + 10) camera.x += area.left + 10 - bounds.left;
    if (bounds.right > area.right - 10) camera.x -= bounds.right - area.right + 10;
    if (bounds.top < area.top + 65) camera.y += area.top + 65 - bounds.top;
    if (bounds.bottom > area.bottom - 70) camera.y -= bounds.bottom - area.bottom + 70; updateCamera();
  }
});
viewport.addEventListener('wheel', event => { if (event.target.closest('button,.field-note,.outcome,.loading-panel')) return; event.preventDefault(); zoomTo(camera.zoom * (event.deltaY > 0 ? .95 : 1.05), event.clientX, event.clientY); }, { passive: false });

function showDialog(id) { cancelHold(); gesture = null; pointerState.clear(); $(id).showModal(); }
$('help-open').onclick = () => showDialog('help-dialog'); $('note-help').onclick = () => showDialog('help-dialog');
$('legend-open').onclick = () => showDialog('legend-dialog');
$('help-legend').onclick = () => { $('help-dialog').close(); showDialog('legend-dialog'); };
document.querySelectorAll('[data-legend-icon]').forEach(element => {
  element.innerHTML = { entrance: entranceSVG, stairs: stairsSVG, flag: flagSVG, mine: mineSVG }[element.dataset.legendIcon] || '';
});
$('entrance-center').innerHTML = entranceSVG;
$('entrance-center').onclick = centerEntrance;
$('settings-open').onclick = () => showDialog('settings-dialog'); $('note-dismiss').onclick = dismissNote;
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('.dialog-close,.dialog-done').forEach(button => { button.onclick = () => dialog.close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const b = dialog.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close(); } });
});
function showModes() {
  pendingMode = null; $('mode-confirm').hidden = true;
  document.querySelectorAll('.mode-option').forEach(button => { const selected = button.dataset.mode === mode; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.querySelector('.mode-check').textContent = selected ? '●' : '○'; });
  showDialog('mode-dialog');
}
$('mode-open').onclick = showModes; $('settings-modes').onclick = () => { $('settings-dialog').close(); showModes(); };
document.querySelectorAll('.mode-option').forEach(button => { button.onclick = () => {
  pendingMode = button.dataset.mode;
  document.querySelectorAll('.mode-option').forEach(option => { const selected = option === button; option.classList.toggle('selected', selected); option.setAttribute('aria-pressed', String(selected)); option.querySelector('.mode-check').textContent = selected ? '●' : '○'; });
  $('mode-confirm').hidden = pendingMode === mode;
}; });
$('mode-confirm-button').onclick = () => { if (!pendingMode || pendingMode === mode) return; mode = pendingMode; $('mode-dialog').close(); beginFloor(1); };
$('sound-toggle').checked = preferences.sound; $('motion-toggle').checked = preferences.reducedMotion;
document.body.classList.toggle('reduced-motion', preferences.reducedMotion);
$('sound-toggle').onchange = event => { preferences.sound = event.target.checked; savePreferences(); sound('flag'); };
$('motion-toggle').onchange = event => { preferences.reducedMotion = event.target.checked; document.body.classList.toggle('reduced-motion', preferences.reducedMotion); savePreferences(); };
$('zoom-in').onclick = () => zoomTo(camera.zoom + .1); $('zoom-out').onclick = () => zoomTo(camera.zoom - .1); $('recenter').onclick = centerBoard;
$('generation-retry').onclick = () => beginFloor(lastRequest?.depth || 1);
// Keep the same world point in view as browser chrome or orientation changes.
// Camera operations record their current bounds so a queued observation cannot
// shift a floor that has already been centered for the new size.
new ResizeObserver(() => {
  const bounds = viewport.getBoundingClientRect();
  const dx = (bounds.width - cameraBounds.width) / 2;
  const dy = (bounds.height - cameraBounds.height) / 2;
  if (!dx && !dy) return;
  cancelHold(); gesture = null; pointerState.clear();
  camera.x += dx; camera.y += dy;
  updateCamera();
}).observe(viewport);
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelHold(); gesture = null; pointerState.clear(); persist(); } });

if (new URLSearchParams(location.search).get('qa') === '1') {
  window.__MINE_QA__ = {
    get state() { return state; }, get mode() { return mode; },
    getSnapshot() { return state ? { status: state.status, depth: state.floor.depth, seed: state.floor.seed, revealed: [...state.revealed], flags: [...state.flags], mode, zoom: camera.zoom, busy } : { busy }; },
    loadFloor(floor, options = {}) { ++generationId; mode = options.mode || 'expedition'; installFloor(floor); },
    async generateAt(depth, options = {}) { mode = options.mode || 'expedition'; await beginFloor(depth, options); },
    generateFloor, validateFloor,
  };
}
const saved = readStore(SAVE_KEY, null);
if ([1, 2].includes(saved?.version) && typeof saved.seed === 'string' && Number.isSafeInteger(saved.depth) && saved.depth > 0 && ['expedition', 'retry'].includes(saved.mode) && Array.isArray(saved.actions) && saved.actions.length < 10000 && (saved.version === 1 || [1, 2].includes(saved.generationVersion))) {
  mode = saved.mode;
  // An untouched old opening can adopt the smaller start. Progressed runs
  // must replay against their original generator to preserve every tile.
  if (saved.version === 1 && !saved.actions.length) beginFloor(saved.depth);
  else beginFloor(saved.depth, { seed: saved.seed, actions: saved.actions, generationVersion: saved.version === 1 ? 1 : saved.generationVersion });
} else beginFloor(1);
