import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { gb } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { Progress } from "@/components/ui/progress";
import { Sparkline } from "@/components/ui/sparkline";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { RowSkeletons, WidgetCard } from "./shared";

/** CPU, GPU and memory with temps, plus disk headroom. */
export type SystemWidget = { id: string; type: "system" };

/** ~2 minutes of history at the 3s poll rate. */
const HISTORY_CAP = 40;
const push = (prev: number[], value: number) => [...prev, value].slice(-HISTORY_CAP);

type SystemHistory = { cpu: number[]; gpu: number[]; ram: number[] };

function SystemBody({ active }: BarBodyProps<SystemWidget>) {
  const { data } = usePolled(() => ipc.systemStats(), [], 8000, active, "system");
  const [history, setHistory] = useState<SystemHistory>({ cpu: [], gpu: [], ram: [] });

  useEffect(() => {
    if (!data) return;
    setHistory((prev) => ({
      cpu: push(prev.cpu, data.cpuUsage),
      gpu: data.gpu ? push(prev.gpu, data.gpu.usage) : prev.gpu,
      ram: push(prev.ram, (data.memUsed / data.memTotal) * 100),
    }));
  }, [data]);

  if (!data) {
    return (
      <WidgetCard>
        <RowSkeletons count={3} className="rounded-md" />
      </WidgetCard>
    );
  }

  return (
    <WidgetCard>
      <GraphRow
        name="CPU"
        values={history.cpu}
        detail={`${Math.round(data.cpuUsage)}%`}
        tempC={data.cpuTempC}
      />
      {data.gpu && (
        <GraphRow
          name="GPU"
          values={history.gpu}
          detail={`${Math.round(data.gpu.usage)}%`}
          tempC={data.gpu.tempC}
        />
      )}
      <GraphRow
        name="RAM"
        values={history.ram}
        detail={`${gb(data.memUsed).toFixed(1)} / ${gb(data.memTotal).toFixed(1)} GB`}
      />
      {data.disks.map((disk) => (
        <DiskRow key={disk.mount} disk={disk} />
      ))}
    </WidgetCard>
  );
}

/** Disks barely move between polls; a plain fill bar reads better than a graph. */
function DiskRow({
  disk,
}: {
  disk: { name: string; mount: string; total: number; available: number };
}) {
  const used = disk.total - disk.available;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-ink-300">
          Disk {disk.mount.replace(/[\\/]+$/, "")}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-ink-400">
          {gb(disk.available).toFixed(1)} GB free
        </span>
      </div>
      <Progress value={used / disk.total} />
    </div>
  );
}

function GraphRow({
  name,
  values,
  detail,
  tempC,
}: {
  name: string;
  values: number[];
  detail: string;
  tempC?: number | null;
}) {
  const hot = tempC !== null && tempC !== undefined && tempC >= 85;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-ink-300">{name}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-400">
          {detail}
          {tempC !== null && tempC !== undefined && (
            <span className={hot ? "text-signal-400" : undefined}> · {Math.round(tempC)}°C</span>
          )}
        </span>
      </div>
      <Sparkline values={values} capacity={HISTORY_CAP} />
    </div>
  );
}

export default defineBarWidget<SystemWidget>({
  type: "system",
  icon: Cpu,
  creator: VICTOR_CHANET,
  shop: {
    name: "System monitor",
    tagline: "CPU, GPU and memory with temps, plus disk headroom.",
    description:
      "Sparklines for CPU, GPU and memory with temperatures, and how much disk " +
      "is left for the next build. Handy when the editor, the browser and a " +
      "bake are fighting over the same box.",
    category: "tools",
    tags: ["cpu", "gpu", "ram", "memory", "temps", "disk", "sensors"],
    facts: [
      { label: "Source", value: "Local sensors" },
      { label: "Refresh", value: "Every 3 s" },
    ],
    repeatable: false,
  },
  create: (base) => ({ ...base, type: "system" }),
  title: () => "System",
  Body: SystemBody,
  preview: { id: "preview-system", type: "system" },
});
