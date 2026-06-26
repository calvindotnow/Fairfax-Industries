"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// A stat readout that plays a quick rise-and-de-blur whenever its value settles to a new
// number, so the live calculator visibly reacts to each change. Pure CSS (the `num-pop`
// keyframe in globals.css); reduced-motion is neutralised globally. Pass the already-
// formatted string as `value` and the same `style` you'd give the text span.
//
// Debounced like slot-text: the text updates live every render, but the pop only replays
// once motion settles (the queued frame is cancelled while the value keeps changing), so
// dragging the accuracy slider scrubs the number smoothly instead of strobing the blur.
// `armed` stays false until the first real change, so nothing pops on initial page load.
export default function RollingNumber({ value, style }: { value: string; style?: CSSProperties }) {
    const [shownKey, setShownKey] = useState(value); // bumping this remounts the inner span → replays num-pop
    const [armed, setArmed] = useState(false);
    const prev = useRef(value);

    useEffect(() => {
        if (value === prev.current) return;
        prev.current = value;
        const id = requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                setShownKey(value);
                setArmed(true);
            }),
        );
        return () => cancelAnimationFrame(id);
    }, [value]);

    return (
        <span style={{ display: "inline-block", ...style }}>
            <span
                key={shownKey}
                style={{
                    display: "inline-block",
                    animation: armed ? "num-pop var(--motion-base) var(--ease-out)" : undefined,
                }}
            >
                {value}
            </span>
        </span>
    );
}
