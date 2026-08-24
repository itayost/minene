"use client";

import { useState } from "react";
import { NOT_WIRED } from "./not-wired";

const arrowIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M19 12H5m6-6-6 6 6 6" />
  </svg>
);

/**
 * The recommendation's call to action. It was a span, so the most prominent
 * control on the screen could not be pressed, focused, or reached by keyboard.
 */
export function FeatureAction({ label }: { label: string }) {
  const [notice, setNotice] = useState("");

  return (
    <>
      <button
        className="cockpit-feature__action"
        onClick={() => setNotice(NOT_WIRED)}
        type="button"
      >
        <span>{label}</span>
        {arrowIcon}
      </button>

      <p aria-live="polite" className="cockpit-feature__notice">
        {notice}
      </p>
    </>
  );
}
