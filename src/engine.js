/** Mine Explorer rules. The solver accepts a sanitized player view, never a floor. */
const DIRECTIONS = [-1, 0, 1];

function normalizeDepth(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number))) : 1;
}

export function neighbors(floor, index) {
  const x = index % floor.width;
  const y = Math.floor(index / floor.width);
  const result = [];
  for (const dy of DIRECTIONS) for (const dx of DIRECTIONS) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < floor.width && ny < floor.height) result.push(ny * floor.width + nx);
  }
  return result;
}

export function difficultyForDepth(depth = 1) {
  depth = normalizeDepth(depth);
  // Floors 101–200 hold the first ceiling; each subsequent century raises it.
  const band = depth <= 200 ? 0 : Math.floor((depth - 201) / 100) + 1;
  const progress = Math.min(1, (depth - 1) / 99);
  const withinBand = band ? ((depth - 201) % 100) / 99 : progress;
  const pressure = Math.min(8, band ? 1 + (band - 1) * 0.65 + withinBand * 0.65 : progress);
  return {
    band, width: 15 + Math.min(8, Math.floor(pressure)),
    height: 13 + Math.min(8, Math.floor(pressure)),
    mineDensity: Math.min(0.205, 0.13 + pressure * 0.014),
    maxSubsetPasses: Math.min(8, 2 + Math.floor(pressure)),
    maxValidationSteps: 180,
    minProofMoves: 3 + Math.min(4, band),
    maxOpeningFraction: 0.6,
  };
}

export function isFrontier(state, index) {
  const cell = state.floor.cells[index];
  return !!cell && !cell.rock && !state.revealed.has(index)
    && neighbors(state.floor, index).some(i => state.revealed.has(i));
}

export function getVisibleIndices(state) {
  const visible = new Set(state.revealed);
  for (const index of state.revealed) for (const next of neighbors(state.floor, index)) visible.add(next);
  return visible;
}

export function getPlayerView(state) {
  const visible = getVisibleIndices(state);
  return {
    width: state.floor.width, height: state.floor.height, depth: state.floor.depth, status: state.status,
    cells: state.floor.cells.map((cell, index) => {
      const base = { index, x: cell.x, y: cell.y };
      if (!visible.has(index)) return { ...base, kind: 'fog' };
      if (cell.rock) return { ...base, kind: 'rock' };
      if (state.revealed.has(index)) return {
        ...base, kind: 'revealed', clue: cell.clue,
        stairs: index === state.floor.exit, entrance: index === state.floor.entrance,
      };
      return { ...base, kind: 'covered', frontier: true, flagged: state.flags.has(index) };
    }),
  };
}

function openSafeRegion(state, first) {
  const queue = [first];
  while (queue.length) {
    const index = queue.pop();
    const cell = state.floor.cells[index];
    if (!cell || cell.rock || cell.mine || state.flags.has(index) || state.revealed.has(index)) continue;
    state.revealed.add(index);
    if (index === state.floor.exit) state.status = 'exit';
    if (!cell.clue) for (const next of neighbors(state.floor, index)) queue.push(next);
  }
}

export function createGame(floor) {
  const state = { floor, revealed: new Set(), flags: new Set(), status: 'playing', exploded: null };
  openSafeRegion(state, floor.entrance);
  return state;
}

export function reveal(state, index) {
  if (state.status !== 'playing' || state.flags.has(index) || !isFrontier(state, index)) return false;
  if (state.floor.cells[index].mine) {
    state.status = 'lost';
    state.exploded = index;
  } else openSafeRegion(state, index);
  return true;
}

export function toggleFlag(state, index) {
  if (state.status !== 'playing' || !isFrontier(state, index)) return false;
  if (state.flags.has(index)) state.flags.delete(index);
  else state.flags.add(index);
  return true;
}

/**
 * Deductions use numbered cells plus visible covered neighbors. Player flags
 * are deliberately ignored: a mistaken note is never treated as evidence.
 * Rules: all remaining cells are safe/mines, and subtraction of subset clues.
 */
