import { DailyLog, HabitSource } from "./types";

export type DataOwnershipDecision = "import" | "protect" | "update" | "skip";

export interface DataOwnershipInput {
  existingValue: number | undefined;
  existingSource?: HabitSource | string;
  incomingValue: number;
  incomingSource: HabitSource | string;
}

/**
 * StandardDataOwnershipPolicy enforces the vault protection invariant:
 * - Manual entries (explicit "manual" or unlabelled frontmatter) are strictly protected.
 * - Values from different integrations are protected from overwriting each other.
 * - The same integration may update its own existing value if it has changed.
 * - If the value is unchanged, the write is skipped.
 * - If no existing value exists, the value is imported.
 */
export class StandardDataOwnershipPolicy {
  static decide(input: DataOwnershipInput): DataOwnershipDecision {
    const { existingValue, existingSource, incomingValue, incomingSource } = input;

    if (!Number.isFinite(incomingValue) || incomingValue < 0) {
      return "skip";
    }

    if (existingValue === undefined) {
      return "import";
    }

    // Manual edits or entries without an explicit integration source must never be overwritten
    if (!existingSource || existingSource.trim() === "" || existingSource === "manual") {
      return "protect";
    }

    const isSameIntegration = StandardDataOwnershipPolicy.isSameSource(existingSource, incomingSource);
    if (!isSameIntegration) {
      return "protect";
    }

    if (existingValue === incomingValue) {
      return "skip";
    }

    return "update";
  }

  static isSameSource(existingSource: string, incomingSource: string): boolean {
    if (existingSource === incomingSource) return true;

    // Health Connect & Companion aliases
    const healthSources = new Set(["health-connect", "companion", "temperans-companion"]);
    if (healthSources.has(existingSource) && healthSources.has(incomingSource)) {
      return true;
    }

    // Generic endpoint and monkeytype equivalence
    if (
      (existingSource === "monkeytype" && incomingSource === "endpoint") ||
      (existingSource === "endpoint" && incomingSource === "monkeytype")
    ) {
      return true;
    }

    return false;
  }
}

export function decideDataOwnership(input: DataOwnershipInput): DataOwnershipDecision {
  return StandardDataOwnershipPolicy.decide(input);
}

/** Session-only and legacy typing entries also carry ownership, even without a numeric metric. */
export function hasProtectedHabitEntries(log: DailyLog, id: string, incomingSource: string): boolean {
  const source = log.metricSources[id];
  if (source === "manual") return true;
  const sessions = log.sessions?.[id] ?? (id === "reading" ? log.reading : []) ?? [];
  const manualTyping = id === "typing" && ((log.typing?.manualDurationSeconds ?? 0) > 0 || (log.typing?.manualTests ?? 0) > 0);
  return !!(sessions.length || manualTyping) && (!source || !StandardDataOwnershipPolicy.isSameSource(source, incomingSource));
}
