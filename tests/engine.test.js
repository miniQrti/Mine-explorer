import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, deduce, difficultyForDepth, generateFloor, GenerationError,
  getPlayerView, getVisibleIndices, isFrontier, neighbors, reveal, toggleFlag, validateFloor,
} from '../src/engine.js';

function fixture(rows, entrance, exit) {
  const height = rows.length, width = rows[0].length;
  const cells = rows.flatMap((row, y) => [...row].map((char, x) => ({ x, y, rock: char === '#', mine: char === '*', clue: 0 })));
  const floor = { width, height, cells, entrance, exit, depth: 1, seed: 'fixture' };
  cells.forEach((cell, index) => { cell.clue = neighbors(floor, index).filter(i => cells[i].mine).length; });
  return floor;
}

test('eight-neighbor clues and diagonal frontier respect map edges', () => {
  const floor = fixture(['*..', '...', '..*'], 4, 2);
  const state = createGame(floor);
  assert.equal(floor.cells[4].clue, 2);
  assert.deepEqual(neighbors(floor, 0).sort(), [1, 3, 4]);
  assert.equal(isFrontier(state, 0), true);
  assert.equal(isFrontier(state, 8), true);
  assert.equal(reveal(state, 2), true);
  assert.equal(state.status, 'exit');
});

test('unseen cells cannot be revealed or flagged, and rock is not ground', () => {
  const floor = fixture(['*....', '..#..', '.....'], 0 + 5, 14);
  const state = createGame(floor);
  assert.equal(isFrontier(state, 14), false);
  assert.equal(reveal(state, 14), false);
  assert.equal(toggleFlag(state, 14), false);
  assert.equal(reveal(state, 7), false);
  assert.equal(toggleFlag(state, 7), false);
  assert.equal(state.revealed.has(7), false);
});

test('zero flood opens bordering numbers and respects flags and solid rock', () => {
  const floor = fixture(['.....', '##.##', '.....', '...*.'], 10, 4);
  // A manually constructed state isolates a flood transaction from the initial opening.
  const state = { floor, revealed: new Set([10]), flags: new Set([2]), status: 'playing', exploded: null };
  assert.equal(reveal(state, 11), true);
  assert.equal(state.revealed.has(2), false, 'a flag blocks its own cell during a flood');
  assert.equal(state.revealed.has(5), false, 'rock stays unrevealed');
  assert.equal(state.revealed.has(12), true, 'number border opens');
  assert.equal(state.revealed.has(18), false, 'mines never flood open');
});

test('flags toggle, block reveal, and terminal states block actions', () => {
  const floor = fixture(['*..', '...', '..*'], 4, 2);
  const state = createGame(floor);
  assert.equal(toggleFlag(state, 0), true);
  assert.equal(reveal(state, 0), false);
  assert.equal(toggleFlag(state, 0), true);
  assert.equal(reveal(state, 0), true);
  assert.equal(state.status, 'lost');
  assert.equal(state.exploded, 0);
  assert.equal(reveal(state, 1), false);
  assert.equal(toggleFlag(state, 1), false);
});

test('fog view does not disclose hidden terrain, mines, clues, or stairs', () => {
  const floor = fixture(['*.....', '..#...', '.....*'], 6, 10);
  const state = createGame(floor);
  const view = getPlayerView(state);
  assert.equal(view.cells[10].kind, 'fog');
  assert.deepEqual(Object.keys(view.cells[10]).sort(), ['index', 'kind', 'x', 'y']);
  assert.equal(view.cells[0].kind, 'covered');
  assert.equal('mine' in view.cells[0], false);
  assert.equal('clue' in view.cells[0], false);
  assert.equal('stairs' in view.cells[0], false);
  const visible = getVisibleIndices(state);
  assert.equal(visible.has(6), true);
  assert.equal(visible.has(10), false);
  // Altering anything out of view cannot change the player's observation.
  floor.cells[10].rock = true;
  floor.cells[10].mine = true;
  floor.exit = 11;
  assert.deepEqual(getPlayerView(state), view);
});

