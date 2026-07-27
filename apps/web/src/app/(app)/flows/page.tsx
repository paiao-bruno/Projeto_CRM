"use client";

import { DragEvent, useMemo, useState } from "react";
import {
  Bot,
  Braces,
  CheckCircle2,
  Copy,
  Database,
  GitBranch,
  GitFork,
  Import,
  MessageSquare,
  MousePointer2,
  Plus,
  Save,
  Search,
  Sparkles,
  Split,
  Target,
  Trash2,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FeatureGate } from "@/components/feature-gate";

type FlowStatus = "Active" | "Inactive";
type BlockType =
  | "Objective"
  | "Trigger"
  | "Condition"
  | "Decision"
  | "Message"
  | "AI Agent"
  | "API Request"
  | "Data Collection"
  | "CRM Action"
  | "End";

type FlowItem = {
  id: string;
  name: string;
  trigger: string;
  status: FlowStatus;
  channel: string;
  agent: string;
  isAiFlow: boolean;
};

type FlowNode = {
  id: string;
  type: BlockType;
  title: string;
  subtitle: string;
  x: number;
  y: number;
};

type FlowConnection = {
  from: string;
  to: string;
};

const blockIcons = {
  Objective: Target,
  Trigger: GitBranch,
  Condition: GitFork,
  Decision: Split,
  Message: MessageSquare,
  "AI Agent": Bot,
  "API Request": Braces,
  "Data Collection": Database,
  "CRM Action": Workflow,
  End: CheckCircle2,
};

const blockPalette: BlockType[] = [
  "Objective",
  "Trigger",
  "Condition",
  "Decision",
  "Message",
  "AI Agent",
  "API Request",
  "Data Collection",
  "CRM Action",
  "End",
];

const initialFlows: FlowItem[] = [
  {
    id: "sgp-ai",
    name: "SGP - Atendimento IA Autônomo",
    trigger: "message_received",
    status: "Active",
    channel: "Internal Chat",
    agent: "Nina Suporte",
    isAiFlow: true,
  },
  {
    id: "lead-fibra",
    name: "Qualificação de Lead Fibra",
    trigger: "new_lead",
    status: "Active",
    channel: "WhatsApp",
    agent: "Leo Vendas",
    isAiFlow: true,
  },
  {
    id: "billing",
    name: "Aviso de fatura em atraso",
    trigger: "invoice_overdue",
    status: "Inactive",
    channel: "Email",
    agent: "Manual",
    isAiFlow: false,
  },
];

const initialNodes: FlowNode[] = [
  { id: "objective", type: "Objective", title: "Objetivo do Agente", subtitle: "Definir resultado esperado", x: 80, y: 170 },
  { id: "collect", type: "Data Collection", title: "Captura de Dados SGP", subtitle: "Coletar contrato e CPF", x: 410, y: 80 },
  { id: "context", type: "API Request", title: "Consulta SGP", subtitle: "Buscar dados do assinante", x: 410, y: 210 },
  { id: "diagnosis", type: "AI Agent", title: "1 - Diagnóstico", subtitle: "Analisar problema do cliente", x: 720, y: 320 },
  { id: "solution", type: "Message", title: "2 - Apresentação de Solução", subtitle: "Enviar orientação automática", x: 720, y: 450 },
  { id: "action", type: "CRM Action", title: "3 - Execução da Ação SGP", subtitle: "Criar ticket ou atualizar lead", x: 720, y: 580 },
  { id: "end", type: "End", title: "Conclusão", subtitle: "Encerrar fluxo", x: 1070, y: 330 },
];

const initialConnections: FlowConnection[] = [
  { from: "objective", to: "collect" },
  { from: "objective", to: "context" },
  { from: "context", to: "diagnosis" },
  { from: "diagnosis", to: "solution" },
  { from: "solution", to: "action" },
  { from: "action", to: "end" },
];

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: typeof Workflow;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-5">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          {hint ? <p className="mt-1 text-xs text-emerald-300">{hint}</p> : null}
        </div>
        <span className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
          <Icon size={22} />
        </span>
      </CardContent>
    </Card>
  );
}

