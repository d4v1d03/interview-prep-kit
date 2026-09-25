"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reconcile } from "@/kit/edit";
import { validateKit, type Kit } from "@/kit/schema";
import { apiFetch, ApiClientError } from "@/lib/api-client";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict" | "invalid";

const SAVE_DELAY_MS = 800;

/**
 * The kit as the builder sees it. Edits apply to local state immediately (no
 * round trip per keystroke) and are saved in the background, debounced. Each
 * save carries the version it was based on; if the server has a newer version
 * the save is refused and the user is told, instead of either copy silently
 * winning. `flush()` saves anything pending right away — called before a
 * regeneration starts, so the server regenerates against the user's latest edits.
 */
export function useKitDocument(kitId: string, initial: Kit, initialVersion: number) {
  const [kit, setKit] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<Kit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  // Debounced saves call the latest flush through this ref (flush cannot schedule itself directly).
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const saveSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    while (inflight.current) await inflight.current;
    const body = pending.current;
    if (!body) return true;
    // Same validation the server runs: an empty question is reported here, not sent and refused.
    const check = validateKit(body);
    if (!check.ok) {
      setStatus("invalid");
      setProblem(`${check.issues[0].path}: ${check.issues[0].message}`);
      return false;
    }
    setProblem(null);
    pending.current = null;
    setStatus("saving");

    let ok = true;
    inflight.current = (async () => {
      try {
        const res = await apiFetch<{ version: number }>(`/api/kits/${kitId}`, {
          method: "PATCH",
          body: JSON.stringify({ version: version.current, kit: body }),
        });
        version.current = res.version;
        setStatus(pending.current ? "unsaved" : "saved");
      } catch (err) {
        ok = false;
        pending.current ??= body; // keep the user's work queued
        if (err instanceof ApiClientError && err.code === "VERSION_CONFLICT") setStatus("conflict");
        else setStatus("error");
      }
    })();
    await inflight.current;
    inflight.current = null;
    if (ok && pending.current) saveSoon();
    return ok;
  }, [kitId, saveSoon]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const update = useCallback(
    (change: (kit: Kit) => Kit) => {
      setKit((prev) => {
        const next = reconcile(change(prev));
        pending.current = next;
        return next;
      });
      setStatus("unsaved");
      saveSoon();
    },
    [saveSoon],
  );

  /** Replaces local state with the server's latest copy (after a regeneration, or to resolve a conflict). */
  const reload = useCallback(async () => {
    const res = await apiFetch<{ kit: { kit: Kit; version: number } }>(`/api/kits/${kitId}`);
    pending.current = null;
    version.current = res.kit.version;
    setKit(res.kit.kit);
    setStatus("saved");
  }, [kitId]);

  // Warn before leaving with edits that have not reached the server.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  return { kit, status, problem, update, flush, reload };
}
