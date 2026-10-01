import { HabitSource } from "../types";

export type HealthConnectWriteDecision = "import" | "update" | "protect" | "skip";

/** Pure ownership policy used before a Health Connect or Companion value reaches a daily log. */
export function decideHealthConnectWrite(
  existingValue: number | undefined,
  existingSource: HabitSource | undefined,
  incomingValue: number,
  incomingSource: HabitSource = "health-connect"
): HealthConnectWriteDecision {
  if (!Number.isFinite(incomingValue) || incomingValue < 0) return "skip";
  if (existingValue === undefined) return "import";
  const isStagedSource = (src?: HabitSource) => src === "health-connect" || src === "companion" || src === "temperans-companion" || src === incomingSource;
  if (!isStagedSource(existingSource)) return "protect";
  return existingValue === incomingValue ? "skip" : "update";
}
