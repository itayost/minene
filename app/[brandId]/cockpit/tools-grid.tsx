"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { NOT_WIRED } from "./not-wired";

type HomeTool = {
  title: string;
  icon: string;
  /* Set only for tools that have a screen to go to. The rest render as
     buttons that say they are not connected yet. */
  href?: string;
  compact?: boolean;
};

/**
 * The home catalog.
 *
 * Titles are spans rather than headings: a button's content model is phrasing
 * content, so an h3 inside one is invalid, and as controls their names are
 * already announced. The section's own h2 carries the outline.
 */
export function ToolsGrid({ tools }: { tools: readonly HomeTool[] }) {
  const [notice, setNotice] = useState("");

  return (
    <>
      <ul className="cockpit-tools__grid" role="list">
        {tools.map((tool) => {
          const className = `cockpit-tool${tool.compact ? " cockpit-tool--compact" : ""}`;
          const inner = (
            <>
              <span className="cockpit-tool__icon">
                <Image alt="" height={44} src={tool.icon} width={44} />
              </span>
              <span className="cockpit-tool__title">{tool.title}</span>
            </>
          );

          return (
            <li
              className={
                tool.compact ? "cockpit-tools__item--compact" : undefined
              }
              key={tool.title}
            >
              {tool.href ? (
                <Link className={className} href={tool.href}>
                  {inner}
                </Link>
              ) : (
                <button
                  className={className}
                  onClick={() => setNotice(NOT_WIRED)}
                  type="button"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p aria-live="polite" className="cockpit-tools__notice">
        {notice}
      </p>
    </>
  );
}
