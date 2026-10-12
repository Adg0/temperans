import { describe, expect, it } from "vitest";
import { todayInZone } from "../src/date";
import {
  buildEndpointHeaders,
  buildEndpointUrl,
  buildTemplateVars,
  extractEndpointDailyData,
  extractEndpointDailyValues,
  interpolateEndpointUrl,
  parseRecordDate,
  syncHabitFromEndpoint,
  transformValue
} from "../src/integrations/endpoint-runner";
import { EndpointConfig, HabitDefinition } from "../src/types";

describe("endpoint-runner URL and template interpolation", () => {
  it("interpolates template variables correctly", () => {
    const vars = {
      today: "2026-08-25",
      startDate: "2026-08-19",
      endDate: "2026-08-25",
      startMillis: 1787097600000,
      endMillis: 1787702399999,
      startSeconds: 1787097600,
      endSeconds: 1787702399,
      startDateIso: "2026-08-19T00:00:00Z",
      endDateIso: "2026-08-25T23:59:59Z",
      nowIso: "2026-08-25T12:00:00Z",
      todayIso: "2026-08-25T00:00:00Z"
    };
    const template = "https://api.example.com/data?start={{startDate}}&end={{endDate}}&since={{startMillis}}";
    expect(interpolateEndpointUrl(template, vars)).toBe(
      "https://api.example.com/data?start=2026-08-19&end=2026-08-25&since=1787097600000"
    );
  });

  it("builds authentication headers and query parameters", () => {
    const headerConfig: EndpointConfig = {
      url: "https://api.example.com/results",
      auth: {
        type: "header",
        headerName: "Authorization",
        prefix: "ApeKey ",
        secretKey: "my-key"
      }
    };
    expect(buildEndpointHeaders(headerConfig, "secret-123")).toEqual({
      Authorization: "ApeKey secret-123"
    });

    const queryConfig: EndpointConfig = {
      url: "https://api.example.com/results?type=summary",
      auth: {
        type: "query",
        paramName: "token",
        secretKey: "my-key"
      }
    };
    const vars = buildTemplateVars("2026-08-25", 7);
    expect(buildEndpointUrl(queryConfig, vars, "secret-abc")).toContain(
      "https://api.example.com/results?type=summary&token=secret-abc"
    );
  });
});

describe("endpoint-runner date parsing and value transforms", () => {
  it("parses dates from YYYY-MM-DD, ISO strings, and epoch numbers", () => {
    expect(parseRecordDate("2026-08-25", "UTC")).toBe("2026-08-25");
    expect(parseRecordDate("2026-08-25T14:30:00Z", "UTC")).toBe("2026-08-25");
    // Epoch millis for 2026-08-25T12:00:00Z: 1787659200000
    expect(parseRecordDate(1787659200000, "UTC")).toBe("2026-08-25");
    // Epoch seconds
    expect(parseRecordDate(1787659200, "UTC")).toBe("2026-08-25");
    expect(parseRecordDate("invalid", "UTC")).toBeNull();
  });

  it("transforms values via math rules", () => {
    expect(transformValue(900, "divideBy:60")).toBe(15);
    expect(transformValue(2, "multiplyBy:60")).toBe(120);
    expect(transformValue(42, "none")).toBe(42);
  });
});

