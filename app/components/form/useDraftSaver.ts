import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftView, SaveStep } from "~/shared/schemas/listingForm";
import { ApiError, saveDraftStep, type FieldErrors } from "./api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type StepName = SaveStep["step"];
type StepData<S extends StepName> = Extract<SaveStep, { step: S }>["data"];

const DEBOUNCE_MS = 1200;
const RETRY_MS = 5000;

/**
 * Autosave for the submit wizard (SPEC §7): the latest data per step is saved
 * 1.2 s after the last change (or at once for choices such as the pin), saves
 * run one at a time, a failed save is retried, and `flush()` saves anything
 * pending before the lister changes step or submits.
 */
export function useDraftSaver(initial: DraftView) {
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<StepName, FieldErrors>>>({});
  const pending = useRef(new Map<StepName, SaveStep>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const id = initial.id;

  // Retries go through a ref, so the drain loop does not reference itself.
  const runRef = useRef<() => Promise<void>>(async () => {});

  /** Drains the queue: one loop at a time; changes queued meanwhile are picked up by the same loop. */
  const run = useCallback(async (): Promise<void> => {
    if (running.current) return running.current;
    running.current = (async () => {
      let failed = false;
      while (pending.current.size && !failed) {
        const batch = [...pending.current.values()];
        pending.current.clear();
        setStatus("saving");
        try {
          for (const input of batch) {
            const res = await saveDraftStep(id, input);
            setDraft(res.draft);
            setFieldErrors((prev) => ({ ...prev, [input.step]: res.fieldErrors }));
          }
        } catch (error) {
          failed = true;
          // Put back what failed unless newer data for the step arrived meanwhile; retry later.
          for (const input of batch) if (!pending.current.has(input.step)) pending.current.set(input.step, input);
          setStatus("error");
          if (!(error instanceof ApiError && error.status >= 400 && error.status < 500)) {
            timer.current = setTimeout(() => {
              timer.current = null;
              void runRef.current();
            }, RETRY_MS);
          }
        }
      }
      if (!failed) setStatus("saved");
    })().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [id]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const schedule = useCallback(
    <S extends StepName>(step: S, data: StepData<S>, immediate = false) => {
      // Merge with what is still queued for the step (e.g. a pin drop followed by an address edit).
      const queued = pending.current.get(step);
      const merged = queued ? { ...(queued.data as object), ...(data as object) } : data;
      pending.current.set(step, { step, data: merged } as SaveStep);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (immediate) void run();
      else
        timer.current = setTimeout(() => {
          timer.current = null;
          void run();
        }, DEBOUNCE_MS);
    },
    [run],
  );

  /** Saves anything pending now; resolves when done. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await run();
    // A change queued just as the previous loop was finishing.
    if (pending.current.size) await run();
  }, [run]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size || running.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { draft, setDraft, status, fieldErrors, schedule, flush };
}
