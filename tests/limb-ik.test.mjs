import test from 'node:test';
import assert from 'node:assert/strict';
import {solveTwoBone, solveArmTarget} from '../assets/starter/src/limb-ik.js';

// Independent geometry checks only: do not derive an elbow with the solver's
// cosine law, import its helpers, or use a sampled/rendered pose as an oracle.
const UPPER = .32;
const LOWER = .28;
const EPS = 1e-9;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (v, scalar) => v.map(x => x * scalar);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const norm = v => Math.hypot(...v);
const distance = (a, b) => norm(sub(a, b));
const unit = v => mul(v, 1 / norm(v));
const near = (actual, expected, label, tolerance = EPS) => {
  assert.ok(Number.isFinite(actual), `${label}: expected a finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} (tolerance ${tolerance})`);
};
function vectorNear(actual, expected, label) {
  assert.ok(Array.isArray(actual) && actual.length === 3, `${label}: expected a 3-array`);
  actual.forEach((value, i) => near(value, expected[i], `${label}[${i}]`));
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function shuffledIndices(length, random) {
  const indices = Array.from({length}, (_, i) => i);
  for (let i = length - 1; i > 0; --i) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}
function rotateY([x, y, z], yaw) {
  return [Math.cos(yaw)*x + Math.sin(yaw)*z, y, -Math.sin(yaw)*x + Math.cos(yaw)*z];
}
function rotate3([x, y, z], [rx, ry, rz]) {
  [y, z] = [Math.cos(rx)*y - Math.sin(rx)*z, Math.sin(rx)*y + Math.cos(rx)*z];
  [x, z] = [Math.cos(ry)*x + Math.sin(ry)*z, -Math.sin(ry)*x + Math.cos(ry)*z];
  return [Math.cos(rz)*x - Math.sin(rz)*y, Math.sin(rz)*x + Math.cos(rz)*y, z];
}
const inputFor = (target, extra = {}) => ({
  root: [0, 0, 0], target, upperLength: UPPER, lowerLength: LOWER, pole: [0, 1, 0], ...extra,
});
function reasonFor(input) {
  const d = distance(input.root, input.target);
  if (d > input.upperLength + input.lowerLength) return 'TARGET_TOO_FAR';
  if (d < Math.abs(input.upperLength - input.lowerLength)) return 'TARGET_TOO_CLOSE';
  return 'REACHABLE';
}
function checkChain(input, result, reason = reasonFor(input)) {
  const min = Math.abs(input.upperLength - input.lowerLength);
  const max = input.upperLength + input.lowerLength;
  const d = distance(input.root, input.target);
  const radius = Math.min(max, Math.max(min, d));
  vectorNear(result.root, input.root, 'root');
  vectorNear(result.target, input.target, 'original target');
  for (const field of ['joint', 'end']) {
    assert.ok(Array.isArray(result[field]) && result[field].length === 3, `${field}: expected a 3-array`);
    assert.ok(result[field].every(Number.isFinite), `${field}: all coordinates must be finite`);
  }
  near(result.upper_length, input.upperLength, 'upper_length');
  near(result.lower_length, input.lowerLength, 'lower_length');
  near(result.min_reach, min, 'min_reach');
  near(result.max_reach, max, 'max_reach');
  near(distance(result.root, result.joint), input.upperLength, 'measured upper bone');
  near(distance(result.joint, result.end), input.lowerLength, 'measured lower bone');
  near(distance(result.root, result.end), radius, 'clamped endpoint radius');
  near(result.reach_error_m, distance(result.end, input.target), 'measured reach error');
  near(result.reach_error_m, Math.abs(d - radius), 'shortest attainable reach error');
  assert.equal(result.reason, reason, 'reach reason');
  assert.equal(result.reachable, reason === 'REACHABLE', 'reach flag');
  if (result.reachable) vectorNear(result.end, input.target, 'reachable endpoint');
  if (d > EPS && radius > EPS) {
    near(dot(unit(sub(result.end, result.root)), unit(sub(input.target, input.root))), 1,
      'endpoint lies on the forward target ray');
  }
}
function checkPole(input, result) {
  const axis = sub(input.target, input.root);
  const normal = cross(axis, input.pole);
  assert.ok(norm(normal) > 1e-6, 'fixture must have an unambiguous pole plane');
  const elbow = sub(result.joint, result.root);
  near(dot(elbow, unit(normal)), 0, 'elbow lies in target/pole plane');
  assert.ok(dot(cross(axis, elbow), normal) > 0, 'elbow bends toward the pole direction');
}
function actorScale(actor) {
  const scale = actor.scale ?? 1;
  return (Array.isArray(scale) ? scale : [scale, scale, scale]).map(v => v * actor.height / 1.8);
}
function expectedShoulder(actor, state, side) {
  const scale = actorScale(actor);
  const local = [(side === 'left' ? -1 : 1)*.285*scale[0], 1.41*scale[1], 0];
  return add(state.modelPosition, rotateY(local, state.yaw));
}
function handTarget(position, side, contact = true) {
  return {
    position,
    contact: contact ? {id: 'declared-contact', targetId: 'prop', hand: side, localPoint: [0, .1, 0]} : null,
    basis: contact ? 'COMBAT_LOCAL_CONTACT' : 'EXPLICIT_WORLD_TARGET',
    annotation: {source: 'independent-ik-regression'},
  };
}
function checkArm(actor, state, side, target, result, reason) {
  const shoulder = expectedShoulder(actor, state, side);
  const vertical = actorScale(actor)[1];
  const input = {
    root: shoulder, target: target.position,
    upperLength: UPPER*vertical, lowerLength: LOWER*vertical,
  };
  const ik = result.ik;
  assert.ok(ik && typeof ik === 'object', 'arm target includes IK evidence');
  checkChain(input, {
    root: ik.shoulder, joint: ik.elbow, end: ik.wrist, target: result.target_position,
    upper_length: ik.upper_length_m, lower_length: ik.lower_length_m,
    min_reach: Math.abs(input.upperLength - input.lowerLength),
    max_reach: input.upperLength + input.lowerLength,
    reachable: ik.reachable, reason: ik.reason, reach_error_m: ik.reach_error_m,
  }, reason);
  vectorNear(result.position, ik.wrist, 'published hand position is the actual wrist');
  vectorNear(result.target_position, target.position, 'published original hand target');
  assert.deepEqual(result.annotation, target.annotation, 'retain extra hand target metadata');
  if (ik.reachable) {
    assert.deepEqual(result.contact, target.contact, 'reachable contact metadata survives');
    assert.equal(result.basis, target.basis, 'reachable target basis survives');
  } else {
    assert.ok(ik.reach_error_m > EPS, 'unreachable contact reports a positive measured gap');
  }
}

test('two-bone solver preserves .32/.28 metre bones for reachable targets and both bend directions', () => {
  for (const pole of [[0, 1, 0], [0, -1, 0], [1, .5, 0]]) {
    const input = inputFor([.12, -.18, -.34], {root: [.02, -.03, .04], pole});
    const result = solveTwoBone(input);
    checkChain(input, result, 'REACHABLE');
    checkPole(input, result);
  }
});

test('far and near targets clamp to the nearest reach boundary while preserving the target', () => {
  for (const [radius, reason] of [[2, 'TARGET_TOO_FAR'], [.01, 'TARGET_TOO_CLOSE']]) {
    const input = inputFor([radius, 0, 0]);
    const result = solveTwoBone(input);
    checkChain(input, result, reason);
    assert.notDeepEqual(result.end, result.target, 'the clamped wrist and requested target differ');
  }
});

test('the exact outer and inner reach boundaries are reachable without shortening either bone', () => {
  for (const radius of [UPPER + LOWER, Math.abs(UPPER - LOWER)]) {
    const input = inputFor([radius, 0, 0]);
    const result = solveTwoBone(input);
    checkChain(input, result, 'REACHABLE');
    near(norm(cross(sub(result.joint, result.root), sub(result.end, result.root))), 0,
      'boundary bones are collinear');
  }
});

test('zero-distance targets remain finite for unequal, reversed, and equal bone lengths', () => {
  for (const [upperLength, lowerLength] of [[UPPER, LOWER], [LOWER, UPPER], [.3, .3]]) {
    for (const pole of [[0, 1, 0], [0, 0, 0]]) {
      const input = inputFor([2, -1, 3], {root: [2, -1, 3], upperLength, lowerLength, pole});
      checkChain(input, solveTwoBone(input), upperLength === lowerLength ? 'REACHABLE' : 'TARGET_TOO_CLOSE');
    }
  }
});

test('reversing the longer bone keeps the inner clamp at the absolute length difference', () => {
  const input = inputFor([.008, 0, 0], {upperLength: LOWER, lowerLength: UPPER});
  checkChain(input, solveTwoBone(input), 'TARGET_TOO_CLOSE');
});

test('zero, collinear, opposite, and nearly collinear poles have a finite deterministic fallback', () => {
  for (const target of [[0, 0, -.4], [0, 0, -(UPPER + LOWER)], [0, 0, -.01]]) {
    for (const pole of [[0, 0, 0], [0, 0, -1], [0, 0, 1], [1e-14, 0, -1]]) {
      const input = freeze(inputFor(target, {pole}));
      const first = solveTwoBone(input);
      checkChain(input, first);
      solveTwoBone(inputFor([.3, -.1, -.1], {pole: [0, -1, 0]}));
      assert.deepEqual(solveTwoBone(input), first, 'fallback cannot depend on the previous solve');
    }
  }
});

test('pole is a direction: translating the root and target does not change the local bend', () => {
  const input = inputFor([.18, -.1, -.36], {root: [.01, -.04, .02], pole: [1, 2, .5]});
  const first = solveTwoBone(input);
  const shift = [7, -3, 5];
  const movedInput = {...input, root: add(input.root, shift), target: add(input.target, shift)};
  const moved = solveTwoBone(movedInput);
  checkChain(movedInput, moved);
  for (const field of ['root', 'joint', 'end', 'target']) {
    vectorNear(moved[field], add(first[field], shift), `translated ${field}`);
  }
  for (const magnitude of [.125, 3, 64]) {
    const rescaledInput = {...input, pole: mul(input.pole, magnitude)};
    const rescaled = solveTwoBone(rescaledInput);
    checkChain(rescaledInput, rescaled);
    vectorNear(rescaled.joint, first.joint, 'positive pole magnitude does not change the joint');
  }
});

test('opposite poles choose opposite elbow half-planes without moving the reachable wrist', () => {
  const input = inputFor([0, 0, -.4]);
  const up = solveTwoBone(input);
  const downInput = {...input, pole: [0, -1, 0]};
  const down = solveTwoBone(downInput);
  checkChain(input, up);
  checkChain(downInput, down);
  checkPole(input, up);
  checkPole(downInput, down);
  vectorNear(up.end, down.end, 'opposite-pole wrist');
  near(norm(cross(add(up.joint, down.joint), input.target)), 0,
    'midpoint of opposite bends lies on the root-target axis');
});

test('fixed-seed spatial targets obey measured lengths, nearest reach, and the pole plane', () => {
  const random = seeded(0x1badb002);
  for (let i = 0; i < 180; ++i) {
    const root = Array.from({length: 3}, () => random()*8 - 4);
    const direction = unit([random() - .5, random() - .5, random() - .5]);
    const radius = i % 3 === 0 ? .001 + random()*.025
      : i % 3 === 1 ? .08 + random()*.47 : .7 + random()*2;
    const pole = unit(cross(direction, Math.abs(direction[1]) < .8 ? [0, 1, 0] : [1, 0, 0]));
    const input = freeze(inputFor(add(root, mul(direction, radius)), {root, pole}));
    const result = solveTwoBone(input);
    checkChain(input, result);
    if (result.reachable) checkPole(input, result);
  }
});

test('nondegenerate solutions are equivariant under arbitrary 3D rigid rotations and translations', () => {
  const angles = [.61, -1.13, .37];
  const shift = [-4, 2.5, 7];
  for (const radius of [.012, .37, 1.8]) {
    const root = [.2, -.3, .1];
    const input = inputFor(add(root, mul(unit([.4, -.2, -.7]), radius)), {root, pole: [.1, 1, .2]});
    const first = solveTwoBone(input);
    const movedInput = {
      ...input, root: add(rotate3(root, angles), shift),
      target: add(rotate3(input.target, angles), shift), pole: rotate3(input.pole, angles),
    };
    const moved = solveTwoBone(movedInput);
    checkChain(input, first);
    checkChain(movedInput, moved, first.reason);
    for (const field of ['root', 'joint', 'end', 'target']) {
      vectorNear(moved[field], add(rotate3(first[field], angles), shift), `rigidly transformed ${field}`);
    }
    near(moved.reach_error_m, first.reach_error_m, 'rigid transform preserves reach error');
  }
});

test('two-bone solves do not mutate frozen inputs or retain an order-dependent previous pose', () => {
  const random = seeded(0xc0ffee42);
  const inputs = Array.from({length: 48}, (_, i) => freeze(inputFor(
    [random()*.8 - .4, random()*.8 - .4, -random()*.8],
    {root: [random()*.2, -.1, .2], pole: [i % 2 ? -1 : 1, .7, .3]},
  )));
  const before = structuredClone(inputs);
  const snapshots = inputs.map(input => structuredClone(solveTwoBone(input)));
  for (const i of shuffledIndices(inputs.length, random).concat(shuffledIndices(inputs.length, random))) {
    assert.deepEqual(solveTwoBone(inputs[i]), snapshots[i], `nonsequential solve ${i}`);
  }
  assert.deepEqual(inputs, before, 'all root, target, pole, and length inputs survive unchanged');
});

test('non-finite, non-numeric, zero, and negative bone lengths are rejected', async t => {
  const invalid = [0, -.01, NaN, Infinity, -Infinity, '.32', null, undefined];
  for (const field of ['upperLength', 'lowerLength']) {
    for (const [i, value] of invalid.entries()) {
      await t.test(`${field} invalid case ${i}: ${String(value)}`, () => {
        assert.throws(() => solveTwoBone({...inputFor([0, 0, -.3]), [field]: value}));
      });
    }
  }
});

test('root, target, and pole require finite numeric 3-arrays', async t => {
  const invalid = [undefined, null, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0],
    [0, Infinity, 0], [0, 0, -Infinity], [0, '1', 0], {x: 0, y: 0, z: 0}];
  for (const field of ['root', 'target', 'pole']) {
    for (const [i, value] of invalid.entries()) {
      // An omitted pole may select a default; every supplied pole must be a valid vector.
      if (field === 'pole' && value === undefined) continue;
      await t.test(`${field} invalid case ${i}`, () => {
        assert.throws(() => solveTwoBone({...inputFor([0, 0, -.3]), [field]: value}));
      });
    }
  }
});

