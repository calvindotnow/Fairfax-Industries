import { useEffect, useState } from "react";

// True when the viewport is at/below `max` px (default 768 — the build tool's
// "stack everything" breakpoint). SSR-safe: starts false (desktop-first render),
// then corrects on mount. Inline styles can't hold media queries, so the build
// tool swaps layout-defining style objects based on this instead.
export function useIsNarrow(max = 768) {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${max}px)`);
        const update = () => setNarrow(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, [max]);
    return narrow;
}
