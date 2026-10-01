import { describe, expect, it } from "vitest";
import { StandardDataOwnershipPolicy, decideDataOwnership } from "../src/data-ownership";

describe("StandardDataOwnershipPolicy", () => {
  it("imports incoming values when no existing value is present", () => {
    const decision = decideDataOwnership({
      existingValue: undefined,
      existingSource: undefined,
      incomingValue: 42,
      incomingSource: "monkeytype"
    });
    expect(decision).toBe("import");
  });

  it("strictly protects existing values that have no source tag (unlabelled manual edits)", () => {
    const decision = decideDataOwnership({
      existingValue: 15,
      existingSource: undefined,
      incomingValue: 30,
      incomingSource: "monkeytype"
    });
    expect(decision).toBe("protect");
  });

  it("strictly protects explicit manual entries from being overwritten by endpoints", () => {
    const decision = decideDataOwnership({
      existingValue: 20,
      existingSource: "manual",
      incomingValue: 45,
      incomingSource: "duolingo"
    });
    expect(decision).toBe("protect");
  });

  it("strictly protects entries owned by one integration from another integration", () => {
    const decision = decideDataOwnership({
      existingValue: 100,
      existingSource: "wakatime",
      incomingValue: 120,
      incomingSource: "github"
    });
    expect(decision).toBe("protect");
  });

  it("updates existing values if incoming from the same integration with a new value", () => {
    const decision = decideDataOwnership({
      existingValue: 50,
      existingSource: "monkeytype",
      incomingValue: 75,
      incomingSource: "monkeytype"
    });
    expect(decision).toBe("update");
  });

  it("skips writing if incoming from the same integration with an identical value", () => {
    const decision = decideDataOwnership({
      existingValue: 50,
      existingSource: "monkeytype",
      incomingValue: 50,
      incomingSource: "monkeytype"
    });
    expect(decision).toBe("skip");
  });

  it("treats health-connect and companion aliases as the same integration", () => {
    const updateDecision = decideDataOwnership({
      existingValue: 2000,
      existingSource: "companion",
      incomingValue: 2200,
      incomingSource: "health-connect"
    });
    expect(updateDecision).toBe("update");

    const skipDecision = decideDataOwnership({
      existingValue: 2200,
      existingSource: "health-connect",
      incomingValue: 2200,
      incomingSource: "temperans-companion"
    });
    expect(skipDecision).toBe("skip");
  });

  it("rejects invalid or negative values", () => {
    expect(decideDataOwnership({
      existingValue: 10,
      existingSource: "endpoint",
      incomingValue: -5,
      incomingSource: "endpoint"
    })).toBe("skip");

    expect(decideDataOwnership({
      existingValue: undefined,
      existingSource: undefined,
      incomingValue: NaN,
      incomingSource: "endpoint"
    })).toBe("skip");
  });
});
