"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  Handle,
  getStraightPath,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeProps,
  Position,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Workflow,
  Loader2,
  Server,
  Layers,
  Eye,
  Activity,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatBytes, formatNumber } from "@/lib/utils";
import { useTheme } from "next-themes";
import { api, type TimeRange } from "@/lib/api";
import { useStatsWebSocket } from "@/lib/websocket";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { useIsWindows } from "@/lib/hooks/use-is-windows";
import { resolveActiveChains, encodeActiveLinkKey, type ActiveChainInfo } from "@/lib/active-chain";
import { useTranslations } from "next-intl";
import { isMergedBackendId, type StatsSummary } from "@neko-master/shared";
import { useGatewayProviders, useGatewayProxies } from "@/hooks/api/use-gateway";
import { useGatewayRules } from "@/hooks/api/use-rules";

// ---------- Types ----------

interface MergedChainNode {
  name: string;
  layer: number;
  nodeType: "rule" | "group" | "proxy" | "direct";
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  rules: string[];
  _zeroTraffic?: boolean;
}

interface AllChainFlowData {
  nodes: MergedChainNode[];
  links: Array<{ source: number; target: number; rules: string[] }>;
  rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }>;
  maxLayer: number;
}

interface UnifiedRuleChainFlowProps {
  selectedRule: string | null;
  activeBackendId?: number;
  timeRange?: TimeRange;
  autoRefresh?: boolean;
  visibleRuleNames?: Set<string>;
}

// ---------- Layout constants ----------

const COLUMN_WIDTH = 280;
const NODE_HEIGHT = 95;
const OTHER_NODES_OFFSET = 130;
const RULE_CHAIN_FLOW_WS_MIN_PUSH_MS = 5000;

// ---------- Custom Edge ----------

const MergedAnimatedFlowEdge = memo(function MergedAnimatedFlowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps) {
  const edgeData = data as
    | {
        isToProxy?: boolean;
        isToDirect?: boolean;
        dimmed?: boolean;
        showAll?: boolean;
        _zeroTraffic?: boolean;
      }
    | undefined;
  const isToProxy = edgeData?.isToProxy;
  const isToDirect = edgeData?.isToDirect;
  const dimmed = edgeData?.dimmed;
  const showAll = edgeData?.showAll;
  const zeroTraffic = edgeData?._zeroTraffic;
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  // Color logic: DIRECT = orange/red, PROXY = green, others = indigo
  const dotColor = zeroTraffic
    ? "#9CA3AF"
    : isToDirect
      ? "#fb923c" // orange-400
      : isToProxy
        ? "#34d399" // emerald-400
        : "#a5b4fc"; // indigo-300
  const trackColor = zeroTraffic
    ? "rgba(156, 163, 175, 0.1)"
    : isToDirect
      ? "rgba(251, 146, 60, 0.15)" // orange
      : isToProxy
        ? "rgba(16, 185, 129, 0.12)" // emerald
        : "rgba(129, 140, 248, 0.12)"; // indigo
  const lineColor = zeroTraffic
    ? "rgba(156, 163, 175, 0.25)"
    : isToDirect
      ? "rgba(251, 146, 60, 0.4)" // orange
      : isToProxy
        ? "rgba(16, 185, 129, 0.3)" // emerald
        : "rgba(129, 140, 248, 0.3)"; // indigo

  // Keep motion only for active traffic links.
  // Panorama and focused mode share the same three-dot particle style.
  const showFlowMotion = !dimmed && !zeroTraffic;
  const motionDuration = "2s";

  return (
    <g
      style={{
        opacity: dimmed ? 0.12 : zeroTraffic ? 0.5 : 1,
        transition: "opacity 0.4s ease",
      }}>
      <path
        d={edgePath}
        fill="none"
        stroke={trackColor}
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d={edgePath}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {showFlowMotion && (
        <>
          <circle r={3.5} fill={dotColor} opacity={0.9}>
            <animateMotion
              dur={motionDuration}
              repeatCount="indefinite"
              path={edgePath}
              begin="0s"
            />
          </circle>
          <circle r="2.5" fill={dotColor} opacity="0.5">
            <animateMotion
              dur={motionDuration}
              repeatCount="indefinite"
              path={edgePath}
              begin="0.66s"
            />
          </circle>
          <circle r="1.5" fill={dotColor} opacity="0.25">
            <animateMotion
              dur={motionDuration}
              repeatCount="indefinite"
              path={edgePath}
              begin="1.33s"
            />
          </circle>
        </>
      )}
    </g>
  );
}, (prev, next) => {
  // Only re-render when position or visual state changes
  if (prev.sourceX !== next.sourceX || prev.sourceY !== next.sourceY) return false;
  if (prev.targetX !== next.targetX || prev.targetY !== next.targetY) return false;
  const pd = prev.data as Record<string, unknown> | undefined;
  const nd = next.data as Record<string, unknown> | undefined;
  if (pd?.isToProxy !== nd?.isToProxy) return false;
  if (pd?.isToDirect !== nd?.isToDirect) return false;
  if (pd?.dimmed !== nd?.dimmed) return false;
  if (pd?.showAll !== nd?.showAll) return false;
  if (pd?._zeroTraffic !== nd?._zeroTraffic) return false;
  return true;
});

// ---------- Custom Node ----------

