import { useEffect, useMemo, useState } from "react";
import { useModalDialog } from "../useModalDialog.js";

export type WorkspaceCommandId =
  | "overview"
  | "sessions"
  | "evidence"
  | "actions"
  | "atlas"
  | "artifacts"
  | "health"
  | "home";

const COMMANDS: Array<{ id: WorkspaceCommandId; label: string; group: string; hint: string }> = [
  { id: "overview", label: "Open workspace overview", group: "Workspace", hint: "Device viewport" },
  { id: "sessions", label: "Browse sessions", group: "Workspace", hint: "Recent local runs" },
  { id: "evidence", label: "Inspect live evidence", group: "Workspace", hint: "Latest screenshot" },
  { id: "actions", label: "Run an action", group: "Workspace", hint: "Tap, type, swipe, gesture" },
  { id: "atlas", label: "Open Atlas map", group: "Workspace", hint: "Observed screens and routes" },
  { id: "artifacts", label: "Browse artifacts", group: "System", hint: "Screenshots, traces, logs" },
  { id: "health", label: "Check evidence health", group: "System", hint: "Integrity report" },
  { id: "home", label: "Return to product home", group: "Navigate", hint: "Atlas Loop landing" }
];

export function WorkspaceCommandMenu({ onSelect }: { onSelect: (command: WorkspaceCommandId) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <>
      <button type="button" className="command-menu-trigger" aria-label="Search workspace" aria-keyshortcuts="Meta+K Control+K" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⌕</span><span>Search workspace</span><kbd>⌘K</kbd>
      </button>
      {open ? <WorkspaceCommandDialog onClose={() => setOpen(false)} onSelect={onSelect} /> : null}
    </>
  );
}

function WorkspaceCommandDialog({
  onClose,
  onSelect
}: {
  onClose: () => void;
  onSelect: (command: WorkspaceCommandId) => void;
}) {
  const [query, setQuery] = useState("");
  const { dialogRef } = useModalDialog(onClose);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return COMMANDS;
    const terms = normalized.split(/\s+/).map((term) => term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term);
    return COMMANDS.filter((command) => {
      const haystack = `${command.label} ${command.group} ${command.hint}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [query]);

  const choose = (id: WorkspaceCommandId): void => {
    onClose();
    onSelect(id);
  };

  return (
    <div className="command-menu-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} className="command-menu-dialog" role="dialog" aria-modal="true" aria-label="Search workspace" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <label className="command-menu-search">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions, actions, or evidence…"
          />
          <kbd>ESC</kbd>
        </label>
        <div className="command-menu-results">
          {results.length ? results.map((command) => (
            <button key={command.id} type="button" onClick={() => choose(command.id)}>
              <span><small>{command.group}</small><strong>{command.label}</strong></span>
              <em>{command.hint}</em>
            </button>
          )) : <p>No matching workspace commands.</p>}
        </div>
        <footer><span>↑↓ Navigate</span><span>↵ Open</span><span>Local workspace only</span></footer>
      </div>
    </div>
  );
}
