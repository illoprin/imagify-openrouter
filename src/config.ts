export const API = "https://openrouter.ai/api/v1/images";
export const DB = "imagify-v1";
export const Aspects = ["auto", "1:1", "2:3", "3:2", "4:3", "16:9", "9:16", "21:9"];
export const Qualities = ["auto", "low", "medium", "high"];

export const Models = {
  "openai/gpt-image-2": {
    label: "GPT Image 2",
    quality: Qualities,
    background: true,
    resolution: false,
    stream: false,
  },
  "openai/gpt-image-2.5-sunburst": {
    label: "GPT Image 2.5 Sunburst",
    quality: [...Qualities, "xhigh", "max"],
    background: true,
    resolution: false,
    stream: true,
  },
  "google/gemini-3.1-flash-image": {
    label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
    quality: null,
    background: false,
    resolution: true,
    stream: false,
  },
  "qwen/qwen-image-3": {
    label: "Qwen Image 3",
    quality: null,
    background: false,
    resolution: true,
    stream: false,
  },
  "qwen/qwen-image-3-pro": {
    label: "Qwen Image 3 Pro",
    quality: null,
    background: false,
    resolution: true,
    stream: false,
  },
} as const;

export type ModelId = keyof typeof Models;

export type History = {
  id: string;
  ts: number;
  model: ModelId;
  prompt: string;
  image: string;
  cost: number | null;
  duration?: number;
  settings: {
    aspect: string;
    quality: string;
    background: string;
    resolution: string;
    refs: number;
  };
};

export type State = {
  model: ModelId;
  prompt: string;
  aspect: string;
  count: number;
  quality: string;
  background: string;
  resolution: string;
  stream: boolean;
  panelOpen: boolean;
  refs: string[];
  history: History[];
};

export type Snapshot = Omit<State, "count" | "panelOpen" | "history">;

export type Job = {
  id: string;
  snapshot: Snapshot;
  status: "loading" | "error";
  startedAt: number;
  error?: string;
};

export const Defaults: State = {
  model: "openai/gpt-image-2",
  prompt: "",
  aspect: "1:1",
  count: 1,
  quality: "auto",
  background: "auto",
  resolution: "1K",
  stream: false,
  panelOpen: true,
  refs: [],
  history: [],
};
