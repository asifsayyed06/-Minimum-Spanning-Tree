'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMst, validateGraph } = require('../lib/mst');

// Classic textbook graph: the minimum spanning tree weighs 39.
const nodes = 'ABCDEFG'.split('').map((id) => ({ id }));
const edges = [
  ['A', 'B', 7], ['A', 'D', 5], ['B', 'C', 8], ['B', 'D', 9], ['B', 'E', 7], ['C', 'E', 5],
  ['D', 'E', 15], ['D', 'F', 6], ['E', 'F', 8], ['E', 'G', 9], ['F', 'G', 11],
].map(([from, to, weight], i) => ({ id: `e${i}`, from, to, weight }));

for (const algorithm of ['kruskal', 'prim']) {
  test(`${algorithm}: finds the known minimum weight`, () => {
    const result = computeMst(nodes, edges, algorithm);
    assert.equal(result.totalWeight, 39);
    assert.equal(result.mstEdgeIds.length, nodes.length - 1);
    assert.equal(result.connected, true);
    assert.equal(result.components, 1);
  });

  test(`${algorithm}: returns a spanning forest when the graph is disconnected`, () => {
    const split = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'lonely' },
    ];
    const splitEdges = [
      { id: 'x', from: 'a', to: 'b', weight: 3 },
      { id: 'y', from: 'c', to: 'd', weight: 4 },
    ];
    const result = computeMst(split, splitEdges, algorithm);
    assert.equal(result.totalWeight, 7);
    assert.equal(result.components, 3);
    assert.equal(result.connected, false);
  });

  test(`${algorithm}: handles negative and decimal weights`, () => {
    const tri = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const triEdges = [
      { id: '1', from: 'a', to: 'b', weight: -2 },
      { id: '2', from: 'b', to: 'c', weight: 0.1 },
      { id: '3', from: 'a', to: 'c', weight: 0.2 },
    ];
    const result = computeMst(tri, triEdges, algorithm);
    assert.deepEqual(new Set(result.mstEdgeIds), new Set(['1', '2']));
    assert.equal(result.totalWeight, -1.9);
  });

  test(`${algorithm}: copes with empty and single-node graphs`, () => {
    assert.equal(computeMst([], [], algorithm).connected, false);
    const one = computeMst([{ id: 'a' }], [], algorithm);
    assert.equal(one.totalWeight, 0);
    assert.equal(one.connected, true);
  });
}

test('both algorithms agree on total weight for random graphs', () => {
  let seed = 42;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let round = 0; round < 50; round++) {
    const n = 2 + Math.floor(random() * 10);
    const ns = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
    const es = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (random() < 0.5) es.push({ id: `e${i}-${j}`, from: `n${i}`, to: `n${j}`, weight: Math.floor(random() * 20) });
      }
    }
    const k = computeMst(ns, es, 'kruskal');
    const p = computeMst(ns, es, 'prim');
    assert.equal(k.totalWeight, p.totalWeight);
    assert.equal(k.components, p.components);
  }
});

test('prim honours the chosen start node and records it', () => {
  const result = computeMst(nodes, edges, 'prim', 'G');
  assert.equal(result.startId, 'G');
  assert.equal(result.steps[0].edgeId, edges.find((e) => e.from === 'E' && e.to === 'G').id);
});

test('kruskal reports skipped edges that would close a loop', () => {
  const result = computeMst(nodes, edges, 'kruskal');
  assert.ok(result.steps.some((s) => s.action === 'reject'));
});

test('validateGraph rejects bad input', () => {
  assert.match(validateGraph('x', []), /arrays/);
  assert.match(validateGraph([{ id: 'a' }, { id: 'a' }], []), /Duplicate node/);
  assert.match(validateGraph([{ id: 'a' }], [{ id: 'e', from: 'a', to: 'z', weight: 1 }]), /does not exist/);
  assert.match(validateGraph([{ id: 'a' }], [{ id: 'e', from: 'a', to: 'a', weight: 1 }]), /itself/);
  assert.match(
    validateGraph([{ id: 'a' }, { id: 'b' }], [{ id: 'e', from: 'a', to: 'b', weight: 'heavy' }]),
    /numeric weight/
  );
  assert.match(
    validateGraph(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'e1', from: 'a', to: 'b', weight: 1 }, { id: 'e2', from: 'b', to: 'a', weight: 2 }]
    ),
    /same pair/
  );
  assert.equal(validateGraph(nodes, edges), null);
});