function FlowNodeCard({
  node,
  selected,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  node: FlowNode;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const Icon = blockIcons[node.type];
  return (
    <div
      className={cn(
        "absolute w-64 cursor-grab rounded-2xl border bg-slate-950/95 p-4 shadow-xl transition active:cursor-grabbing",
        selected ? "border-emerald-300 ring-4 ring-emerald-300/10" : "border-slate-700",
      )}
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.setData("node-id", node.id);
      }}
      style={{ left: node.x, top: node.y }}
    >
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{node.type}</p>
          <h3 className="mt-1 font-semibold text-white">{node.title}</h3>
          <p className="mt-1 text-xs text-slate-400">{node.subtitle}</p>
        </div>
      </div>
      {selected ? (
        <div className="mt-4 flex gap-2 border-t border-slate-800 pt-3">
          <Button size="sm" variant="secondary" onClick={(event) => { event.stopPropagation(); onDuplicate(); }}>
            <Copy size={14} />
          </Button>
          <Button size="sm" variant="danger" onClick={(event) => { event.stopPropagation(); onDelete(); }}>
            <Trash2 size={14} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FlowsPageContent() {
  const [flows, setFlows] = useState(initialFlows);
  const [search, setSearch] = useState("");
  const [selectedFlow, setSelectedFlow] = useState<FlowItem | null>(null);
  const [nodes, setNodes] = useState(initialNodes);
  const [connections, setConnections] = useState(initialConnections);
  const [selectedNodeId, setSelectedNodeId] = useState("objective");
  const [zoom, setZoom] = useState(0.85);
  const [autosave, setAutosave] = useState("Saved just now");

  const filteredFlows = useMemo(
    () =>
      flows.filter((flow) =>
        `${flow.name} ${flow.trigger} ${flow.channel} ${flow.agent}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [flows, search],
  );

  const activeFlows = flows.filter((flow) => flow.status === "Active").length;
  const aiFlows = flows.filter((flow) => flow.isAiFlow).length;

  function createFlow() {
    const flow = {
      id: crypto.randomUUID(),
      name: "New Automation Flow",
      trigger: "message_received",
      status: "Inactive" as FlowStatus,
      channel: "WhatsApp",
      agent: "Nina Suporte",
      isAiFlow: true,
    };
    setFlows((current) => [flow, ...current]);
    setSelectedFlow(flow);
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    const nodeId = event.dataTransfer.getData("node-id");
    const blockType = event.dataTransfer.getData("block-type") as BlockType;

    if (nodeId) {
      setNodes((current) =>
        current.map((node) => (node.id === nodeId ? { ...node, x, y } : node)),
      );
      setAutosave("Saved after move");
      return;
    }

    if (blockType) {
      const newNode: FlowNode = {
        id: crypto.randomUUID(),
        type: blockType,
        title: blockType,
        subtitle: "Novo bloco configurável",
        x,
        y,
      };
      setNodes((current) => [...current, newNode]);
      setConnections((current) =>
        selectedNodeId ? [...current, { from: selectedNodeId, to: newNode.id }] : current,
      );
      setSelectedNodeId(newNode.id);
      setAutosave("Saved after adding block");
    }
  }

  function duplicateNode(node: FlowNode) {
    const duplicate = {
      ...node,
      id: crypto.randomUUID(),
      title: `${node.title} copy`,
      x: node.x + 36,
      y: node.y + 36,
    };
    setNodes((current) => [...current, duplicate]);
    setConnections((current) => [...current, { from: node.id, to: duplicate.id }]);
    setSelectedNodeId(duplicate.id);
    setAutosave("Saved after duplication");
  }

  function deleteNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setConnections((current) =>
      current.filter((connection) => connection.from !== nodeId && connection.to !== nodeId),
    );
    setSelectedNodeId("");
    setAutosave("Saved after delete");
  }

  if (selectedFlow) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const selectedNode = nodeById.get(selectedNodeId);
    const validationIssues = nodes.some((node) => node.type === "End")
      ? []
      : ["O fluxo precisa de um bloco End."];

    return (
      <div className="space-y-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <button
              className="mb-2 text-sm text-slate-400 hover:text-white"
              onClick={() => setSelectedFlow(null)}
              type="button"
            >
              ← My flow
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-white">{selectedFlow.name}</h1>
              <Badge variant="green">Primary</Badge>
              <Badge variant={validationIssues.length ? "amber" : "green"}>
                {validationIssues.length ? "Needs review" : "Valid flow"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-400">Flow Builder · {autosave}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary">
              <MousePointer2 size={16} />
              Drag and Drop
            </Button>
            <Button>
              <Save size={16} />
              Save
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[250px_1fr_260px]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Blocos disponíveis</CardTitle>
              <p className="text-sm text-slate-400">Arraste para o canvas.</p>
            </CardHeader>
            <CardContent className="grid gap-2">
              {blockPalette.map((block) => {
                const Icon = blockIcons[block];
                return (
                  <div
                    className="flex cursor-grab items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300 transition hover:border-emerald-400/40 hover:text-white"
                    draggable
                    key={block}
                    onDragStart={(event) => event.dataTransfer.setData("block-type", block)}
                  >
                    <Icon size={16} />
                    {block}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 p-3">
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setZoom((current) => Math.max(0.55, current - 0.1))}>
                  <ZoomOut size={15} />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setZoom((current) => Math.min(1.25, current + 0.1))}>
                  <ZoomIn size={15} />
                </Button>
              </div>
              <span className="text-sm text-slate-400">{Math.round(zoom * 100)}% zoom</span>
            </div>
            <div
              className="relative h-[720px] overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.16)_1px,transparent_0)] [background-size:28px_28px]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onCanvasDrop}
            >
              <div className="relative h-[900px] w-[1400px] origin-top-left" style={{ transform: `scale(${zoom})` }}>
                <svg className="absolute inset-0 h-full w-full">
                  {connections.map((connection) => {
                    const from = nodeById.get(connection.from);
                    const to = nodeById.get(connection.to);
                    if (!from || !to) return null;
                    const startX = from.x + 256;
                    const startY = from.y + 56;
                    const endX = to.x;
                    const endY = to.y + 56;
                    const middle = (startX + endX) / 2;
                    return (
                      <path
                        d={`M ${startX} ${startY} C ${middle} ${startY}, ${middle} ${endY}, ${endX} ${endY}`}
                        fill="none"
                        key={`${connection.from}-${connection.to}`}
                        stroke="#34d399"
                        strokeOpacity="0.55"
                        strokeWidth="3"
                      />
                    );
                  })}
                </svg>
                {nodes.map((node) => (
                  <FlowNodeCard
                    key={node.id}
                    node={node}
                    onDelete={() => deleteNode(node.id)}
                    onDuplicate={() => duplicateNode(node)}
                    onSelect={() => setSelectedNodeId(node.id)}
                    selected={selectedNodeId === node.id}
                  />
                ))}
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Mini mapa</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative h-40 rounded-2xl border border-slate-800 bg-slate-950/70">
                  {nodes.map((node) => (
                    <span
                      className={cn("absolute rounded bg-emerald-300/70", selectedNodeId === node.id && "bg-sky-300")}
                      key={node.id}
                      style={{
                        left: `${Math.min(88, node.x / 14)}%`,
                        top: `${Math.min(82, node.y / 9)}%`,
                        width: 24,
                        height: 14,
                      }}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Validação</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {validationIssues.length ? (
                  validationIssues.map((issue) => (
                    <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200" key={issue}>
                      {issue}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
                    Fluxo válido para publicação.
                  </div>
                )}
                {selectedNode ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
                    <p className="font-semibold text-white">{selectedNode.title}</p>
                    <p className="mt-1 text-slate-400">{selectedNode.subtitle}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-semibold text-white">Flows</h1>
          <p className="mt-1 text-slate-400">Build and manage automation flows.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={createFlow}>
            <Plus size={17} />
            New Flow
          </Button>
          <Button variant="secondary">
            <Import size={17} />
            Import
          </Button>
          <Button variant="secondary">
            <Sparkles size={17} />
            Templates
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={Workflow} title="Total Flows" value={flows.length} hint={`${flows.length} flows`} />
        <MetricCard icon={CheckCircle2} title="Active" value={activeFlows} hint={`${Math.round((activeFlows / flows.length) * 100)}%`} />
        <MetricCard icon={GitFork} title="Inactive" value={flows.length - activeFlows} />
        <MetricCard icon={GitBranch} title="Triggers" value={flows.length} />
        <MetricCard icon={Bot} title="AI Flows" value={aiFlows} />
        <MetricCard icon={Sparkles} title="Automations" value={flows.length + aiFlows} />
      </section>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
        <Input className="pl-10" placeholder="Search Flows" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <Card>
        <CardContent className="space-y-3 pt-5">
          {filteredFlows.map((flow) => (
            <button
              className="flex w-full flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-left transition hover:border-emerald-400/40 lg:flex-row lg:items-center"
              key={flow.id}
              onClick={() => setSelectedFlow(flow)}
              type="button"
            >
              <div className="flex items-center gap-4">
                <span className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
                  <Workflow size={22} />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-white">{flow.name}</h2>
                    <Badge variant={flow.status === "Active" ? "green" : "slate"}>{flow.status}</Badge>
                    {flow.isAiFlow ? <Badge variant="blue">AI Flow</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">Trigger: {flow.trigger}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="amber">{flow.channel}</Badge>
                <Badge variant="slate">{flow.agent}</Badge>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function FlowsPage() {
  return (
    <FeatureGate feature="flows" title="Flows">
      <FlowsPageContent />
    </FeatureGate>
  );
}
