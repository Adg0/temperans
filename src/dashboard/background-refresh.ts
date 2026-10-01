import { Notice } from "obsidian";
import { WidgetContext } from "./types";

/** A saved log must not wait for unrelated annual widgets to finish loading. */
export function refreshInBackground(ctx: WidgetContext): void {
  void ctx.onRefresh().catch(error => new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."));
}
