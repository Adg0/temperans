import { EndpointConfig, HabitCadence, HabitDisplayFormat, HabitType } from "./types";

export interface HabitPreset {
  id: string;
  name: string;
  category: "health-connect" | "connected-apis";
  categoryLabel: string;
  archetype: HabitType;
  unit: string;
  cadence: HabitCadence;
  min?: number;
  max?: number;
  displayFormat?: HabitDisplayFormat;
  description: string;
  icon: string;
  endpoint?: EndpointConfig;
}

export const HABIT_PRESETS: HabitPreset[] = [
  // Health Connect presets
  {
    id: "sleep",
    name: "Sleep",
    category: "health-connect",
    categoryLabel: "Health Connect",
    archetype: "metric",
    unit: "minutes",
    cadence: "daily",
    min: 480,
    displayFormat: "duration",
    description: "Tracks nightly sleep duration (8-hour target). Supported by companion app.",
    icon: "moon"
  },
  {
    id: "hydration",
    name: "Hydration",
    category: "health-connect",
    categoryLabel: "Health Connect",
    archetype: "metric",
    unit: "ml",
    cadence: "daily",
    min: 2000,
    description: "Daily hydration intake (2,000 ml target). Supported by companion app.",
    icon: "droplets"
  },
  {
    id: "steps",
    name: "Daily steps",
    category: "health-connect",
    categoryLabel: "Health Connect",
    archetype: "metric",
    unit: "steps",
    cadence: "daily",
    min: 10000,
    description: "Daily step target (10,000 steps). Supported by companion app.",
    icon: "footprints"
  },
  {
    id: "calories",
    name: "Nutrition",
    category: "health-connect",
    categoryLabel: "Health Connect",
    archetype: "metric",
    unit: "kcal",
    cadence: "daily",
    min: 2000,
    description: "Daily nutritional energy intake (2,000 kcal target). Supported by companion app.",
    icon: "apple"
  },
  {
    id: "exercise",
    name: "Exercise",
    category: "health-connect",
    categoryLabel: "Health Connect",
    archetype: "metric",
    unit: "minutes",
    cadence: "daily",
    min: 30,
    description: "Daily active workout time (30-minute target). Supported by companion app.",
    icon: "activity"
  },

  // Connected APIs presets
  {
    id: "github",
    name: "GitHub contributions",
    category: "connected-apis",
    categoryLabel: "Connected APIs",
    archetype: "metric",
    unit: "contributions",
    cadence: "daily",
    min: 1,
    description: "Daily commits, reviews, and pull requests. Syncs GitHub activity.",
    icon: "git-branch",
    endpoint: {
      sourceName: "github",
      url: "https://api.github.com/graphql",
      method: "POST",
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Temperans-Habits"
      },
      auth: {
        type: "header",
        headerName: "Authorization",
        secretKey: "temperans-habits-github-token",
        prefix: "Bearer "
      },
      body: {
        query: "query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }",
        variables: {
          from: "{{startDateIso}}",
          to: "{{todayIso}}"
        }
      },
      response: {
        recordsPath: "data.viewer.contributionsCollection.contributionCalendar.weeks.contributionDays",
        dateField: "date",
        valueField: "contributionCount",
        aggregation: "sum"
      }
    }
  },
  {
    id: "typing",
    name: "Typing practice",
    category: "connected-apis",
    categoryLabel: "Connected APIs",
    archetype: "metric",
    unit: "minutes",
    cadence: "daily",
    min: 15,
    description: "Monkeytype typing session duration. Syncs via Monkeytype ApeKey.",
    icon: "keyboard",
    endpoint: {
      sourceName: "monkeytype",
      url: "https://api.monkeytype.com/results?onOrAfterTimestamp={{startMillis}}&limit=1000",
      testUrl: "https://api.monkeytype.com/users/currentTestActivity",
      auth: {
        type: "header",
        headerName: "Authorization",
        secretKey: "temperans-habits-monkeytype-apekey",
        prefix: "ApeKey "
      },
      response: {
        recordsPath: "data",
        dateField: "timestamp",
        valueField: "testDuration",
        aggregation: "sum",
        valueTransform: "divideBy:60"
      }
    }
  },
  {
    id: "duolingo",
    name: "Duolingo streak",
    category: "connected-apis",
    categoryLabel: "Connected APIs",
    archetype: "tracker",
    unit: "days",
    cadence: "daily",
    description: "Goal-free daily snapshot of the current Duolingo streak from a public profile. Replace YOUR_USERNAME in the endpoint URL before syncing.",
    icon: "languages",
    endpoint: {
      sourceName: "duolingo",
      url: "https://www.duolingo.com/2017-06-30/users?username=YOUR_USERNAME",
      auth: {
        type: "none",
        secretKey: ""
      },
      response: {
        recordsPath: "users.0",
        dateField: "{{today}}",
        valueField: "streak",
        aggregation: "latest"
      }
    }
  },
];