for (const side of ['left', 'right']) {
  test(`${side} arm uses the contracted shoulder, fixed world bone lengths, and reachable contact`, () => {
    const actor = freeze({height: 1.8});
    const state = freeze({modelPosition: [0, 0, 0], yaw: 0});
    const target = freeze(handTarget([(side === 'left' ? -1 : 1)*.285, 1.11, -.25], side));
    const result = solveArmTarget(actor, state, side, target);
    checkArm(actor, state, side, target, result, 'REACHABLE');
    vectorNear(result.ik.shoulder, [(side === 'left' ? -1 : 1)*.285, 1.41, 0], 'base shoulder');
  });

  test(`${side} arm reaches both exact length boundaries without shortening a bone`, () => {
    const actor = {height: 1.8};
    const state = {modelPosition: [0, 0, 0], yaw: 0};
    const shoulder = expectedShoulder(actor, state, side);
    for (const radius of [UPPER + LOWER, Math.abs(UPPER - LOWER)]) {
      const target = handTarget(add(shoulder, [0, 0, -radius]), side);
      checkArm(actor, state, side, target, solveArmTarget(actor, state, side, target), 'REACHABLE');
    }
  });

  for (const [label, offset, reason] of [
    ['too far', [0, 0, -2], 'TARGET_TOO_FAR'],
    ['too close', [0, -.01, 0], 'TARGET_TOO_CLOSE'],
    ['at the shoulder', [0, 0, 0], 'TARGET_TOO_CLOSE'],
  ]) {
    test(`${side} arm reports an unmet declared contact for a target ${label}`, () => {
      const actor = freeze({height: 1.8});
      const state = freeze({modelPosition: [3, .4, -2], yaw: .7});
      const target = freeze(handTarget(add(expectedShoulder(actor, state, side), offset), side));
      const before = structuredClone(target);
      const result = solveArmTarget(actor, state, side, target);
      checkArm(actor, state, side, target, result, reason);
      assert.deepEqual(target, before, 'clamping cannot rewrite the declared contact or original target');
      // contact describes the requested target in the spread handTarget contract.
      // Actual contact requires a reachable wrist at that target, never stretched bones.
      assert.deepEqual(result.contact, target.contact, 'preserve the declared contact metadata');
      assert.equal(result.ik.reachable, false, 'the declared contact is physically unreachable');
      const actualGap = distance(result.position, target.position);
      assert.ok(actualGap > EPS, 'actual wrist must not be snapped onto an unreachable contact');
      near(result.ik.reach_error_m, actualGap, 'reported contact miss equals the actual wrist gap');
    });
  }

  test(`${side} arm retains a null contact for explicit reachable and unreachable world targets`, () => {
    const actor = {height: 1.8};
    const state = {modelPosition: [0, 0, 0], yaw: 0};
    const shoulder = expectedShoulder(actor, state, side);
    for (const distance of [.32, 1.2]) {
      const target = freeze(handTarget(add(shoulder, [0, 0, -distance]), side, false));
      const result = solveArmTarget(actor, state, side, target);
      checkArm(actor, state, side, target, result, distance < .6 ? 'REACHABLE' : 'TARGET_TOO_FAR');
      assert.equal(result.contact, null, 'solving IK cannot invent a contact');
    }
  });
}