describe("endpoint-runner daily value extraction", () => {
  it("extracts and sums Monkeytype-style duration records", () => {
    const payload = {
      data: [
        { _id: "1", timestamp: 1787659200000, testDuration: 60 },
        { _id: "2", timestamp: 1787660000000, testDuration: 120 }
      ]
    };
    const result = extractEndpointDailyValues(
      payload,
      {
        recordsPath: "data",
        dateField: "timestamp",
        valueField: "testDuration",
        aggregation: "sum",
        valueTransform: "divideBy:60"
      },
      "UTC"
    );
    // Total 180 seconds / 60 = 3 minutes
    expect(result.get("2026-08-25")).toBe(3);
  });

  it("extracts daily item records including IDs and durations for detailed tracking", () => {
    const payload = {
      data: [
        { _id: "test-abc", timestamp: 1787659200000, testDuration: 60 },
        { _id: "test-def", timestamp: 1787660000000, testDuration: 120 }
      ]
    };
    const data = extractEndpointDailyData(
      payload,
      {
        recordsPath: "data",
        dateField: "timestamp",
        valueField: "testDuration",
        aggregation: "sum",
        valueTransform: "divideBy:60"
      },
      "UTC"
    );
    const day = data.get("2026-08-25");
    expect(day).toBeDefined();
    expect(day!.value).toBe(3);
    expect(day!.count).toBe(2);
    expect(day!.items).toHaveLength(2);
    expect(day!.items[0]).toMatchObject({
      id: "test-abc",
      durationSeconds: 60
    });
    expect(day!.items[1]).toMatchObject({
      id: "test-def",
      durationSeconds: 120
    });
  });

  it("extracts and aggregates count-based records (e.g. GitHub events)", () => {
    const payload = [
      { id: "e1", created_at: "2026-08-25T10:00:00Z" },
      { id: "e2", created_at: "2026-08-25T15:00:00Z" },
      { id: "e3", created_at: "2026-08-24T09:00:00Z" }
    ];
    const result = extractEndpointDailyValues(
      payload,
      {
        recordsPath: "",
        dateField: "created_at",
        aggregation: "count"
      },
      "UTC"
    );
    expect(result.get("2026-08-25")).toBe(2);
    expect(result.get("2026-08-24")).toBe(1);
  });

  it("extracts and parses WakaTime-style nested daily objects", () => {
    const payload = {
      data: [
        { range: { date: "2026-08-25" }, grand_total: { total_seconds: 3600 } },
        { range: { date: "2026-08-24" }, grand_total: { total_seconds: 1800 } }
      ]
    };
    const result = extractEndpointDailyValues(
      payload,
      {
        recordsPath: "data",
        dateField: "range.date",
        valueField: "grand_total.total_seconds",
        aggregation: "sum",
        valueTransform: "divideBy:60"
      },
      "UTC"
    );
    expect(result.get("2026-08-25")).toBe(60);
    expect(result.get("2026-08-24")).toBe(30);
  });

  it("extracts dictionary-style responses keyed by date", () => {
    const payload = {
      "2026-08-25": { value: 15 },
      "2026-08-24": { value: 25 }
    };
    const result = extractEndpointDailyValues(payload, undefined, "UTC");
    expect(result.get("2026-08-25")).toBe(15);
    expect(result.get("2026-08-24")).toBe(25);
  });

  it("writes customized sourceName to the daily log when syncing", async () => {
    const habit: HabitDefinition = {
      id: "typing",
      name: "Typing practice",
      unit: "minutes",
      cadence: "daily",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 15 }],
      endpoint: {
        sourceName: "monkeytype",
        url: "https://api.monkeytype.com/results",
        response: {
          recordsPath: "data",
          dateField: "timestamp",
          valueField: "testDuration",
          aggregation: "sum",
          valueTransform: "divideBy:60"
        }
      }
    };
    const savedLogs: Record<string, any> = {};
    const mockStore = {
      loadSettings: async () => ({ timezone: "UTC" }),
      getLog: async (date: string) => savedLogs[date] ?? { metrics: {}, metricSources: {}, sessions: {}, typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] } },
      updateLog: async (date: string, update: (log: any) => any) => {
        const current = savedLogs[date] ?? { metrics: {}, metricSources: {}, sessions: {}, typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] } };
        const next = update(current);
        savedLogs[date] = next;
        return next;
      }
    };
    const today = todayInZone("UTC");
    const mockRequester = async () => ({
      status: 200,
      json: {
        data: [{ _id: "t1", timestamp: Date.now(), testDuration: 120 }]
      }
    });
    const summary = await syncHabitFromEndpoint(habit, mockStore, "secret", 1, mockRequester);
    expect(summary.daysImported).toBe(1);
    expect(savedLogs[today].metricSources.typing).toBe("monkeytype");
    expect(savedLogs[today].typing.imported).toHaveLength(1);
    expect(savedLogs[today].typing.imported[0].id).toBe("t1");
  });

  it("extracts GitHub GraphQL contribution calendar with nested array flattening", () => {
    const payload = {
      data: {
        user: {
          contributionsCollection: {
            contributionCalendar: {
              weeks: [
                {
                  contributionDays: [
                    { date: "2026-08-24", contributionCount: 4 },
                    { date: "2026-08-25", contributionCount: 7 }
                  ]
                },
                {
                  contributionDays: [
                    { date: "2026-08-26", contributionCount: 2 }
                  ]
                }
              ]
            }
          }
        }
      }
    };
    const result = extractEndpointDailyValues(
      payload,
      {
        recordsPath: "data.user.contributionsCollection.contributionCalendar.weeks.contributionDays",
        dateField: "date",
        valueField: "contributionCount",
        aggregation: "sum"
      },
      "UTC"
    );
    expect(result.get("2026-08-24")).toBe(4);
    expect(result.get("2026-08-25")).toBe(7);
    expect(result.get("2026-08-26")).toBe(2);
  });

  it("extracts GitHub GraphQL contribution calendar from viewer path", () => {
    const payload = {
      data: {
        viewer: {
          contributionsCollection: {
            contributionCalendar: {
              weeks: [
                {
                  contributionDays: [
                    { date: "2026-08-24", contributionCount: 3 },
                    { date: "2026-08-25", contributionCount: 8 }
                  ]
                }
              ]
            }
          }
        }
      }
    };
    const result = extractEndpointDailyValues(
      payload,
      {
        recordsPath: "data.viewer.contributionsCollection.contributionCalendar.weeks.contributionDays",
        dateField: "date",
        valueField: "contributionCount",
        aggregation: "sum"
      },
      "UTC"
    );
    expect(result.get("2026-08-24")).toBe(3);
    expect(result.get("2026-08-25")).toBe(8);
  });

  it("extracts Duolingo-style single user profile streak for today", () => {
    const payload = {
      users: [
        {
          username: "Adg0",
          streak: 42,
          totalXp: 15400
        }
      ]
    };
    const result = extractEndpointDailyValues(
      payload,
      {
        recordsPath: "users.0",
        dateField: "{{today}}",
        valueField: "streak",
        aggregation: "latest"
      },
      "UTC"
    );
    const today = todayInZone("UTC");
    expect(result.get(today)).toBe(42);
  });

  it("interpolates ISO date variables and sends POST body for GraphQL endpoints", async () => {
    const habit: HabitDefinition = {
      id: "github",
      name: "GitHub",
      unit: "contributions",
      cadence: "daily",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 1 }],
      endpoint: {
        sourceName: "github",
        url: "https://api.github.com/graphql",
        method: "POST",
        body: {
          query: "query { test }",
          variables: {
            from: "{{startDateIso}}",
            to: "{{endDateIso}}"
          }
        },
        response: {
          recordsPath: "data.days",
          dateField: "date",
          valueField: "count"
        }
      }
    };
    const savedLogs: Record<string, any> = {};
    const mockStore = {
      loadSettings: async () => ({ timezone: "UTC" }),
      getLog: async (date: string) => savedLogs[date] ?? { metrics: {}, metricSources: {}, sessions: {}, typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] } },
      updateLog: async (date: string, update: (log: any) => any) => {
        const current = savedLogs[date] ?? { metrics: {}, metricSources: {}, sessions: {}, typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] } };
        const next = update(current);
        savedLogs[date] = next;
        return next;
      }
    };
    const today = todayInZone("UTC");
    let capturedBody: string | undefined;
    let capturedMethod: string | undefined;
    const mockRequester = async (params: any) => {
      capturedBody = params.body;
      capturedMethod = params.method;
      return {
        status: 200,
        json: {
          data: {
            days: [
              { date: today, count: 5 }
            ]
          }
        }
      };
    };

    const summary = await syncHabitFromEndpoint(habit, mockStore, "secret-pat", 7, mockRequester);
    expect(summary.daysImported).toBe(1);
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toBeDefined();
    expect(capturedBody).toContain('"from":');
    expect(capturedBody).toMatch(/T00:00:00Z/);
    expect(capturedBody).toMatch(/T\d{2}:\d{2}:\d{2}/);
    expect(savedLogs[today].metrics.github).toBe(5);
  });

  it("detects and surfaces GraphQL errors returned in HTTP 200 payload", async () => {
    const habit: HabitDefinition = {
      id: "github",
      name: "GitHub",
      unit: "contributions",
      cadence: "daily",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 1 }],
      endpoint: {
        sourceName: "github",
        url: "https://api.github.com/graphql",
        method: "POST",
        response: {
          recordsPath: "data.days",
          dateField: "date",
          valueField: "count"
        }
      }
    };
    const mockStore = {
      loadSettings: async () => ({ timezone: "UTC" }),
      getLog: async () => ({ metrics: {}, metricSources: {} }),
      updateLog: async () => null
    };
    const mockRequester = async () => ({
      status: 200,
      json: {
        errors: [{ message: "Field 'contributionsCollection' doesn't exist" }]
      }
    });

    await expect(syncHabitFromEndpoint(habit, mockStore, "secret", 7, mockRequester))
      .rejects.toThrow("GraphQL error: Field 'contributionsCollection' doesn't exist");
  });
});