const MergedChainNodeComponent = memo(function MergedChainNodeComponent({
  data,
}: {
  data: MergedChainNode & { dimmed?: boolean };
}) {
  const isWindows = useIsWindows();
  const dimmed = data.dimmed;
  const zeroTraffic = data._zeroTraffic;
  const wrapStyle: React.CSSProperties = {
    opacity: dimmed ? 0.12 : zeroTraffic ? 0.5 : 1,
    filter: zeroTraffic ? "grayscale(100%)" : undefined,
    transition: "opacity 0.4s ease, filter 0.4s ease",
  };

  // PROXY node - green theme with PROXY badge
  if (data.nodeType === "proxy") {
    return (
      <div className="relative" style={wrapStyle}>
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-semibold tracking-wider z-10 shadow-sm">
          PROXY
        </div>
        <div className="relative px-5 py-3.5 rounded-xl border border-emerald-400/50 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-500/15 dark:to-emerald-500/5 min-w-[170px] shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500/10">
          <Handle
            type="target"
            position={Position.Left}
            className="!w-2.5 !h-2.5 !bg-emerald-400 !border-emerald-500"
          />
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm">
              <Server className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "text-xs font-semibold truncate flex-1 text-emerald-800 dark:text-emerald-200 max-w-[120px]",
                isWindows && "emoji-flag-font",
              )}>
              {data.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">
              ↓ {formatBytes(data.totalDownload)}
            </span>
            <span className="text-emerald-500/70 dark:text-emerald-400/60">
              ↑ {formatBytes(data.totalUpload)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Rule node - violet theme with connection count badge
  if (data.nodeType === "rule") {
    return (
      <div className="relative" style={wrapStyle}>
        <div className="relative px-5 py-3.5 rounded-xl border border-violet-300/50 dark:border-violet-500/30 bg-gradient-to-br from-violet-50 to-white dark:from-violet-500/15 dark:to-violet-900/20 min-w-[170px] shadow-sm">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white bg-violet-500 shadow-sm">
              <Workflow className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "text-xs font-medium truncate flex-1 max-w-[120px]",
                isWindows && "emoji-flag-font",
              )}>
              {data.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="text-blue-500">
              ↓ {formatBytes(data.totalDownload)}
            </span>
            <span className="text-purple-500">
              ↑ {formatBytes(data.totalUpload)}
            </span>
          </div>
          <div className="absolute -top-2.5 -right-2.5 px-1.5 py-0.5 rounded-full bg-violet-500 text-white text-[10px] font-medium shadow-sm">
            {formatNumber(data.totalConnections)}
          </div>
          <Handle
            type="source"
            position={Position.Right}
            className="!w-2 !h-2 !bg-indigo-300 !border-indigo-400"
          />
        </div>
      </div>
    );
  }

  // DIRECT node - orange/amber theme (treated as exit node like PROXY)
  if (data.nodeType === "direct") {
    return (
      <div className="relative" style={wrapStyle}>
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[9px] font-semibold tracking-wider z-10 shadow-sm">
          DIRECT
        </div>
        <div className="relative px-5 py-3.5 rounded-xl border border-orange-400/50 bg-gradient-to-br from-orange-50 to-amber-50/50 dark:from-orange-500/15 dark:to-orange-500/5 min-w-[170px] shadow-md shadow-orange-500/10 ring-1 ring-orange-500/10">
          <Handle
            type="target"
            position={Position.Left}
            className="!w-2.5 !h-2.5 !bg-orange-400 !border-orange-500"
          />
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white bg-gradient-to-br from-orange-400 to-orange-600 shadow-sm">
              <Server className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "text-xs font-semibold truncate flex-1 text-orange-800 dark:text-orange-200 max-w-[120px]",
                isWindows && "emoji-flag-font",
              )}>
              {data.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-orange-600 dark:text-orange-400">
              ↓ {formatBytes(data.totalDownload)}
            </span>
            <span className="text-orange-500/70 dark:text-orange-400/60">
              ↑ {formatBytes(data.totalUpload)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Group node - blue/indigo theme
  return (
    <div className="relative" style={wrapStyle}>
      <div className="relative px-5 py-3.5 rounded-xl border border-blue-300/40 dark:border-blue-500/30 bg-gradient-to-br from-blue-50/80 to-white dark:from-blue-500/15 dark:to-blue-900/20 min-w-[170px] shadow-sm">
        <Handle
          type="target"
          position={Position.Left}
          className="!w-2 !h-2 !bg-indigo-300 !border-indigo-400"
        />
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white bg-blue-500 shadow-sm">
            <Layers className="h-4 w-4" />
          </div>
          <span
            className={cn(
              "text-xs font-medium truncate flex-1 max-w-[120px]",
              isWindows && "emoji-flag-font",
            )}>
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="text-blue-500">
            ↓ {formatBytes(data.totalDownload)}
          </span>
          <span className="text-purple-500">
            ↑ {formatBytes(data.totalUpload)}
          </span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className="!w-2 !h-2 !bg-indigo-300 !border-indigo-400"
        />
      </div>
    </div>
  );
}, (prev, next) => {
  const pd = prev.data;
  const nd = next.data;
  return (
    pd.name === nd.name &&
    pd.nodeType === nd.nodeType &&
    pd.totalUpload === nd.totalUpload &&
    pd.totalDownload === nd.totalDownload &&
    pd.totalConnections === nd.totalConnections &&
    pd._zeroTraffic === nd._zeroTraffic &&
    pd.dimmed === nd.dimmed
  );
});

// ---------- Registered types (defined outside component to avoid re-creation) ----------

const nodeTypes = { mergedChainNode: MergedChainNodeComponent };
const edgeTypes = { mergedAnimatedFlow: MergedAnimatedFlowEdge };

// ---------- Compute a structure fingerprint for detecting structural vs data-only changes ----------

function computeStructureKey(data: AllChainFlowData): string {
  const nodeNames = data.nodes.map((n) => n.name).join("|");
  const linkKeys = data.links.map((l) => `${l.source}-${l.target}`).join("|");
  return `${nodeNames}::${linkKeys}`;
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areRulePathsEqual(
  a: Record<string, { nodeIndices: number[]; linkIndices: number[] }>,
  b: Record<string, { nodeIndices: number[]; linkIndices: number[] }>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  aKeys.sort();
  bKeys.sort();
  if (!areStringArraysEqual(aKeys, bKeys)) return false;

  for (const key of aKeys) {
    const aPath = a[key];
    const bPath = b[key];
    if (!bPath) return false;
    if (aPath.nodeIndices.length !== bPath.nodeIndices.length) return false;
    if (aPath.linkIndices.length !== bPath.linkIndices.length) return false;
    for (let i = 0; i < aPath.nodeIndices.length; i++) {
      if (aPath.nodeIndices[i] !== bPath.nodeIndices[i]) return false;
    }
    for (let i = 0; i < aPath.linkIndices.length; i++) {
      if (aPath.linkIndices[i] !== bPath.linkIndices[i]) return false;
    }
  }
  return true;
}

function areChainFlowDataEqual(a: AllChainFlowData, b: AllChainFlowData): boolean {
  if (a.maxLayer !== b.maxLayer) return false;
  if (a.nodes.length !== b.nodes.length || a.links.length !== b.links.length) {
    return false;
  }

  for (let i = 0; i < a.nodes.length; i++) {
    const an = a.nodes[i];
    const bn = b.nodes[i];
    if (
      an.name !== bn.name ||
      an.layer !== bn.layer ||
      an.nodeType !== bn.nodeType ||
      an.totalUpload !== bn.totalUpload ||
      an.totalDownload !== bn.totalDownload ||
      an.totalConnections !== bn.totalConnections ||
      !areStringArraysEqual(an.rules, bn.rules)
    ) {
      return false;
    }
  }

  for (let i = 0; i < a.links.length; i++) {
    const al = a.links[i];
    const bl = b.links[i];
    if (
      al.source !== bl.source ||
      al.target !== bl.target ||
      !areStringArraysEqual(al.rules, bl.rules)
    ) {
      return false;
    }
  }

  return areRulePathsEqual(a.rulePaths, b.rulePaths);
}

function sortStringArray(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function nodeTypeRank(type: MergedChainNode["nodeType"]): number {
  if (type === "rule") return 0;
  if (type === "group") return 1;
  return 2; // proxy and direct both have highest rank
}

// Normalize node/link ordering to keep index mapping stable across pushes.
// This avoids unnecessary full re-layout when backend output order changes.
function normalizeChainFlowData(input: AllChainFlowData): AllChainFlowData {
  const indexedNodes = input.nodes.map((node, index) => ({ node, index }));
  indexedNodes.sort((a, b) => {
    if (a.node.layer !== b.node.layer) return a.node.layer - b.node.layer;
    const typeDiff = nodeTypeRank(a.node.nodeType) - nodeTypeRank(b.node.nodeType);
    if (typeDiff !== 0) return typeDiff;
    return a.node.name.localeCompare(b.node.name);
  });

  const oldNodeIndexToNew = new Map<number, number>();
  const nodes: MergedChainNode[] = indexedNodes.map((item, nextIndex) => {
    oldNodeIndexToNew.set(item.index, nextIndex);
    return {
      ...item.node,
      rules: sortStringArray(item.node.rules),
      _zeroTraffic: !!item.node._zeroTraffic,
    };
  });

  const indexedLinks = input.links.map((link, index) => {
    const source = oldNodeIndexToNew.get(link.source);
    const target = oldNodeIndexToNew.get(link.target);
    if (source === undefined || target === undefined) {
      return null;
    }
    return {
      index,
      link: {
        source,
        target,
        rules: sortStringArray(link.rules),
      },
    };
  }).filter((item): item is { index: number; link: { source: number; target: number; rules: string[] } } => !!item);

  indexedLinks.sort((a, b) => {
    if (a.link.source !== b.link.source) return a.link.source - b.link.source;
    if (a.link.target !== b.link.target) return a.link.target - b.link.target;
    const aRules = a.link.rules.join("|");
    const bRules = b.link.rules.join("|");
    return aRules.localeCompare(bRules);
  });

  const oldLinkIndexToNew = new Map<number, number>();
  const links = indexedLinks.map((item, nextIndex) => {
    oldLinkIndexToNew.set(item.index, nextIndex);
    return item.link;
  });

  const rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }> = {};
  const ruleNames = Object.keys(input.rulePaths).sort((a, b) => a.localeCompare(b));
  for (const ruleName of ruleNames) {
    const path = input.rulePaths[ruleName];
    const nodeIndices = path.nodeIndices
      .map((oldIndex) => oldNodeIndexToNew.get(oldIndex))
      .filter((value): value is number => value !== undefined);
    const linkIndices = path.linkIndices
      .map((oldIndex) => oldLinkIndexToNew.get(oldIndex))
      .filter((value): value is number => value !== undefined);
    rulePaths[ruleName] = { nodeIndices, linkIndices };
  }

  const maxLayer = nodes.reduce((max, node) => Math.max(max, node.layer), 0);
  return { nodes, links, rulePaths, maxLayer };
}

// ---------- Inner renderer (needs ReactFlowProvider context) ----------

function FlowRenderer({
  data,
  selectedRule,
  showAll,
  isFullscreen,
  onToggleFullscreen,
}: {
  data: AllChainFlowData;
  selectedRule: string | null;
  showAll: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { fitView } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const t = useTranslations("rules");
  const isDark = resolvedTheme === "dark";
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const isFirstRender = useRef(true);
  const reactFlowReady = useRef(false);
  const pendingFitViewRef = useRef<(() => void) | null>(null);
  const prevStructureKeyRef = useRef<string>("");
  const prevSelectedRuleRef = useRef<string | null>(null);
  const prevShowAllRef = useRef<boolean>(false);

  // Active chain indices
  const activeIndices = useMemo(() => {
    if (!selectedRule || !data.rulePaths[selectedRule]) return null;
    return data.rulePaths[selectedRule];
  }, [selectedRule, data]);

  // Structure key to detect structural vs data-only changes
  const structureKey = useMemo(() => computeStructureKey(data), [data]);

  // Compute layout & trigger viewport animation
  useEffect(() => {
    if (data.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Detect if this is a data-only update (same structure, same selection, same showAll)
    const isDataOnlyUpdate =
      structureKey === prevStructureKeyRef.current &&
      selectedRule === prevSelectedRuleRef.current &&
      showAll === prevShowAllRef.current &&
      !isFirstRender.current;

    prevStructureKeyRef.current = structureKey;
    prevSelectedRuleRef.current = selectedRule;
    prevShowAllRef.current = showAll;

    // For data-only updates: update node data in-place without re-layout or fitView
    if (isDataOnlyUpdate) {
      const activeNodeSet = activeIndices
        ? new Set(activeIndices.nodeIndices)
        : null;
      setNodes((prev) => {
        let changed = false;
        const next = prev.map((node) => {
          const idx = Number(node.id);
          const freshNode = data.nodes[idx];
          if (!freshNode) return node;
          const dimmed = activeNodeSet ? !activeNodeSet.has(idx) : false;
          const prevData = node.data as unknown as (MergedChainNode & { dimmed?: boolean });
          if (
            prevData.name === freshNode.name &&
            prevData.layer === freshNode.layer &&
            prevData.nodeType === freshNode.nodeType &&
            prevData.totalUpload === freshNode.totalUpload &&
            prevData.totalDownload === freshNode.totalDownload &&
            prevData.totalConnections === freshNode.totalConnections &&
            prevData._zeroTraffic === !!freshNode._zeroTraffic &&
            prevData.dimmed === dimmed &&
            areStringArraysEqual(prevData.rules, freshNode.rules)
          ) {
            return node;
          }
          changed = true;
          return {
            ...node,
            data: {
              ...freshNode,
              dimmed,
              _zeroTraffic: !!freshNode._zeroTraffic,
            },
          };
        });
        return changed ? next : prev;
      });
      return;
    }

    const activeNodeSet = activeIndices
      ? new Set(activeIndices.nodeIndices)
      : null;

    // Group nodes by layer, sort by traffic within each layer
    const layerGroups = new Map<number, number[]>();
    data.nodes.forEach((node, idx) => {
      if (!layerGroups.has(node.layer)) layerGroups.set(node.layer, []);
      layerGroups.get(node.layer)!.push(idx);
    });

    // Identify direct links (rule -> proxy/direct without intermediate groups)
    // These will be placed at the edges to avoid overlapping with complex chains
    const directLinkNodeIndices = new Set<number>();
    // Track which direct links are DIRECT policy (special, goes to bottom)
    const directIsDirectPolicy = new Set<number>();
    for (const link of data.links) {
      const sourceNode = data.nodes[link.source];
      const targetNode = data.nodes[link.target];
      // Direct link: source is rule, target is proxy/direct (no groups in between)
      if (sourceNode?.nodeType === "rule" && 
          (targetNode?.nodeType === "proxy" || targetNode?.nodeType === "direct")) {
        directLinkNodeIndices.add(link.source);
        directLinkNodeIndices.add(link.target);
        // Check if this is a DIRECT policy link (target is DIRECT)
        if (targetNode?.name === 'DIRECT' || targetNode?.nodeType === 'direct') {
          directIsDirectPolicy.add(link.source);
          directIsDirectPolicy.add(link.target);
        }
      }
    }

    // Sort order: rule direct (top) -> normal (middle) -> DIRECT (bottom)
    function getNodeSortPriority(idx: number): number {
      const isDirectLink = directLinkNodeIndices.has(idx);
      const isDirectPolicy = directIsDirectPolicy.has(idx);
      if (isDirectPolicy) return 2;      // Bottom: DIRECT special
      if (isDirectLink) return 0;         // Top: rule direct links
      return 1;                           // Middle: normal nodes
    }

    for (const [, indices] of layerGroups) {
      indices.sort((a, b) => {
        const aPriority = getNodeSortPriority(a);
        const bPriority = getNodeSortPriority(b);
        // Different priorities: sort by priority
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        // Within same category, sort by traffic
        const at = data.nodes[a].totalUpload + data.nodes[a].totalDownload;
        const bt = data.nodes[b].totalUpload + data.nodes[b].totalDownload;
        return bt - at;
      });
    }

    // ----- Position computation -----
    const positions = new Map<number, { x: number; y: number }>();

    if (activeNodeSet && !showAll) {
      // FOCUSED MODE: selected chain nodes centered, fanned out per layer
      // Group active nodes by layer (handles multiple proxies in same layer)
      const activeByLayer = new Map<number, number[]>();
      for (const nodeIdx of activeIndices!.nodeIndices) {
        const layer = data.nodes[nodeIdx].layer;
        if (!activeByLayer.has(layer)) activeByLayer.set(layer, []);
        activeByLayer.get(layer)!.push(nodeIdx);
      }

      // Position active nodes: single → y=0, multiple → fanned vertically around y=0
      for (const [layer, indices] of activeByLayer) {
        indices.sort((a, b) => {
          // In focused mode: rule direct (top) -> normal (middle) -> DIRECT (bottom)
          const aPriority = getNodeSortPriority(a);
          const bPriority = getNodeSortPriority(b);
          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }
          const at = data.nodes[a].totalUpload + data.nodes[a].totalDownload;
          const bt = data.nodes[b].totalUpload + data.nodes[b].totalDownload;
          return bt - at;
        });
        const count = indices.length;
        const totalHeight = count * NODE_HEIGHT;
        indices.forEach((nodeIdx, posInLayer) => {
          positions.set(nodeIdx, {
            x: layer * COLUMN_WIDTH,
            y: posInLayer * NODE_HEIGHT - totalHeight / 2 + NODE_HEIGHT / 2,
          });
        });
      }

      // Non-active nodes below: offset from the lowest active node
      let maxActiveY = 0;
      for (const pos of positions.values()) {
        maxActiveY = Math.max(maxActiveY, pos.y);
      }
      for (const [layer, indices] of layerGroups) {
        const others = indices.filter((i) => !activeNodeSet.has(i));
        others.forEach((nodeIdx, posInLayer) => {
          positions.set(nodeIdx, {
            x: layer * COLUMN_WIDTH,
            y: maxActiveY + OTHER_NODES_OFFSET + posInLayer * NODE_HEIGHT,
          });
        });
      }
    } else {
      // SHOW-ALL / no selection: natural column layout, vertically centered
      for (const [layer, indices] of layerGroups) {
        const layerHeight = indices.length * NODE_HEIGHT;
        indices.forEach((nodeIdx, posInLayer) => {
          positions.set(nodeIdx, {
            x: layer * COLUMN_WIDTH,
            y: posInLayer * NODE_HEIGHT - layerHeight / 2,
          });
        });
      }
    }

    // ----- Build flow nodes -----
    const flowNodes: Node[] = data.nodes.map((node, idx) => ({
      id: String(idx),
      type: "mergedChainNode",
      position: positions.get(idx) || { x: 0, y: 0 },
      data: {
        ...node,
        dimmed: activeNodeSet ? !activeNodeSet.has(idx) : false,
        _zeroTraffic: !!node._zeroTraffic,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));

    // ----- Build flow edges -----
    const activeLinkSet = activeIndices
      ? new Set(activeIndices.linkIndices)
      : null;
    const flowEdges: Edge[] = data.links.map((link, idx) => {
      const targetNode = data.nodes[link.target];
      const sourceNode = data.nodes[link.source];
      const isToProxy = targetNode?.nodeType === "proxy";
      const isToDirect = targetNode?.nodeType === "direct";
      const isDimmed = activeLinkSet ? !activeLinkSet.has(idx) : false;
      const isZeroTraffic = !!(
        sourceNode?._zeroTraffic || targetNode?._zeroTraffic
      );
      return {
        id: `e-${link.source}-${link.target}`,
        source: String(link.source),
        target: String(link.target),
        type: "mergedAnimatedFlow",
        data: {
          isToProxy,
          isToDirect,
          dimmed: isDimmed,
          showAll,
          _zeroTraffic: isZeroTraffic,
        },
      };
    });

    setNodes(flowNodes);
    setEdges(flowEdges);

    // ----- Animate viewport -----
    const duration = isFirstRender.current ? 0 : 400;
    isFirstRender.current = false;

    const doFitView = () => {
      if (showAll || !activeIndices) {
        fitView({ duration, padding: 0.15 });
      } else {
        fitView({
          nodes: activeIndices.nodeIndices.map((i) => ({
            id: String(i),
          })),
          duration,
          padding: 0.15,
        });
      }
    };

    // If ReactFlow hasn't initialized yet, defer fitView to onInit callback
    if (!reactFlowReady.current) {
      pendingFitViewRef.current = doFitView;
      return;
    }

    // Use double rAF to ensure container resize + React commit + ReactFlow
    // internal ResizeObserver have all completed before computing the viewport.
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        doFitView();
      });
    });

    return () => {
      cancelled = true;
    };
  }, [data, activeIndices, showAll, structureKey, setNodes, setEdges, fitView]);

  // Called when ReactFlow instance is ready — execute any pending fitView
  const handleInit = useCallback(() => {
    reactFlowReady.current = true;
    if (pendingFitViewRef.current) {
      const pending = pendingFitViewRef.current;
      pendingFitViewRef.current = null;
      // Still use rAF to let the first paint with nodes complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pending();
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!reactFlowReady.current) return;

    const doFitView = () => {
      if (showAll || !activeIndices) {
        fitView({ duration: 300, padding: 0.15 });
      } else {
        fitView({
          nodes: activeIndices.nodeIndices.map((i) => ({ id: String(i) })),
          duration: 300,
          padding: 0.15,
        });
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        doFitView();
      });
    });
  }, [isFullscreen, showAll, activeIndices, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={handleInit}
      colorMode={isDark ? "dark" : "light"}
      attributionPosition="bottom-right"
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      zoomOnScroll={true}
      panOnScroll={false}
      zoomOnDoubleClick={true}
      className="chain-flow-graph">
      <Background color={isDark ? "#374151" : "#e5e7eb"} gap={20} size={1} />
      <Controls showInteractive={false} showFitView={false}>
        <ControlButton
          onClick={onToggleFullscreen}
          title={isFullscreen ? t("exitFullscreen") : t("fullscreen")}>
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </ControlButton>
      </Controls>
    </ReactFlow>
  );
}

const MemoizedFlowRenderer = memo(FlowRenderer);

// ---------- Main component ----------

function UnifiedRuleChainFlowInner({
  selectedRule,
  activeBackendId,
  timeRange,
  autoRefresh = true,
  visibleRuleNames,
}: UnifiedRuleChainFlowProps) {
  const t = useTranslations("rules");
  // Round timeRange to the minute so WS/HTTP only re-fires on minute boundaries
  const stableRange = useStableTimeRange(timeRange, { roundToMinute: true });
  const [data, setData] = useState<AllChainFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [activePolicyOnly, setActivePolicyOnly] = useState(false);
  const prevRuleRef = useRef(selectedRule);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const prevBackendRef = useRef<number | undefined>(undefined);
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Throttle data commits to avoid flooding ReactFlow with updates every ~1s.
  // The first commit is immediate (initial load), subsequent ones are spaced ≥5s apart.
  const COMMIT_THROTTLE_MS = 5000;
  const lastCommitTimeRef = useRef(0);
  const pendingDataRef = useRef<AllChainFlowData | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doCommit = useCallback((next: AllChainFlowData) => {
    const normalized = normalizeChainFlowData(next);
    setData((prev) => {
      if (prev && areChainFlowDataEqual(prev, normalized)) {
        return prev;
      }
      return normalized;
    });
    hasLoadedRef.current = true;
    prevBackendRef.current = activeBackendId;
    setError(null);
    setLoading(false);
  }, [activeBackendId]);

  const commitChainFlowData = useCallback((next: AllChainFlowData) => {
    const now = Date.now();
    const elapsed = now - lastCommitTimeRef.current;

    if (elapsed >= COMMIT_THROTTLE_MS) {
      // Enough time passed — commit immediately
      lastCommitTimeRef.current = now;
      doCommit(next);
    } else {
      // Store latest data; commit when throttle window expires
      pendingDataRef.current = next;
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          if (pendingDataRef.current) {
            lastCommitTimeRef.current = Date.now();
            doCommit(pendingDataRef.current);
            pendingDataRef.current = null;
          }
        }, COMMIT_THROTTLE_MS - elapsed);
      }
    }
  }, [doCommit]);

  // Clean up throttle timer on unmount
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  const wsEnabled = autoRefresh && !!activeBackendId;
  const { status: wsStatus } = useStatsWebSocket({
    backendId: activeBackendId,
    range: stableRange,
    minPushIntervalMs: RULE_CHAIN_FLOW_WS_MIN_PUSH_MS,
    includeSummary: false,
    includeRuleChainFlow: wsEnabled,
    trackLastMessage: false,
    enabled: wsEnabled,
    onMessage: useCallback((stats: StatsSummary) => {
      if (!stats.ruleChainFlowAll) return;
      commitChainFlowData(stats.ruleChainFlowAll);
    }, [commitChainFlowData]),
  });

  const useHttpFallback = !wsEnabled || wsStatus !== "connected";

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    const target = flowContainerRef.current;
    if (!target) return;

    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element | null;
    };
    const element = target as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    const fullscreenElement =
      doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

    try {
      if (fullscreenElement) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        return;
      }
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      }
    } catch (err) {
      console.error("Failed to toggle fullscreen:", err);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const fullscreenElement =
        doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setIsFullscreen(fullscreenElement === flowContainerRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange as EventListener,
      );
    };
  }, []);

  // HTTP fallback only when websocket is disabled or not connected.
  useEffect(() => {
    if (!useHttpFallback) {
      return;
    }

    let cancelled = false;
    const requestId = ++requestIdRef.current;
    const backendChanged = prevBackendRef.current !== activeBackendId;
    const shouldShowLoading = !hasLoadedRef.current || backendChanged;
    if (shouldShowLoading) {
      setLoading(true);
    }
    setError(null);

    async function loadFlows() {
      try {
        const result = await api.getAllRuleChainFlows(activeBackendId, stableRange);
        if (cancelled || requestId !== requestIdRef.current) return;
        commitChainFlowData(result);
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return;
        console.error("Failed to load chain flows:", err);
        if (!hasLoadedRef.current) {
          setError("Failed to load chain flows");
        }
      } finally {
        if (shouldShowLoading && !cancelled && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }

    loadFlows();

    return () => {
      cancelled = true;
    };
  }, [activeBackendId, stableRange, useHttpFallback, commitChainFlowData, retryNonce]);

  useEffect(() => {
    if (!wsEnabled) {
      return;
    }
    const backendChanged = prevBackendRef.current !== activeBackendId;
    if (backendChanged) {
      setLoading(true);
      setError(null);
    }
  }, [activeBackendId, wsEnabled]);

  // Use React Query to fetch active chain info with caching
  const { data: gatewayProviders } = useGatewayProviders({ 
    activeBackendId, 
    enabled: !!activeBackendId 
  });
  const { data: gatewayProxies } = useGatewayProxies({ 
    activeBackendId, 
    enabled: !!activeBackendId 
  });
  const { data: gatewayRules } = useGatewayRules({ 
    activeBackendId, 
    enabled: !!activeBackendId 
  });

  // Compute active chain info from cached data
  const activeChainInfo: ActiveChainInfo | null = useMemo(() => {
    if (!gatewayProviders || !gatewayRules) return null;
    try {
      return resolveActiveChains(gatewayProviders, gatewayRules, gatewayProxies || undefined);
    } catch (e) {
      console.error('[ChainFlow] resolveActiveChains error:', e);
      return null;
    }
  }, [gatewayProviders, gatewayRules, gatewayProxies, activeBackendId]);

  // When user selects a different rule, auto-disable showAll
  useEffect(() => {
    if (selectedRule && selectedRule !== prevRuleRef.current) {
      prevRuleRef.current = selectedRule;
      setShowAll(false);
    }
  }, [selectedRule]);

  // Filter/Merge DAG
  const filteredData = useMemo((): AllChainFlowData | null => {
    if (!data) return null;
    // If activeChainInfo is not loaded yet and we're not showing all policies,
    // we need to wait for it to properly filter the data.
    // Return empty data to show loading state instead of unfiltered data.
    // The merged view has no single gateway to resolve active chains from, so
    // it shows the full graph instead of waiting.
    if (!activeChainInfo && !activePolicyOnly && !isMergedBackendId(activeBackendId)) {
      return { nodes: [], links: [], rulePaths: {}, maxLayer: 0 };
    }
    if (!activeChainInfo) return data;

    const { activeNodeNames, activeLinkKeys, activeChains } = activeChainInfo;

    // Build name→index map of existing nodes
    const existingNodeMap = new Map<string, number>();
    data.nodes.forEach((n, i) => existingNodeMap.set(n.name, i));

    // Determine which existing nodes to keep
    const keepNodeIndices = new Set<number>();
    
    // Helper to check if a node has traffic
    const nodeHasTraffic = (node: MergedChainNode) => 
      node.totalUpload > 0 || node.totalDownload > 0 || node.totalConnections > 0;

    // Build a normalized map of rulePaths to handle potential whitespace mismatches
    // (e.g. Surge rules might have leading/trailing spaces in API vs UI)
    const normalizedRulePaths = new Map<string, { nodeIndices: number[]; linkIndices: number[] }>();
    for (const [key, value] of Object.entries(data.rulePaths)) {
      normalizedRulePaths.set(key.trim(), value);
    }

    data.nodes.forEach((node, idx) => {
      // 1. If "All Policies" is checked, keep everything
      if (activePolicyOnly) {
        keepNodeIndices.add(idx);
        return;
      }
      
      // 2. If a specific rule is selected, always keep nodes in its path
      // Use normalized lookup
      if (selectedRule) {
        // Try exact match first
        const exactMatch = normalizedRulePaths.get(selectedRule);
        if (exactMatch?.nodeIndices.includes(idx)) {
          keepNodeIndices.add(idx);
          return;
        }
        // Try emoji-normalized match (e.g., "GitHub" matches "👨‍💻 GitHub")
        for (const [key, value] of normalizedRulePaths.entries()) {
          if (key.includes(selectedRule) || selectedRule.includes(key)) {
            if (value.nodeIndices.includes(idx)) {
              keepNodeIndices.add(idx);
              return;
            }
          }
        }
      }
      
      // 3. Otherwise, only keep nodes with active traffic or relevant to active chains
      if (activeChains.size > 0 && (nodeHasTraffic(node) || activeNodeNames.has(node.name))) {
         if (nodeHasTraffic(node)) {
             keepNodeIndices.add(idx);
         }
      }
    });

    // Build new nodes array (existing kept + zero-traffic for missing active)
    const newNodes: MergedChainNode[] = [];
    const nameToNewIdx = new Map<string, number>();

    // First: existing kept nodes
    for (const idx of keepNodeIndices) {
      const node = data.nodes[idx];
      nameToNewIdx.set(node.name, newNodes.length);
      // Convert DIRECT nodes to "direct" type for special rendering and positioning
      const isDirect = node.name === 'DIRECT';
      newNodes.push({
        ...node,
        nodeType: isDirect ? "direct" : node.nodeType,
      });
    }

    // Second: add zero-traffic nodes for active chain members not in existing data
    // If "All Policies" is ON, we inject nodes for ALL chains.
    // If a whitelist (visibleRuleNames) is provided, we only show those.
    // Otherwise, we only inject for the currently selected rule.
    const chainsToInject = new Set<string>();
    if (activePolicyOnly) {
      if (visibleRuleNames && visibleRuleNames.size > 0) {
        // Only inject chains that are in the user's rule list
        for (const ruleName of visibleRuleNames) {
           if (activeChains.has(ruleName)) {
             chainsToInject.add(ruleName);
           }
        }
      } else {
        // Fallback: inject everything
        for (const ruleName of activeChains.keys()) {
          chainsToInject.add(ruleName);
        }
      }
    } else if (selectedRule && activeChains.has(selectedRule)) {
      chainsToInject.add(selectedRule);
    }

    for (const ruleName of chainsToInject) {
      const chain = activeChains.get(ruleName);
      if (!chain) continue;
      
      for (let i = 0; i < chain.length; i++) {
        const name = chain[i];
        if (!nameToNewIdx.has(name)) {
          // Special built-in policies: DIRECT is treated as exit node (like proxy), REJECT is group
          const isDirect = name === 'DIRECT';
          const isReject = name === 'REJECT' || name === 'REJECT-TINY';
          const isLastNode = i === chain.length - 1;
          const nodeType: "rule" | "group" | "proxy" | "direct" =
            i === 0 ? "rule" : isDirect ? "direct" : (isLastNode && !isReject) ? "proxy" : "group";
          nameToNewIdx.set(name, newNodes.length);
          newNodes.push({
            name,
            layer: i,
            nodeType,
            totalUpload: 0,
            totalDownload: 0,
            totalConnections: 0,
            rules: [],
            _zeroTraffic: true,
          });
        }
      }
    }

    // Build new links
    const newLinks: Array<{ source: number; target: number; rules: string[] }> =
      [];
    const linkKeySet = new Set<string>();

    // Existing links from data (filtered if needed)
    data.links.forEach((link, idx) => {
      const srcNode = data.nodes[link.source];
      const tgtNode = data.nodes[link.target];
      if (!srcNode || !tgtNode) return;
      
      const newSrc = nameToNewIdx.get(srcNode.name);
      const newTgt = nameToNewIdx.get(tgtNode.name);
      
      // Both endpoints must be in our kept nodes
      if (newSrc !== undefined && newTgt !== undefined) {
        // Keep link if "All Policies" OR if it's a Rule->Group link OR generally if endpoints are kept
        const isRuleLink = srcNode.nodeType === 'rule';

        // Check if the server-side analysis knows this link for the selected rule
        // This is crucial for Surge backend where client-side chain resolution might miss some links
        // Use normalized lookup here too
        let isServerKnownLink = false;
        if (selectedRule) {
          // Try exact match first
          isServerKnownLink = normalizedRulePaths.get(selectedRule)?.linkIndices?.includes(idx) ?? false;
          // Try fuzzy match
          if (!isServerKnownLink) {
            for (const [key, value] of normalizedRulePaths.entries()) {
              if (key.includes(selectedRule) || selectedRule.includes(key)) {
                if (value.linkIndices?.includes(idx)) {
                  isServerKnownLink = true;
                  break;
                }
              }
            }
          }
        }
        
        const shouldKeepLink = 
             activePolicyOnly || 
             isRuleLink || 
             isServerKnownLink ||
             activeLinkKeys.has(encodeActiveLinkKey(srcNode.name, tgtNode.name));

        if (shouldKeepLink) {
             const key = `${newSrc}-${newTgt}`;
             if (!linkKeySet.has(key)) {
               linkKeySet.add(key);
               newLinks.push({
                 source: newSrc,
                 target: newTgt,
                 rules: link.rules,
               });
             }
        }
      }
    });

    // Zero-traffic links for active chains not yet covered
    for (const ruleName of chainsToInject) {
      const chain = activeChains.get(ruleName);
      if (!chain) continue;

      for (let i = 0; i < chain.length - 1; i++) {
        const srcIdx = nameToNewIdx.get(chain[i]);
        const tgtIdx = nameToNewIdx.get(chain[i + 1]);
        if (srcIdx !== undefined && tgtIdx !== undefined) {
          const key = `${srcIdx}-${tgtIdx}`;
          if (!linkKeySet.has(key)) {
            linkKeySet.add(key);
            newLinks.push({ source: srcIdx, target: tgtIdx, rules: [] });
          }
        }
      }
    }

    // Rebuild rulePaths for the filtered data
    const newRulePaths: Record<
      string,
      { nodeIndices: number[]; linkIndices: number[] }
    > = {};
    
    // We try to rebuild paths for all active chains that have nodes present
    for (const [ruleName, chain] of activeChains) {
      const nodeIndices: number[] = [];
      const linkIndices: number[] = [];
      
      // Nodes
      for (const name of chain) {
        const idx = nameToNewIdx.get(name);
        if (idx !== undefined) nodeIndices.push(idx);
      }
      
      // Links
      for (let i = 0; i < chain.length - 1; i++) {
        const srcIdx = nameToNewIdx.get(chain[i]);
        const tgtIdx = nameToNewIdx.get(chain[i + 1]);
        if (srcIdx !== undefined && tgtIdx !== undefined) {
           // Locate link in newLinks
           const linkIdx = newLinks.findIndex(l => l.source === srcIdx && l.target === tgtIdx);
           if (linkIdx !== -1) linkIndices.push(linkIdx);
        }
      }
      
      if (nodeIndices.length > 0) {
        newRulePaths[ruleName] = { nodeIndices, linkIndices };
      }
    }

    // Also add selectedRule's path if it exists in original data but not in activeChains
    // OR if the existing path is incomplete (single node) but original has full chain
    // This ensures FlowRenderer can get activeIndices for the selected rule
    const existingSelectedPath = selectedRule ? newRulePaths[selectedRule] : null;
    const originalPath = selectedRule ? data.rulePaths[selectedRule] : null;
    const needsFullPath = selectedRule && originalPath && 
      (!existingSelectedPath || existingSelectedPath.nodeIndices.length < originalPath.nodeIndices.length);
    
    if (needsFullPath) {
      const nodeIndices: number[] = [];
      const linkIndices: number[] = [];
      
      // Map original indices to new indices
      for (const oldIdx of originalPath.nodeIndices) {
        const nodeName = data.nodes[oldIdx]?.name;
        if (nodeName) {
          const newIdx = nameToNewIdx.get(nodeName);
          if (newIdx !== undefined) nodeIndices.push(newIdx);
        }
      }
      
      // Map original link indices to new links
      for (const oldLinkIdx of originalPath.linkIndices) {
        const oldLink = data.links[oldLinkIdx];
        if (oldLink) {
          const sourceName = data.nodes[oldLink.source]?.name;
          const targetName = data.nodes[oldLink.target]?.name;
          if (sourceName && targetName) {
            const newSrcIdx = nameToNewIdx.get(sourceName);
            const newTgtIdx = nameToNewIdx.get(targetName);
            if (newSrcIdx !== undefined && newTgtIdx !== undefined) {
              const linkIdx = newLinks.findIndex(l => l.source === newSrcIdx && l.target === newTgtIdx);
              if (linkIdx !== -1) linkIndices.push(linkIdx);
            }
          }
        }
      }
      
      if (nodeIndices.length > 0) {
        newRulePaths[selectedRule] = { nodeIndices, linkIndices };
      }
    }

    // Compute maxLayer
    // const maxLayer = newNodes.reduce((max, n) => Math.max(max, n.layer), 0);

    // [New Logic]
    // To align usage with user request: "Right-align all PROXY nodes".
    // 1. Find the deepest layer among all nodes (or specifically rule/group nodes which define the structure).
    let maxLayer = 0;
    for (const n of newNodes) {
        if (n.layer > maxLayer) maxLayer = n.layer;
    }
    // Ensure minimum depth to separate Rule -> Proxy
    if (maxLayer < 2) maxLayer = 2; // At least Rule(0) -> Gap(1) -> Proxy(2)

    // 2. Force all "proxy" and "direct" nodes to be at maxLayer (exit nodes on the rightmost column)
    for (const n of newNodes) {
        if (n.nodeType === 'proxy' || n.nodeType === 'direct') {
            n.layer = maxLayer;
        }
    }

    return {
      nodes: newNodes,
      links: newLinks,
      rulePaths: newRulePaths,
      maxLayer,
    };
  }, [data, activePolicyOnly, activeChainInfo, selectedRule, visibleRuleNames, activeBackendId]);

  const renderData = filteredData;

  // Container height: compact for focused mode, taller for show-all
  const containerHeight = useMemo(() => {
    if (!renderData || renderData.nodes.length === 0) return 280;

    if (!showAll && selectedRule && renderData.rulePaths[selectedRule]) {
      // Focused mode: just enough for the active chain
      const activeNodes = renderData.rulePaths[selectedRule].nodeIndices;
      const layerCounts = new Map<number, number>();
      for (const idx of activeNodes) {
        const layer = renderData.nodes[idx].layer;
        layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
      }
      const maxActiveInLayer =
        layerCounts.size > 0 ? Math.max(...layerCounts.values()) : 1;
      return Math.max(200, maxActiveInLayer * NODE_HEIGHT + 100);
    }

    // Show-all mode: full height based on densest layer
    const layerCounts = new Map<number, number>();
    renderData.nodes.forEach((node) => {
      layerCounts.set(node.layer, (layerCounts.get(node.layer) || 0) + 1);
    });
    const maxNodesInLayer = Math.max(...layerCounts.values());
    return Math.min(600, Math.max(300, maxNodesInLayer * 90 + 60));
  }, [renderData, showAll, selectedRule]);

  if (loading) {
    return (
      <Card className="mb-4">
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t("loadingChainFlow")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mb-4">
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-3">
            <span className="text-sm text-muted-foreground">{t("chainFlowError")}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs rounded-full"
              onClick={() => {
                setError(null);
                setLoading(true);
                setRetryNonce((n) => n + 1);
              }}>
              {t("chainFlowRetry")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!renderData || renderData.nodes.length <= 1) {
    return null;
  }

  return (
      <Card className="mb-4 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
            <Workflow className="h-4 w-4 text-primary shrink-0" />
            <span className="leading-tight">{t("chainFlow")}</span>
          </CardTitle>
          <div className="flex w-full sm:w-auto items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 px-3 text-xs gap-1.5 rounded-full transition-colors",
                activePolicyOnly
                  ? "border-emerald-500 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 dark:border-emerald-500/50"
                  : "hover:border-emerald-300 hover:text-emerald-600",
              )}
              onClick={() => setActivePolicyOnly(!activePolicyOnly)}>
              <Activity className={cn("h-3.5 w-3.5", activePolicyOnly && "text-emerald-500")} />
              {t("activePolicy")}
            </Button>
            <Button
              variant={showAll ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 px-3 text-xs gap-1.5 rounded-full",
                showAll && "bg-primary/90 hover:bg-primary",
              )}
              onClick={() => setShowAll(!showAll)}>
              <Eye className="h-3.5 w-3.5" />
              {t("showAll")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          ref={flowContainerRef}
          style={{ height: isFullscreen ? "100vh" : containerHeight }}
          className={cn("relative w-full", isFullscreen && "bg-background")}>
          {isFullscreen && (
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5 rounded-full transition-colors bg-background/85 backdrop-blur",
                  activePolicyOnly
                    ? "border-emerald-500 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 dark:border-emerald-500/50"
                    : "hover:border-emerald-300 hover:text-emerald-600",
                )}
                onClick={() => setActivePolicyOnly(!activePolicyOnly)}>
                <Activity
                  className={cn("h-3.5 w-3.5", activePolicyOnly && "text-emerald-500")}
                />
                {t("activePolicy")}
              </Button>
              <Button
                variant={showAll ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5 rounded-full bg-background/85 backdrop-blur",
                  showAll && "bg-primary/90 hover:bg-primary",
                )}
                onClick={() => setShowAll(!showAll)}>
                <Eye className="h-3.5 w-3.5" />
                {t("showAll")}
              </Button>
            </div>
          )}
          <ReactFlowProvider>
            <MemoizedFlowRenderer
              data={renderData}
              selectedRule={showAll ? null : selectedRule}
              showAll={showAll}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          </ReactFlowProvider>
        </div>
      </CardContent>
    </Card>
  );
}

export const UnifiedRuleChainFlow = memo(
  UnifiedRuleChainFlowInner,
  (prev, next) =>
    prev.selectedRule === next.selectedRule &&
    prev.activeBackendId === next.activeBackendId &&
    prev.autoRefresh === next.autoRefresh &&
    prev.timeRange?.start === next.timeRange?.start &&
    prev.timeRange?.end === next.timeRange?.end &&
    prev.visibleRuleNames === next.visibleRuleNames,
);

// Backward-compatible alias
export { UnifiedRuleChainFlow as RuleChainFlow };