export function deduce(view, options = {}) {
  const safe = new Set(), mines = new Set();
  const techniques = { singles: 0, subsets: 0, subsetPasses: 0 };
  let contradiction = false;
  if (!view || !Number.isInteger(view.width) || view.width < 1
    || !Number.isInteger(view.height) || view.height < 1
    || !Array.isArray(view.cells) || view.cells.length !== view.width * view.height) {
    return { safe, mines, techniques, contradiction: true };
  }
  const constraints = [];
  const signatures = new Set();
  const add = (cells, count) => {
    const ordered = [...cells].sort((a, b) => a - b);
    if (count < 0 || count > ordered.length) { contradiction = true; return false; }
    if (!ordered.length) return false;
    const signature = `${ordered.join(',')}:${count}`;
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    constraints.push({ cells: new Set(ordered), count });
    return true;
  };
  for (const cell of view.cells) {
    if (!cell || cell.kind !== 'revealed') continue;
    if (!Number.isInteger(cell.clue) || cell.clue < 0 || cell.clue > 8) { contradiction = true; continue; }
    const adjacent = neighbors(view, cell.index);
    // Every neighbor of a revealed cell must be visible. Do not reason from
    // an incomplete/malformed view that omits unknown terrain.
    if (adjacent.some(i => !view.cells[i] || view.cells[i].kind === 'fog')) continue;
    add(adjacent.filter(i => view.cells[i].kind === 'covered'), cell.clue);
  }
  const maxSubsetPasses = options.maxSubsetPasses ?? 8;
  for (let pass = 0; pass < 128 && !contradiction; pass++) {
    let changed = false;
    for (const constraint of constraints) {
      for (const index of [...constraint.cells]) {
        if (safe.has(index) || mines.has(index)) {
          constraint.cells.delete(index);
          if (mines.has(index)) constraint.count--;
        }
      }
      if (constraint.count < 0 || constraint.count > constraint.cells.size) { contradiction = true; break; }
      if (!constraint.cells.size) continue;
      if (constraint.count === 0 || constraint.count === constraint.cells.size) {
        const target = constraint.count === 0 ? safe : mines;
        const opposite = constraint.count === 0 ? mines : safe;
        for (const index of constraint.cells) {
          if (opposite.has(index)) contradiction = true;
          if (!target.has(index)) { target.add(index); changed = true; techniques.singles++; }
        }
      }
    }
    if (changed) continue;
    if (techniques.subsetPasses >= maxSubsetPasses || constraints.length > 1000) break;
    const snapshot = constraints.filter(c => c.cells.size > 1);
    const derived = [];
    for (const a of snapshot) for (const b of snapshot) {
      if (a.cells.size >= b.cells.size) continue;
      if ([...a.cells].every(i => b.cells.has(i))) {
        derived.push({ cells: [...b.cells].filter(i => !a.cells.has(i)), count: b.count - a.count });
      }
    }
    for (const item of derived) if (add(item.cells, item.count)) { changed = true; techniques.subsets++; }
    if (!changed) break;
    techniques.subsetPasses++;
  }
  return { safe, mines, techniques, contradiction };
}

