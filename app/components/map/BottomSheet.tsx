import { useRef, type ReactNode } from "react";
import { useT } from "~/i18n/useT";
import { useMapUi, type SheetSnap } from "~/store/mapUiStore";

/** Visible height of each snap point (SPEC §5.1: peek showing the count, half, full). */
const SNAP_HEIGHT: Record<SheetSnap, string> = {
  peek: "4.75rem",
  half: "50%",
  full: "calc(100% - 3.5rem)",
};
const ORDER: SheetSnap[] = ["peek", "half", "full"];

/**
 * Mobile results sheet over the map. Drag the handle (or tap it) to move
 * between snap points; only vertical movement, so nothing mirrors in RTL.
 */
export function BottomSheet({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const t = useT();
  const snap = useMapUi((s) => s.sheet);
  const setSnap = useMapUi((s) => s.setSheet);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);

  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(snap) + dir;
    if (i >= 0 && i < ORDER.length) setSnap(ORDER[i]!);
  };

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-card bg-surface shadow-[0_-8px_24px_rgb(0_0_0/0.25)] transition-[height] duration-200 motion-reduce:transition-none"
      style={{ height: SNAP_HEIGHT[snap] }}
    >
      <button
        type="button"
        aria-label={t("map.sheetHandle")}
        aria-expanded={snap !== "peek"}
        className="flex w-full touch-none flex-col items-center gap-2 px-4 pb-2 pt-2.5"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || Math.abs(e.clientY - d.y) < 40) return;
          step(e.clientY < d.y ? 1 : -1);
          drag.current = { y: e.clientY, moved: true };
        }}
        onPointerUp={() => {
          const moved = drag.current?.moved;
          drag.current = null;
          if (!moved) setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
        }}
      >
        <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-muted/50" />
        {summary}
      </button>
      <div className={`flex min-h-0 flex-1 flex-col ${snap === "peek" ? "invisible" : ""}`}>{children}</div>
    </div>
  );
}
