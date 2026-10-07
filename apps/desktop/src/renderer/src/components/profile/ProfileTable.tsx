import type { JSX } from "react";
import { ProfileRow } from "./ProfileRow";
import type { RunInfo } from "@multizen/types";
import type { TileData } from "./ProfileTile";

interface Props {
  profiles: TileData[];
  /** Live browser instances (run model) — enables per-run close in the UI. */
  runs?: RunInfo[];
  /** Profiles in the terminating phase (winding down, not yet exited). */
  closingIds?: Set<string>;
  onSelect: (id: string) => void;
  onLaunch: (id: string) => Promise<void> | void;
  onNewInstance: (id: string) => Promise<void> | void;
  onCloseRun: (runId: string) => void;
  onStop: (id: string) => Promise<void> | void;
  onExport: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Single source of truth for the table grid. Both header and rows use this
 * exact template — that's the only way to keep them aligned.
 */
export const PROFILE_TABLE_GRID_TEMPLATE =
  "minmax(220px, 1.5fr) 110px minmax(140px, 1fr) 100px minmax(160px, 1fr) 120px";

const COLUMNS: ReadonlyArray<{ label: string; align?: "left" | "right" }> = [
  { label: "Name" },
  { label: "Status" },
  { label: "Tags" },
  { label: "Last opened" },
  { label: "Proxy" },
  { label: "", align: "right" },
];

export function ProfileTable({
  profiles,
  runs,
  closingIds,
  onSelect,
  onLaunch,
  onNewInstance,
  onCloseRun,
  onStop,
  onExport,
  onDuplicate,
  onDelete,
}: Props): JSX.Element {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.035)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)",
      }}
    >
      {/* Header */}
      <div
        role="rowheader"
        className="grid items-center gap-3 px-4 py-2 sticky top-0 z-10"
        style={{
          gridTemplateColumns: PROFILE_TABLE_GRID_TEMPLATE,
          background: "rgba(10,11,15,0.92)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {COLUMNS.map((c, i) => (
          <div
            key={c.label || `col-${i}`}
            className="text-[10px] font-semibold tracking-wider uppercase text-slate-400"
            style={{ textAlign: c.align ?? "left" }}
          >
            {c.label}
          </div>
        ))}
      </div>

      {profiles.map((p) => (
        <ProfileRow
          key={p.id}
          profile={p}
          runs={runs?.filter((r) => r.profileId === p.id)}
          terminating={closingIds?.has(p.id) ?? false}
          onOpen={() => onSelect(p.id)}
          onLaunch={() => onLaunch(p.id)}
          onNewInstance={() => onNewInstance(p.id)}
          onStop={() => onStop(p.id)}
          onExport={() => onExport(p.id)}
          onDuplicate={() => onDuplicate(p.id)}
          onDelete={() => onDelete(p.id)}
        />
      ))}
    </div>
  );
}