test('uniform and nonuniform actor scales preserve world bone lengths across hand directions and yaw', () => {
  const actors = [
    {height: .9}, {height: 1.8, scale: .75}, {height: 2.7, scale: 2},
    {height: 1.8, scale: [3, 1, .2]}, {height: 1.8, scale: [.2, 1, 4]},
    {height: 2.1, scale: [.3, 1.6, 5]}, {height: 1.2, scale: [4, .5, .25]},
  ];
  for (const actor of actors) {
    const vertical = actorScale(actor)[1];
    for (const side of ['left', 'right']) {
      for (const yaw of [0, Math.PI/2, -.83]) {
        const state = {modelPosition: [1.2, -.7, 2.3], yaw};
        const shoulder = expectedShoulder(actor, state, side);
        for (const direction of [[1, 0, 0], [0, -1, 0], [0, 0, -1], unit([1, -2, -3])]) {
          const target = freeze(handTarget(add(shoulder, mul(direction, .4*vertical)), side));
          checkArm(actor, state, side, target, solveArmTarget(actor, state, side, target), 'REACHABLE');
        }
      }
    }
  }
});

test('arm reach limits also use vertical scale when the torso has a different horizontal scale', () => {
  for (const actor of [{height: 1.8, scale: [5, 1, .1]}, {height: 2.7, scale: [.2, 2, 6]}]) {
    for (const side of ['left', 'right']) {
      const state = {modelPosition: [-2, 1, 3], yaw: 1.2};
      const shoulder = expectedShoulder(actor, state, side);
      const vertical = actorScale(actor)[1];
      for (const [radius, reason] of [[.01, 'TARGET_TOO_CLOSE'], [.9, 'TARGET_TOO_FAR']]) {
        const target = freeze(handTarget(add(shoulder, [.6*radius*vertical, 0, -.8*radius*vertical]), side));
        checkArm(actor, state, side, target, solveArmTarget(actor, state, side, target), reason);
      }
    }
  }
});

