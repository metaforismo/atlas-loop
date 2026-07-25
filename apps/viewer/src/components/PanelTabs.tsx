import type { ReactNode } from "react";
import { useTabListKeys } from "../useTabListKeys.js";

export interface PanelTab<Id extends string> {
  id: Id;
  label: string;
  /** Shown beside the label, e.g. a count. */
  badge?: string;
  /**
   * Something in here wants looking at. A number renders as a count, `true` as
   * a plain marker, so a tab can say "three problems" or just "look".
   */
  attention?: number | boolean;
  body: ReactNode;
}

/**
 * A column of panels, shown one at a time.
 *
 * A tall narrow column that stacks everything makes each panel cost the height
 * of all the others: the inspector held three panels of 1188, 1700, and 1055
 * pixels inside 664, so reaching the third meant scrolling past the first two
 * every time. Shown one at a time each gets the whole column.
 *
 * Every tab stays mounted. These panels poll the daemon, hold form state, and
 * carry anchors that deep links scroll to; unmounting the hidden ones would
 * break all three.
 */
export function PanelTabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
  className
}: {
  /** Names the tablist for assistive technology. */
  label: string;
  tabs: Array<PanelTab<Id>>;
  selected: Id;
  onSelect: (id: Id) => void;
  className?: string;
}) {
  const active = (tabs.some((tab) => tab.id === selected) ? selected : tabs[0]?.id) as Id;
  const keys = useTabListKeys(
    tabs.map((tab) => tab.id),
    active,
    onSelect
  );

  return (
    <div className={`panel-tabs${className ? ` ${className}` : ""}`}>
      <div className="panel-tabs-strip" role="tablist" aria-label={label} ref={keys.ref} onKeyDown={keys.onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`panel-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-tabpanel-${tab.id}`}
            /* Roving tabindex: the strip is one stop, and the arrows move
               within it, rather than every tab being its own stop. */
            tabIndex={keys.tabIndex(tab.id)}
            className={active === tab.id ? "selected" : ""}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {tab.badge ? <span className="panel-tab-badge">{tab.badge}</span> : null}
            {typeof tab.attention === "number" && tab.attention > 0 ? (
              <span className="panel-tab-attention">{tab.attention}</span>
            ) : tab.attention === true ? (
              <span className="panel-tab-dot" aria-label="needs attention" />
            ) : null}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-tabpanel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`panel-tab-${tab.id}`}
          className="panel-tabs-body"
          hidden={active !== tab.id}
        >
          {tab.body}
        </div>
      ))}
    </div>
  );
}
