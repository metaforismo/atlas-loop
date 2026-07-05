import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { screenDisplayName, screenImageUrl, type AtlasScreenLike, type AtlasTransitionLike } from "./atlasApi.js";
import { GRAPH_LAUNCH_NODE, layoutAtlasGraph, type GraphLayoutNode } from "./layout.js";

const NODE_WIDTH = 150;
const NODE_HEIGHT = 104;
const THUMB_WIDTH = 40;

export function MapGraph({
  daemonUrl,
  screens,
  transitions,
  selectedScreenId,
  onSelectScreen
}: {
  daemonUrl: string;
  screens: AtlasScreenLike[];
  transitions: AtlasTransitionLike[];
  selectedScreenId?: string;
  onSelectScreen: (screenId: string) => void;
}) {
  const layout = useMemo(
    () =>
      layoutAtlasGraph(
        screens.map((screen) => screen.id),
        transitions.map((transition) => ({
          id: transition.id,
          from: transition.from,
          to: transition.to,
          label: transition.actionSignature,
          count: transition.count
        }))
      ),
    [screens, transitions]
  );

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | undefined>(undefined);

  const screensById = useMemo(() => new Map(screens.map((screen) => [screen.id, screen])), [screens]);
  const nodesById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault();
    setTransform((current) => {
      const nextScale = Math.min(2.5, Math.max(0.4, current.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
      return { ...current, scale: nextScale };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY)
    }));
  };

  const handlePointerUp = (): void => {
    dragRef.current = undefined;
  };

  return (
    <div className="atlas-graph-wrap" aria-label="Screen transition graph">
      <svg
        className="atlas-graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="img"
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {layout.edges.map((edge) => {
            const fromNode = nodesById.get(edge.from);
            const toNode = nodesById.get(edge.to);
            if (!fromNode || !toNode) return null;
            return (
              <g key={edge.id} className="atlas-graph-edge">
                <path d={edgePath(fromNode, toNode, edge.selfLoop)} fill="none" markerEnd="url(#atlas-arrow)" />
                <text {...edgeLabelPosition(fromNode, toNode, edge.selfLoop)}>{`${edge.label} ×${edge.count}`}</text>
              </g>
            );
          })}

          {layout.nodes.map((node) => {
            const screen = screensById.get(node.id);
            const isLaunch = node.id === GRAPH_LAUNCH_NODE;
            return (
              <g
                key={node.id}
                className={`atlas-graph-node ${node.id === selectedScreenId ? "selected" : ""} ${isLaunch ? "launch" : ""}`}
                transform={`translate(${node.x} ${node.y})`}
                onClick={() => {
                  if (!isLaunch) onSelectScreen(node.id);
                }}
                role={isLaunch ? undefined : "button"}
                aria-label={isLaunch ? "App launch" : `Select screen ${screen ? screenDisplayName(screen) : node.id}`}
              >
                {isLaunch ? (
                  <>
                    <circle cx={NODE_WIDTH / 2} cy={NODE_HEIGHT / 2} r={26} />
                    <text className="atlas-graph-node-name" x={NODE_WIDTH / 2} y={NODE_HEIGHT / 2 + 4} textAnchor="middle">
                      launch
                    </text>
                  </>
                ) : (
                  <>
                    <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={12} />
                    {screen ? (
                      <image
                        href={screenImageUrl(daemonUrl, node.id)}
                        x={8}
                        y={8}
                        width={THUMB_WIDTH}
                        height={NODE_HEIGHT - 16}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    ) : null}
                    <text className="atlas-graph-node-name" x={THUMB_WIDTH + 16} y={30}>
                      {screen ? screenDisplayName(screen) : node.id}
                    </text>
                    <text className="atlas-graph-node-meta" x={THUMB_WIDTH + 16} y={50}>
                      {screen ? `${screen.screenshotCount} shots` : ""}
                    </text>
                    <text className="atlas-graph-node-meta" x={THUMB_WIDTH + 16} y={68}>
                      {screen ? `${screen.sessionIds.length} sessions` : ""}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
        <defs>
          <marker id="atlas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

function edgePath(fromNode: GraphLayoutNode, toNode: GraphLayoutNode, selfLoop: boolean): string {
  if (selfLoop) {
    const x = fromNode.x + NODE_WIDTH / 2;
    const y = fromNode.y;
    return `M ${x - 22} ${y} C ${x - 34} ${y - 42}, ${x + 34} ${y - 42}, ${x + 22} ${y}`;
  }

  const startX = fromNode.x + NODE_WIDTH;
  const startY = fromNode.y + NODE_HEIGHT / 2;
  const endX = toNode.x;
  const endY = toNode.y + NODE_HEIGHT / 2;
  const bend = Math.max(40, (endX - startX) / 2);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function edgeLabelPosition(fromNode: GraphLayoutNode, toNode: GraphLayoutNode, selfLoop: boolean): { x: number; y: number; textAnchor: "middle" } {
  if (selfLoop) {
    return { x: fromNode.x + NODE_WIDTH / 2, y: fromNode.y - 36, textAnchor: "middle" };
  }
  return {
    x: (fromNode.x + NODE_WIDTH + toNode.x) / 2,
    y: (fromNode.y + toNode.y) / 2 + NODE_HEIGHT / 2 - 8,
    textAnchor: "middle"
  };
}