export function validateFloor(floor) {
  const trace = [];
  if (!floor || !Number.isInteger(floor.width) || floor.width < 1
    || !Number.isInteger(floor.height) || floor.height < 1
    || !Array.isArray(floor.cells) || floor.cells.length !== floor.width * floor.height
    || floor.cells.length > 10000) return { solvable: false, reason: 'invalid-floor', trace };
  if (![floor.entrance, floor.exit].every(i => Number.isInteger(i) && i >= 0 && i < floor.cells.length)) {
    return { solvable: false, reason: 'invalid-endpoint', trace };
  }
  if (floor.cells.some((cell, index) => !cell || cell.x !== index % floor.width || cell.y !== Math.floor(index / floor.width)
    || (cell.rock && cell.mine) || (!cell.rock && cell.clue !== neighbors(floor, index).filter(i => floor.cells[i]?.mine).length))) {
    return { solvable: false, reason: 'invalid-cells', trace };
  }
  const state = createGame(floor);
  const difficulty = difficultyForDepth(floor.depth);
  if (state.status === 'exit') return { solvable: false, reason: 'stairs-in-opening', trace };
  if (floor.cells[floor.entrance]?.mine || floor.cells[floor.entrance]?.rock
    || floor.cells[floor.exit]?.mine || floor.cells[floor.exit]?.rock) {
    return { solvable: false, reason: 'invalid-endpoint', trace };
  }
  const safeTiles = floor.cells.filter(cell => !cell.rock && !cell.mine).length;
  const openingRevealed = state.revealed.size;
  if (openingRevealed / safeTiles > difficulty.maxOpeningFraction) {
    return { solvable: false, reason: 'opening-too-large', trace };
  }
  // Engagement checks may inspect the complete candidate; they never supply
  // hidden information to the proof solver. No first frontier click may win.
  for (const index of getVisibleIndices(state)) {
    if (!isFrontier(state, index) || floor.cells[index].mine) continue;
    const probe = { ...state, revealed: new Set(state.revealed), flags: new Set() };
    reveal(probe, index);
    if (probe.status === 'exit') return { solvable: false, reason: 'stairs-one-click-away', trace };
  }
  let provenMoves = 0;
  for (let step = 0; step < difficulty.maxValidationSteps; step++) {
    const result = deduce(getPlayerView(state), difficulty);
    if (result.contradiction) return { solvable: false, reason: 'contradiction', trace };
    if ([...result.mines].some(index => !floor.cells[index].mine)) return { solvable: false, reason: 'unsound-deduction', trace };
    const moves = [...result.safe].filter(index => isFrontier(state, index));
    if (!moves.length) return { solvable: false, reason: 'deduction-stalled', trace };
    const entry = { safe: [], mines: [...result.mines], techniques: result.techniques };
    for (const index of moves) {
      if (!isFrontier(state, index)) continue;
      // This checks proof soundness after the solver chose its move, never
      // assists its choice. A solver defect must fail closed.
      if (floor.cells[index].mine) return { solvable: false, reason: 'unsound-deduction', trace };
      entry.safe.push(index);
      provenMoves++;
      reveal(state, index);
      if (state.status === 'exit') {
        trace.push(entry);
        if (provenMoves < difficulty.minProofMoves) return { solvable: false, reason: 'too-few-deductions', trace };
        return { solvable: true, reason: 'stairs-proven', trace, revealed: state.revealed.size,
          openingRevealed, safeTiles, provenMoves };
      }
    }
    trace.push(entry);
  }
  return { solvable: false, reason: 'validation-limit', trace };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function randomForSeed(seed) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6D2B79F5;
    let result = Math.imul(value ^ value >>> 15, 1 | value);
    result ^= result + Math.imul(result ^ result >>> 7, 61 | result);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

let seedCounter = 0;
function freshSeed() {
  const values = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else { values[0] = Math.random() * 0xffffffff; values[1] = Math.random() * 0xffffffff; }
  return `${Date.now().toString(36)}-${values[0].toString(36)}-${values[1].toString(36)}-${++seedCounter}`;
}

function candidateFloor(depth, seed, random) {
  const difficulty = difficultyForDepth(depth);
  const { width, height } = difficulty;
  const startX = depth === 1 ? 2 : Math.floor(width / 2);
  const startY = Math.floor(height / 2);
  const entrance = startY * width + startX;
  const cells = [];
  const top = Array.from({ length: width }, () => 1 + Math.floor(random() * 2));
  const bottom = Array.from({ length: width }, () => height - 2 - Math.floor(random() * 2));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const opening = Math.abs(x - startX) <= 1 && Math.abs(y - startY) <= 1;
    const boundary = x === 0 || x === width - 1 || y < top[x] || y > bottom[x];
    const rock = !opening && (boundary || random() < 0.095);
    cells.push({ x, y, rock, mine: !rock && !opening && random() < difficulty.mineDensity, clue: 0 });
  }
  const floor = { width, height, cells, entrance, exit: -1, seed, depth };
  // Exclude isolated chambers from the cave footprint. Connectivity alone
  // does not imply solvability; the independent validator below proves that.
  const connected = new Set([entrance]), queue = [entrance];
  while (queue.length) {
    for (const next of neighbors(floor, queue.pop())) if (!cells[next].rock && !connected.has(next)) {
      connected.add(next); queue.push(next);
    }
  }
  cells.forEach((cell, index) => { if (!connected.has(index)) { cell.rock = true; cell.mine = false; } });
  cells.forEach((cell, index) => { if (!cell.rock) cell.clue = neighbors(floor, index).filter(i => cells[i].mine).length; });
  const exits = cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => !cell.rock && !cell.mine
    && Math.max(Math.abs(cell.x - startX), Math.abs(cell.y - startY)) >= Math.floor(width / 3));
  if (!exits.length) return null;
  floor.exit = exits[Math.floor(random() * exits.length)].index;
  return floor;
}

export class GenerationError extends Error {
  constructor(seed, attempts) {
    super('No verified floor found in this batch. Please try again.');
    this.name = 'GenerationError'; this.seed = seed; this.attempts = attempts;
  }
}

export function generateFloor(depth = 1, options = {}) {
  depth = normalizeDepth(depth);
  const seed = String(options?.seed ?? freshSeed());
  const requestedAttempts = Number(options?.maxAttempts ?? 400);
  if (!Number.isFinite(requestedAttempts) || requestedAttempts < 0) throw new RangeError('maxAttempts must be a finite nonnegative number.');
  const maxAttempts = Math.min(2000, Math.floor(requestedAttempts));
  const random = randomForSeed(seed);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const floor = candidateFloor(depth, seed, random);
    if (!floor) continue;
    const validation = validateFloor(floor);
    if (validation.solvable) {
      floor.validation = { ...validation, attempts: attempt + 1, techniques: ['single-clue', 'subset-subtraction'] };
      return floor;
    }
  }
  throw new GenerationError(seed, maxAttempts);
}
