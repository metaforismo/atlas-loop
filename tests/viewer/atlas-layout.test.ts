import { describe, expect, it } from "vitest";
import { layoutAtlasGraph } from "../../apps/viewer/src/atlas/layout.js";

function edge(from: string, to: string, label = "tap", count = 1) {
  return { id: `${from}->${to}#${label}`, from, to, label, count };
}

describe("layoutAtlasGraph", () => {
  it("lays a linear funnel out one node per layer, left to right", () => {
    const layout = layoutAtlasGraph(
      ["catalog", "product", "cart", "confirmation"],
      [
        edge("__launch__", "catalog", "launch:app"),
        edge("catalog", "product"),
        edge("product", "cart"),
        edge("cart", "confirmation")
      ]
    );

    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get("__launch__")!.layer).toBe(0);
    expect(byId.get("catalog")!.layer).toBe(1);
    expect(byId.get("product")!.layer).toBe(2);
    expect(byId.get("cart")!.layer).toBe(3);
    expect(byId.get("confirmation")!.layer).toBe(4);
    // Strictly increasing x per layer.
    expect(byId.get("confirmation")!.x).toBeGreaterThan(byId.get("catalog")!.x);
  });

  it("terminates on cycles and keeps self-loops out of layering", () => {
    const layout = layoutAtlasGraph(
      ["a", "b"],
      [edge("__launch__", "a", "launch"), edge("a", "b"), edge("b", "a", "back"), edge("a", "a", "self")]
    );

    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get("a")).toBeDefined();
    expect(byId.get("b")).toBeDefined();
    expect(layout.edges.find((candidate) => candidate.id === "a->a#self")!.selfLoop).toBe(true);
    // Layers stay bounded despite the a<->b cycle.
    expect(byId.get("a")!.layer).toBeLessThanOrEqual(3);
    expect(byId.get("b")!.layer).toBeLessThanOrEqual(3);
  });

  it("places unreachable nodes after the deepest reached layer", () => {
    const layout = layoutAtlasGraph(["reached", "orphan"], [edge("__launch__", "reached", "launch")]);

    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get("orphan")!.layer).toBeGreaterThan(byId.get("reached")!.layer);
  });

  it("is deterministic for identical inputs", () => {
    const nodes = ["catalog", "cart", "shipping"];
    const edges = [edge("__launch__", "catalog", "launch"), edge("catalog", "cart"), edge("catalog", "shipping")];

    const first = layoutAtlasGraph(nodes, edges);
    const second = layoutAtlasGraph(nodes, edges);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Siblings in the same layer occupy distinct rows in id order (equal barycenter).
    const byId = new Map(first.nodes.map((node) => [node.id, node]));
    expect(byId.get("cart")!.row).not.toBe(byId.get("shipping")!.row);
    expect(byId.get("cart")!.row).toBeLessThan(byId.get("shipping")!.row);
  });

  it("handles an empty map", () => {
    const layout = layoutAtlasGraph([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});