test('scalar and equivalent uniform vector scales produce the same arm geometry', () => {
  for (const side of ['left', 'right']) {
    const actor = {height: 2.1, scale: 1.5};
    const state = {modelPosition: [.4, .7, -.9], yaw: -.5};
    const target = handTarget(add(expectedShoulder(actor, state, side), [.2, -.3, -.4]), side);
    const scalar = solveArmTarget(actor, state, side, target);
    const vector = solveArmTarget({...actor, scale: [1.5, 1.5, 1.5]}, state, side, target);
    checkArm(actor, state, side, target, scalar, 'REACHABLE');
    checkArm(actor, state, side, target, vector, 'REACHABLE');
    for (const field of ['shoulder', 'elbow', 'wrist']) vectorNear(vector.ik[field], scalar.ik[field], field);
  }
});

test('both arm solutions commute with a world translation and actor yaw rotation', () => {
  const actor = {height: 2.1, scale: [1.7, .9, .5]};
  const state = {modelPosition: [1.7, .5, -.2], yaw: -.6};
  const yaw = 1.17;
  const shift = [6, -3, 2];
  const transformedState = {modelPosition: add(rotateY(state.modelPosition, yaw), shift), yaw: state.yaw + yaw};
  for (const side of ['left', 'right']) {
    for (const offset of [[.16, -.27, -.2], [.8, -.9, -.5], [.008, -.009, -.006]]) {
      const target = handTarget(add(expectedShoulder(actor, state, side), offset), side);
      const original = solveArmTarget(actor, state, side, target);
      const transformedTarget = {...target, position: add(rotateY(target.position, yaw), shift)};
      const transformed = solveArmTarget(actor, transformedState, side, transformedTarget);
      checkArm(actor, state, side, target, original);
      checkArm(actor, transformedState, side, transformedTarget, transformed, original.ik.reason);
      for (const field of ['shoulder', 'elbow', 'wrist']) {
        vectorNear(transformed.ik[field], add(rotateY(original.ik[field], yaw), shift), `transformed arm ${field}`);
      }
      near(transformed.ik.reach_error_m, original.ik.reach_error_m, 'arm reach error under rigid transform');
    }
  }
});

