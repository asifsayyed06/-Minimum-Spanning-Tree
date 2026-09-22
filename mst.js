'use strict';

const MAX_NODES = 200;
const MAX_EDGES = 2000;
const ALGORITHMS = ['kruskal', 'prim'];

/**
 * Checks that a graph is well formed. Returns an error message, or null if valid.
 * Nodes: { id }.  Edges: { id, from, to, weight } (undirected, no self-loops,
 * no two edges between the same pair of nodes).
 */
function validateGraph(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return 'nodes and edges must both be arrays';
  }
  if (nodes.length > MAX_NODES) return `A graph can have at most ${MAX_NODES} nodes`;
  if (edges.length > MAX_EDGES) return `A graph can have at most ${MAX_EDGES} edges`;

  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || node.id === '' || node.id.length > 40) {
      return 'Every node needs a text id of 1 to 40 characters';
    }
    if (nodeIds.has(node.id)) return `Duplicate node id "${node.id}"`;
    nodeIds.add(node.id);
  }

  const edgeIds = new Set();
  const pairs = new Set();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== 'string' || edge.id === '' || edge.id.length > 40) {
      return 'Every edge needs a text id of 1 to 40 characters';
    }
    if (edgeIds.has(edge.id)) return `Duplicate edge id "${edge.id}"`;
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return `Edge "${edge.id}" connects a node that does not exist`;
    }
    if (edge.from === edge.to) return `Edge "${edge.id}" connects a node to itself`;
    if (typeof edge.weight !== 'number' || !Number.isFinite(edge.weight)) {
      return `Edge "${edge.id}" needs a numeric weight`;
    }

    const key = edge.from < edge.to ? `${edge.from}\u0000${edge.to}` : `${edge.to}\u0000${edge.from}`;
    if (pairs.has(key)) return 'Two edges connect the same pair of nodes';
    pairs.add(key);
  }
  return null;
}

/** Disjoint-set (union-find) with path compression and union by size. */
class DisjointSet {
  constructor(ids) {
    this.parent = new Map();
    this.size = new Map();
    for (const id of ids) {
      this.parent.set(id, id);
      this.size.set(id, 1);
    }
  }

  find(id) {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(id) !== root) {
      const next = this.parent.get(id);
      this.parent.set(id, root);
      id = next;
    }
    return root;
  }

  /** Joins the sets of a and b. Returns false if they were already joined. */
  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return false;
    if (this.size.get(rootA) < this.size.get(rootB)) [rootA, rootB] = [rootB, rootA];
    this.parent.set(rootB, rootA);
    this.size.set(rootA, this.size.get(rootA) + this.size.get(rootB));
    return true;
  }
}

/**
 * Kruskal: look at edges from cheapest to dearest, keep an edge unless it
 * would close a loop. Ties are broken by the order the edges were drawn.
 */
function kruskal(nodes, edges) {
  const sets = new DisjointSet(nodes.map((n) => n.id));
  const indexed = edges.map((edge, index) => ({ edge, index }));
  indexed.sort((a, b) => a.edge.weight - b.edge.weight || a.index - b.index);

  const chosen = [];
  const steps = [];
  for (const { edge } of indexed) {
    if (sets.union(edge.from, edge.to)) {
      chosen.push(edge);
      steps.push({ edgeId: edge.id, action: 'accept', note: 'Connects two separate groups' });
    } else {
      steps.push({ edgeId: edge.id, action: 'reject', note: 'Would close a loop' });
    }
    if (chosen.length === nodes.length - 1) break; // tree is complete
  }
  return { chosen, steps };
}

/**
 * Prim: grow one tree from a start node, always adding the cheapest edge that
 * leaves the tree. If the graph is disconnected, growth restarts from the next
 * unvisited node, which yields a minimum spanning forest.
 */
function prim(nodes, edges, startId) {
  const order = new Map(edges.map((edge, index) => [edge.id, index]));
  const neighbours = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    neighbours.get(edge.from).push({ edge, to: edge.to });
    neighbours.get(edge.to).push({ edge, to: edge.from });
  }

  const roots = nodes.map((n) => n.id);
  if (startId) roots.unshift(startId);

  const visited = new Set();
  const chosen = [];
  const steps = [];

  for (const root of roots) {
    if (visited.has(root)) continue;
    visited.add(root);
    const frontier = neighbours.get(root).slice();

    while (frontier.length > 0) {
      let best = 0;
      for (let i = 1; i < frontier.length; i++) {
        const a = frontier[i].edge;
        const b = frontier[best].edge;
        if (a.weight < b.weight || (a.weight === b.weight && order.get(a.id) < order.get(b.id))) {
          best = i;
        }
      }
      const { edge, to } = frontier.splice(best, 1)[0];
      if (visited.has(to)) continue; // edge now points inside the tree

      visited.add(to);
      chosen.push(edge);
      steps.push({ edgeId: edge.id, action: 'accept', node: to, note: 'Cheapest edge leaving the tree' });
      for (const next of neighbours.get(to)) {
        if (!visited.has(next.to)) frontier.push(next);
      }
    }
  }
  return { chosen, steps };
}

/**
 * Runs the chosen algorithm and returns everything the front end needs to
 * draw the answer and replay it step by step.
 */
function computeMst(nodes, edges, algorithm = 'kruskal', startId = '') {
  if (!ALGORITHMS.includes(algorithm)) {
    throw new Error(`Unknown algorithm "${algorithm}"`);
  }
  const { chosen, steps } =
    algorithm === 'prim' ? prim(nodes, edges, startId) : kruskal(nodes, edges);

  const total = chosen.reduce((sum, edge) => sum + edge.weight, 0);
  const components = nodes.length - chosen.length; // a forest has n - (edges) trees

  return {
    algorithm,
    startId: algorithm === 'prim' ? startId || (nodes[0] ? nodes[0].id : '') : undefined,
    mstEdgeIds: chosen.map((edge) => edge.id),
    totalWeight: Math.round(total * 1e9) / 1e9,
    components,
    connected: nodes.length > 0 && components === 1,
    steps,
  };
}

module.exports = { ALGORITHMS, validateGraph, computeMst, kruskal, prim };
