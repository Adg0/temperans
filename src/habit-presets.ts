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
    name: "Active calories",
    category: "health-connect",
    categoryLabel: "Health Connect",
    archetype: "metric",
    unit: "kcal",
    cadence: "daily",
    min: 500,
    description: "Daily active calorie burn (500 kcal target). Supported by companion app.",
    icon: "flame"
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
    name: "Duolingo practice",
    category: "connected-apis",
    categoryLabel: "Connected APIs",
    archetype: "metric",
    unit: "lessons",
    cadence: "daily",
    min: 1,
    description: "Language learning streak (1 lesson daily). Syncs user profile streak.",
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
      url: "https://api.github.com/users/YOUR_USERNAME/events",
      testUrl: "https://api.github.com/user",
      auth: {
        type: "header",
        headerName: "Authorization",
        secretKey: "temperans-habits-github-token",
        prefix: "Bearer "
      },
      response: {
        recordsPath: "",
        dateField: "created_at",
        valueField: "",
        aggregation: "count"
      }
    }
  },
  {
    id: "wakatime",
    name: "Coding time",
    category: "connected-apis",
    categoryLabel: "Connected APIs",
    archetype: "metric",
    unit: "minutes",
    cadence: "daily",
    min: 60,
    description: "Daily editor focus time (60-minute target). Syncs via WakaTime API key.",
    icon: "code",
    endpoint: {
      sourceName: "wakatime",
      url: "https://wakatime.com/api/v1/users/current/summaries?start={{startDate}}&end={{endDate}}",
      testUrl: "https://wakatime.com/api/v1/users/current",
      auth: {
        type: "header",
        headerName: "Authorization",
        secretKey: "temperans-habits-wakatime-api-key",
        prefix: "Bearer "
      },
      response: {
        recordsPath: "data",
        dateField: "range.date",
        valueField: "grand_total.total_seconds",
        aggregation: "sum",
        valueTransform: "divideBy:60"
      }
    }
  }
];