test('deductions ignore unproven player flags', () => {
  const floor = fixture(['*..', '...', '..*'], 4, 2);
  const state = createGame(floor);
  const before = deduce(getPlayerView(state));
  toggleFlag(state, 1);
  assert.deepEqual(deduce(getPlayerView(state)), before);
  assert.equal(before.safe.size, 0);
  assert.equal(before.mines.size, 0);
});

test('solver skips a clue when fog conceals any neighboring variable', () => {
  const view = { width: 3, height: 1, cells: [
    { index: 0, kind: 'fog' },
    { index: 1, kind: 'revealed', clue: 1 },
    { index: 2, kind: 'covered' },
  ] };
  const result = deduce(view);
  assert.equal(result.safe.size, 0);
  assert.equal(result.mines.size, 0);
});

test('malformed numeric inputs and floor metadata fail safely', () => {
  assert.deepEqual(difficultyForDepth(Infinity), difficultyForDepth(1));
  assert.equal(generateFloor(NaN, { seed: 'bad-depth' }).depth, 1);
  assert.throws(() => generateFloor(1, { maxAttempts: NaN }), RangeError);
  assert.throws(() => generateFloor(1, { maxAttempts: -1 }), RangeError);
  assert.equal(validateFloor(null).solvable, false);
  const floor = fixture(['*..', '...', '..*'], 4, 2);
  floor.cells[4].clue = 0;
  assert.equal(validateFloor(floor).reason, 'invalid-cells');
  floor.cells[4].clue = 2;
  floor.exit = 99;
  assert.equal(validateFloor(floor).reason, 'invalid-endpoint');
  assert.equal(deduce(null).contradiction, true);
});

test('subset subtraction makes deductions unavailable from an isolated clue', () => {
  // Artificial but consistent view: constraints {3,4}=1 and {3,4,5}=1
  // prove 5 safe. Rock removes other variables from each visible clue.
  const view = {
    width: 3, height: 2,
    cells: [
      { index: 0, kind: 'revealed', clue: 1 },
      { index: 1, kind: 'revealed', clue: 1 },
      { index: 2, kind: 'rock' },
      { index: 3, kind: 'covered' },
      { index: 4, kind: 'covered' },
      { index: 5, kind: 'covered' },
    ],
  };
  assert.equal(deduce(view, { maxSubsetPasses: 0 }).safe.size, 0);
  const result = deduce(view);
  assert.equal(result.safe.has(5), true);
  assert.ok(result.techniques.subsets > 0);
});

test('solver deductions agree with exhaustive possibilities on tiny boards', () => {
  const width = 3, height = 3;
  // Exhaust all 512 mine layouts. Only safe numbered observations are given,
  // with all other squares covered, so this independently checks inference.
  for (let actual = 0; actual < 512; actual++) {
    const mines = i => !!(actual & (1 << i));
    const revealed = [0, 4, 8].filter(i => !mines(i));
    if (!revealed.length) continue;
    const view = {
      width, height,
      cells: Array.from({ length: 9 }, (_, index) => ({
        index, kind: revealed.includes(index) ? 'revealed' : 'covered',
        ...(revealed.includes(index) ? { clue: neighbors({ width, height }, index).filter(mines).length } : {}),
      })),
    };
    const possibilities = [];
    for (let proposed = 0; proposed < 512; proposed++) {
      if (revealed.some(i => proposed & (1 << i))) continue;
      if (revealed.every(i => neighbors(view, i).filter(n => proposed & (1 << n)).length === view.cells[i].clue)) possibilities.push(proposed);
    }
    const result = deduce(view);
    assert.equal(result.contradiction, false);
    for (const index of result.safe) assert.ok(possibilities.every(bits => !(bits & (1 << index))), `unsafe proof at layout ${actual}, cell ${index}`);
    for (const index of result.mines) assert.ok(possibilities.every(bits => bits & (1 << index)), `false mine proof at layout ${actual}, cell ${index}`);
  }
});

test('validator rejects a forced guess and stairs in the opening', () => {
  const ambiguous = fixture(['*.*.*', '.....', '*.*.*', '.....', '*.*..'], 6, 24);
  assert.equal(validateFloor(ambiguous).reason, 'deduction-stalled');
  const trivial = fixture(['...', '...', '...'], 4, 2);
  assert.equal(validateFloor(trivial).reason, 'stairs-in-opening');
});

