"use client";

import { useState } from "react";

export function SourceSpanTooltip({
  span,
  document,
  url,
  children,
}: {
  span: string;
  document: string;
  url?: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-2 w-80 -translate-x-1/2 rounded border border-border-strong bg-bg-panel-alt p-3 text-xs leading-relaxed shadow-xl"
        >
          <span className="block text-text before:content-['\201C'] after:content-['\201D']">{span}</span>
          <span className="mt-2 block text-text-faint">
            {document}
            {url && (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-accent">
                  source
                </a>
              </>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