test('fixed-seed arm targets preserve scale and geometry under nonsequential evaluation', () => {
  const random = seeded(0x5ca1e123);
  const cases = Array.from({length: 96}, (_, i) => {
    const actor = {height: 1.2 + random()*1.2, scale: [.25 + random()*3, .5 + random()*1.5, .25 + random()*3]};
    const state = {modelPosition: [random()*6 - 3, random()*2 - 1, random()*6 - 3], yaw: random()*Math.PI*2};
    const side = i % 2 ? 'left' : 'right';
    const radius = (i % 3 === 0 ? .01 : i % 3 === 1 ? .35 : 1.1)*actorScale(actor)[1];
    const direction = unit([random() - .5, random() - .5, random() - .5]);
    return freeze({actor, state, side,
      target: handTarget(add(expectedShoulder(actor, state, side), mul(direction, radius)), side)});
  });
  const before = structuredClone(cases);
  const snapshots = cases.map(({actor, state, side, target}) => {
    const result = solveArmTarget(actor, state, side, target);
    checkArm(actor, state, side, target, result);
    return structuredClone(result);
  });
  for (const i of shuffledIndices(cases.length, random).concat(shuffledIndices(cases.length, random))) {
    const {actor, state, side, target} = cases[i];
    assert.deepEqual(solveArmTarget(actor, state, side, target), snapshots[i], `nonsequential arm target ${i}`);
  }
  assert.deepEqual(cases, before, 'actor, state, contact, and hand target inputs remain unchanged');
});
