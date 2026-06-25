"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface TourStep {
    /** Matches a `data-tour="…"` attribute on the element to spotlight. */
    target: string;
    title: string;
    body: React.ReactNode;
}

const PAD = 8; // spotlight padding around the target
const CARD_W = 320;

/**
 * Lightweight in-house spotlight tour. Dims the page and cuts a hole over the
 * current step's target (located via `data-tour`), with a tooltip card that
 * walks through the tool's features. No external dependency.
 */
export default function OnboardingTour({ steps, onDismiss }: { steps: TourStep[]; onDismiss: () => void }) {
    const [i, setI] = useState(0);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const step = steps[i];
    const last = i === steps.length - 1;

    const measure = useCallback(() => {
        const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
        setRect(el ? el.getBoundingClientRect() : null);
    }, [step.target]);

    // On step change, scroll the target into view and have the highlight follow
    // its live position every frame until the smooth scroll settles. Tracking the
    // real position (rather than teleporting to an early, mid-scroll measurement)
    // is what stops the box from overshooting on long up/down jumps.
    useEffect(() => {
        let raf = 0;
        let prev: DOMRect | null = null;
        let still = 0;
        let scrolled = false;
        const start = performance.now();
        const tick = () => {
            const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
            const elapsed = performance.now() - start;
            if (!el) {
                setRect(null);
                if (elapsed < 1200) raf = requestAnimationFrame(tick);
                return;
            }
            if (!scrolled) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                scrolled = true;
            }
            const r = el.getBoundingClientRect();
            const settled = prev && Math.abs(r.top - prev.top) < 0.5 && Math.abs(r.left - prev.left) < 0.5;
            if (!settled) setRect(r); // skip re-renders on frames where nothing moved
            still = settled ? still + 1 : 0;
            prev = r;
            // Stop a few frames after motion stops, or after a safety cap.
            if (still < 3 && elapsed < 1200) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [step.target]);

    // Keep the highlight pinned while the user scrolls/resizes, throttled to one
    // measure per frame so a burst of scroll events can't thrash layout reads.
    useEffect(() => {
        let raf = 0;
        const onMove = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; measure(); });
        };
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener("resize", onMove);
            window.removeEventListener("scroll", onMove, true);
        };
    }, [measure]);

    const next = useCallback(() => (last ? onDismiss() : setI((n) => n + 1)), [last, onDismiss]);
    const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onDismiss();
            else if (e.key === "ArrowRight") next();
            else if (e.key === "ArrowLeft") prev();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [next, prev, onDismiss]);

    // Only rendered on the client (the parent flips this on via an effect), but
    // guard against any SSR/portal edge.
    if (typeof document === "undefined") return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Card placement: below the target if there's room, otherwise above; centred
    // when there's no target to anchor to.
    let cardTop: number;
    let cardLeft: number;
    if (rect) {
        const below = rect.bottom + 14;
        const wantAbove = rect.bottom > vh - 220;
        cardTop = wantAbove ? Math.max(12, rect.top - 14 - 200) : below;
        cardLeft = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
    } else {
        cardTop = vh / 2 - 110;
        cardLeft = vw / 2 - CARD_W / 2;
    }

    const overlay = (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
            {/* Spotlight: a transparent box over the target with a huge shadow that
                dims everything else. Falls back to a flat scrim when no target. */}
            {rect ? (
                <div
                    style={{
                        position: "fixed",
                        top: rect.top - PAD,
                        left: rect.left - PAD,
                        width: rect.width + PAD * 2,
                        height: rect.height + PAD * 2,
                        borderRadius: "var(--r-md, 8px)",
                        boxShadow: "0 0 0 9999px rgba(8,10,14,0.72)",
                        border: "1px solid var(--border-brass)",
                        pointerEvents: "none",
                        transition: "top 120ms ease-out, left 120ms ease-out, width 120ms ease-out, height 120ms ease-out",
                    }}
                />
            ) : (
                <div style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.72)" }} />
            )}

            <div
                role="dialog"
                aria-modal="true"
                aria-label="Walkthrough"
                style={{
                    position: "fixed",
                    top: cardTop,
                    left: cardLeft,
                    width: CARD_W,
                    maxWidth: "calc(100vw - 24px)",
                    background: "var(--surface)",
                    border: "1px solid var(--border-brass)",
                    borderRadius: "var(--r-lg)",
                    boxShadow: "0 18px 48px rgba(0,0,0,0.5)",
                    padding: 18,
                    transition: "top 160ms ease-out, left 160ms ease-out",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brass-300)" }}>
                        Step {i + 1} of {steps.length}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={onDismiss} aria-label="Skip walkthrough"
                        style={{ background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2 }}>
                        ×
                    </button>
                </div>
                <div style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 17, letterSpacing: "0.01em", color: "var(--text)", marginBottom: 6 }}>
                    {step.title}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>{step.body}</div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
                    <div style={{ display: "flex", gap: 5 }}>
                        {steps.map((_, n) => (
                            <span key={n} aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: n === i ? "var(--brass-400)" : "var(--border-strong)" }} />
                        ))}
                    </div>
                    <span style={{ flex: 1 }} />
                    {i > 0 && (
                        <button type="button" onClick={prev}
                            style={{ height: 30, padding: "0 12px", cursor: "pointer", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-muted)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 12, letterSpacing: "0.04em" }}>
                            Back
                        </button>
                    )}
                    <button type="button" onClick={next}
                        style={{ height: 30, padding: "0 14px", cursor: "pointer", borderRadius: "var(--r-sm)", border: "1px solid var(--border-brass)", background: "color-mix(in srgb, var(--brass-500) 18%, transparent)", color: "var(--brass-300)", fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 12, letterSpacing: "0.05em" }}>
                        {last ? "Done" : "Next"}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