test('difficulty holds its initial cap and rises gradually after milestones', () => {
  assert.deepEqual(difficultyForDepth(100), difficultyForDepth(200));
  assert.equal(difficultyForDepth(201).band, 1);
  assert.ok(difficultyForDepth(300).mineDensity > difficultyForDepth(201).mineDensity);
  assert.equal(difficultyForDepth(301).band, 2);
  assert.ok(difficultyForDepth(400).mineDensity > difficultyForDepth(300).mineDensity);
  assert.ok(difficultyForDepth(1000000).width <= 23);
  assert.ok(difficultyForDepth(1000000).height <= 21);
  assert.ok(difficultyForDepth(1000000).mineDensity <= 0.205);
});

test('generation is reproducible for debugging and fresh by default', () => {
  assert.deepEqual(generateFloor(22, { seed: 'reproducible' }), generateFloor(22, { seed: 'reproducible' }));
  const a = generateFloor(1), b = generateFloor(1);
  assert.notEqual(a.seed, b.seed);
  assert.notDeepEqual(a.cells, b.cells);
  assert.throws(() => generateFloor(1, { maxAttempts: 0 }), GenerationError);
});

test('near-cleared and one-click staircase generation regressions stay engaging', () => {
  for (const [depth, seed] of [[1, 'balance-1-26'], [201, 'balance-201-136']]) {
    const floor = generateFloor(depth, { seed });
    const state = createGame(floor);
    assert.ok(floor.validation.openingRevealed / floor.validation.safeTiles <= 0.6);
    assert.ok(floor.validation.provenMoves >= difficultyForDepth(depth).minProofMoves);
    for (const index of getVisibleIndices(state)) {
      if (!isFrontier(state, index) || floor.cells[index].mine) continue;
      const probe = { ...state, revealed: new Set(state.revealed), flags: new Set() };
      reveal(probe, index);
      assert.notEqual(probe.status, 'exit', 'no opening frontier click can immediately win');
    }
  }
});

test('320 generated floors have legal sound proof traces across progression bands', () => {
  for (const depth of [1, 50, 100, 200, 201, 300, 1000, 100000]) {
    for (let seed = 0; seed < 40; seed++) {
      const floor = generateFloor(depth, { seed: `validation-${seed}` });
      const state = createGame(floor);
      assert.equal(state.status, 'playing', 'stairs must remain hidden at the start');
      assert.equal(state.revealed.has(floor.entrance), true);
      assert.equal(floor.cells[floor.entrance].clue, 0);
      assert.equal(floor.cells[floor.entrance].x, depth === 1 ? 2 : Math.floor(floor.width / 2));
      assert.ok(floor.cells.some(c => c.rock));
      for (let index = 0; index < floor.cells.length; index++) {
        const cell = floor.cells[index];
        assert.equal(cell.rock && cell.mine, false);
        if (!cell.rock) assert.equal(cell.clue, neighbors(floor, index).filter(i => floor.cells[i].mine).length);
      }
      assert.equal(floor.validation.solvable, true);
      assert.ok(floor.validation.trace.length > 0);
      assert.ok(floor.validation.openingRevealed / floor.validation.safeTiles <= 0.6);
      assert.ok(floor.validation.provenMoves >= difficultyForDepth(depth).minProofMoves);
      for (const step of floor.validation.trace) {
        const proof = deduce(getPlayerView(state), difficultyForDepth(depth));
        for (const index of step.mines) { assert.equal(proof.mines.has(index), true); assert.equal(floor.cells[index].mine, true); }
        for (const index of step.safe) {
          assert.equal(proof.safe.has(index), true, 'every recorded reveal has a visible proof');
          assert.equal(isFrontier(state, index), true, 'every recorded reveal is legally adjacent');
          assert.equal(floor.cells[index].mine, false);
          assert.equal(reveal(state, index), true);
        }
      }
      assert.equal(state.status, 'exit');
      assert.equal(state.revealed.has(floor.exit), true);
    }
  }
});
