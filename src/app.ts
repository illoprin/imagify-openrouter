const API = "https://openrouter.ai/api/v1/images";
const DB = "imagify-v1";
const aspects = ["auto", "1:1", "2:3", "3:2", "4:3", "16:9", "9:16", "21:9"];
const qualities = ["auto", "low", "medium", "high"];
const models = {
  "openai/gpt-image-2": {
    label: "GPT Image 2",
    quality: qualities,
    background: true,
    resolution: false,
    stream: false,
  },
  "openai/gpt-image-2.5-sunburst": {
    label: "GPT Image 2.5 Sunburst",
    quality: [...qualities, "xhigh", "max"],
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
type ModelId = keyof typeof models;
type History = {
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
type State = {
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
type Snapshot = Omit<State, "count" | "panelOpen" | "history">;
type Job = {
  id: string;
  snapshot: Snapshot;
  status: "loading" | "error";
  startedAt: number;
  error?: string;
};
const defaults: State = {
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
let state: State = { ...defaults };
let apiKey = "";
let db: IDBDatabase;
const $ = <T extends HTMLElement = HTMLElement>(
  id: string,
  _type?: { new (): T },
): T => document.getElementById(id) as T;
const el = {
  key: $("apiKey", HTMLInputElement),
  model: $("model", HTMLSelectElement),
  prompt: $("prompt", HTMLTextAreaElement),
  stream: $("stream", HTMLInputElement),
  refs: $("refs"),
  file: $("file", HTMLInputElement),
  go: $("go", HTMLButtonElement),
  grid: $("grid"),
  info: $("info"),
  viewer: $("viewer"),
  count: $("countVal"),
};
const pending = new Map<string, Job>();
const imageInfoCache = new Map<
  string,
  Promise<{ bytes: number | null; width: number; height: number }>
>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function get<T>(store: string, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
function put(store: string, value: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function save(): void {
  void put("records", { id: "state", value: state }).catch(console.error);
}

function fillSelect(
  select: HTMLSelectElement,
  values: string[],
  label?: (value: string) => string,
): void {
  select.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label ? label(value) : value;
    select.appendChild(option);
  });
}
function renderSeg(
  id: string,
  values: string[],
  field: "aspect" | "quality" | "background" | "resolution",
): void {
  const box = $(id);
  box.innerHTML = "";
  values.forEach((value) => {
    const button = document.createElement("button");
    button.textContent = value;
    button.className = state[field] === value ? "on" : "";
    button.onclick = () => {
      state[field] = value;
      save();
      renderSeg(id, values, field);
    };
    box.appendChild(button);
  });
}
function applyModelUI(): void {
  const model = models[state.model];
  $("qualityBox").style.display = model.quality ? "" : "none";
  $("backgroundBox").style.display = model.background ? "" : "none";
  $("resolutionBox").style.display = model.resolution ? "" : "none";
  $("streamBox").style.display = model.stream ? "" : "none";
  $("qualityDetails").style.display =
    model.quality || model.background ? "" : "none";
  if (model.quality) {
    if (!(model.quality as readonly string[]).includes(state.quality))
      state.quality = "auto";
    renderSeg("qualitySeg", [...model.quality], "quality");
  }
}
function setPanel(open: boolean): void {
  state.panelOpen = open;
  document.body.classList.toggle("collapsed", !open);
  save();
}
function autoGrow(): void {
  el.prompt.style.height = "auto";
  el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 200)}px`;
}
function initUi(): void {
  fillSelect(
    el.model,
    Object.keys(models),
    (key) => models[key as ModelId].label,
  );
  el.model.value = state.model;
  el.prompt.value = state.prompt;
  el.stream.checked = state.stream;
  el.count.textContent = String(state.count);
  renderSeg("aspectSeg", aspects, "aspect");
  renderSeg("backgroundSeg", ["auto", "transparent", "opaque"], "background");
  renderSeg("resolutionSeg", ["1K", "2K", "4K"], "resolution");
  applyModelUI();
  document.body.classList.toggle("collapsed", !state.panelOpen);
  autoGrow();
  renderRefs();
  renderGrid();
}
el.key.oninput = () => {
  apiKey = el.key.value.trim();
  if (apiKey) localStorage.setItem("imagify-api-key", apiKey);
  else localStorage.removeItem("imagify-api-key");
};
el.model.onchange = () => {
  state.model = el.model.value as ModelId;
  applyModelUI();
  save();
};
el.prompt.oninput = () => {
  state.prompt = el.prompt.value;
  autoGrow();
  save();
};
el.stream.onchange = () => {
  state.stream = el.stream.checked;
  save();
};
$("toggle").onclick = () => {
  state.panelOpen = document.body.classList.contains("collapsed");
  document.body.classList.toggle("collapsed", !state.panelOpen);
  save();
};
$("eye").onclick = () => {
  const show = el.key.type === "password";
  el.key.type = show ? "text" : "password";
  $("eye").innerHTML = `<i class="bi bi-eye${show ? "-slash" : ""}"></i>`;
};
$("dec").onclick = () => setCount(state.count - 1);
$("inc").onclick = () => setCount(state.count + 1);
function setCount(value: number): void {
  state.count = Math.max(1, Math.min(8, value));
  el.count.textContent = String(state.count);
  save();
}

function fileToDataUrl(file: File, maxSide = 1536): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Invalid image"));
      image.onload = () => {
        const scale = Math.min(
          1,
          maxSide / Math.max(image.width, image.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Canvas unavailable"));
          return;
        }
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
async function addFiles(files: File[]): Promise<void> {
  for (const file of files)
    if (file.type.startsWith("image/")) {
      try {
        state.refs.push(await fileToDataUrl(file));
      } catch {
        /* skip unreadable images */
      }
    }
  save();
  renderRefs();
}
function renderRefs(): void {
  el.refs.innerHTML = "";
  state.refs.forEach((url, index) => {
    const item = document.createElement("div");
    item.className = "ref";
    item.innerHTML =
      '<img alt="reference"><button title="Remove" aria-label="Remove reference"><i class="bi bi-x"></i></button>';
    const image = item.querySelector("img") as HTMLImageElement;
    image.src = url;
    image.onclick = () => {
      (el.viewer.querySelector("img") as HTMLImageElement).src = url;
      el.viewer.classList.add("open");
    };
    item.querySelector("button")!.onclick = () => {
      state.refs.splice(index, 1);
      save();
      renderRefs();
    };
    el.refs.appendChild(item);
  });
}
$("attach").onclick = () => el.file.click();
el.file.onchange = () => {
  void addFiles(Array.from(el.file.files ?? []));
  el.file.value = "";
};
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.classList.add("drop-over");
});
document.addEventListener("dragleave", (event) => {
  if (!(event as DragEvent).relatedTarget)
    document.body.classList.remove("drop-over");
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("drop-over");
  void addFiles(Array.from((event as DragEvent).dataTransfer?.files ?? []));
});
document.addEventListener("paste", (event) => {
  const files = Array.from(
    (event as ClipboardEvent).clipboardData?.files ?? [],
  );
  if (files.length) void addFiles(files);
});

function buildBody(s: Snapshot): Record<string, unknown> {
  const model = models[s.model];
  const body: Record<string, unknown> = {
    model: s.model,
    prompt: s.prompt,
    aspect_ratio: s.aspect,
  };
  if (model.quality) body.quality = s.quality;
  if (model.background) body.background = s.background;
  if (model.resolution) body.resolution = s.resolution;
  if (model.stream && s.stream) body.stream = true;
  if (s.refs.length)
    body.input_references = s.refs.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  return body;
}
function extractImage(value: unknown): string | null {
  let found: string | null = null;
  const walk = (item: unknown, key = ""): void => {
    if (typeof item === "string") {
      if (item.startsWith("data:image/")) found = item;
      else if (["b64_json", "image_b64", "partial_image_b64"].includes(key))
        found = `data:image/png;base64,${item}`;
      else if (["url", "image_url"].includes(key) && /^https?:\/\//.test(item))
        found = item;
    } else if (Array.isArray(item)) item.forEach((child) => walk(child, key));
    else if (item && typeof item === "object")
      Object.entries(item).forEach(([childKey, child]) =>
        walk(child, childKey),
      );
  };
  walk(value);
  return found;
}
async function readResponse(
  response: Response,
  streaming: boolean,
): Promise<{ image: string; cost: number | null }> {
  let json: any;
  if (
    streaming &&
    (response.headers.get("content-type") ?? "").includes("text/event-stream")
  ) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let image: string | null = null;
    let cost: number | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          image = extractImage(json) ?? image;
          cost = json.usage?.cost ?? json.cost ?? cost;
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
    if (!image) throw new Error("Stream finished without an image");
    return { image, cost };
  }
  const text = await response.text();
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 500) || "Empty response");
  }
  if (!response.ok || json.error)
    throw new Error(
      json.error?.message ?? `HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  const image = extractImage(json);
  if (!image) throw new Error(`No image in response: ${text.slice(0, 500)}`);
  return { image, cost: json.usage?.cost ?? json.cost ?? null };
}
async function generateOne(
  snapshot: Snapshot,
): Promise<{ image: string; cost: number | null }> {
  const body = buildBody(snapshot);
  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-Title": "Imagify Internal Tool",
    },
    body: JSON.stringify(body),
  });
  return readResponse(response, Boolean(body.stream));
}
async function run(): Promise<void> {
  if (!apiKey.trim()) {
    setPanel(true);
    el.key.focus();
    return;
  }
  if (!state.prompt.trim()) {
    el.prompt.focus();
    return;
  }
  const snapshot: Snapshot = {
    model: state.model,
    prompt: state.prompt,
    aspect: state.aspect,
    quality: state.quality,
    background: state.background,
    resolution: state.resolution,
    stream: state.stream,
    refs: [...state.refs],
  };
  el.go.disabled = true;
  const jobs: string[] = [];
  for (let index = 0; index < state.count; index++) {
    const id = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
    pending.set(id, { id, snapshot, status: "loading", startedAt: Date.now() });
    jobs.push(id);
  }
  renderGrid();
  const timer = window.setInterval(() => {
    document
      .querySelectorAll<HTMLElement>(".generating-time")
      .forEach((time) => {
        const startedAt = Number(time.dataset.startedAt);
        time.textContent = `• ${((Date.now() - startedAt) / 1000).toFixed(2)}s`;
      });
  }, 100);
  await Promise.all(
    jobs.map(async (id) => {
      try {
        const startedAt = pending.get(id)?.startedAt ?? Date.now();
        const result = await generateOne(snapshot);
        pending.delete(id);
        state.history.unshift({
          id,
          ts: Date.now(),
          model: snapshot.model,
          prompt: snapshot.prompt,
          image: result.image,
          cost: result.cost,
          duration: Date.now() - startedAt,
          settings: {
            aspect: snapshot.aspect,
            quality: snapshot.quality,
            background: snapshot.background,
            resolution: snapshot.resolution,
            refs: snapshot.refs.length,
          },
        });
      } catch (error) {
        const job = pending.get(id);
        if (job) {
          job.status = "error";
          job.error = error instanceof Error ? error.message : String(error);
        }
      }
      state.history = state.history.slice(0, 60);
      save();
      renderGrid();
    }),
  );
  window.clearInterval(timer);
  el.go.disabled = false;
}
function settingsLine(item: History): string {
  const model = models[item.model];
  const settings = item.settings;
  const parts = [model.label, settings.aspect];
  if (model.quality) parts.push(settings.quality);
  if (model.background && settings.background !== "auto")
    parts.push(settings.background);
  if (model.resolution) parts.push(settings.resolution);
  if (settings.refs)
    parts.push(`${settings.refs} ref${settings.refs > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
function getImageInfo(
  url: string,
): Promise<{ bytes: number | null; width: number; height: number }> {
  const cached = imageInfoCache.get(url);
  if (cached) return cached;
  const info = new Promise<{
    bytes: number | null;
    width: number;
    height: number;
  }>((resolve) => {
    const image = new Image();
    image.onload = async () => {
      let bytes: number | null = null;
      try {
        bytes = (await (await fetch(url)).blob()).size;
      } catch {
        // image dimensions are still available when the source blocks fetching
      }
      resolve({
        bytes,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => resolve({ bytes: null, width: 0, height: 0 });
    image.src = url;
  });
  imageInfoCache.set(url, info);
  return info;
}
function ratioCss(aspect: string): string {
  return /^\d+:\d+$/.test(aspect) ? aspect.replace(":", " / ") : "1 / 1";
}
function buttonHtml(icon: string, title: string, cls = ""): string {
  return `<button class="${cls}" data-a="${icon}" title="${title}" aria-label="${title}"><i class="bi bi-${icon}"></i></button>`;
}
function renderGrid(): void {
  el.grid.innerHTML = "";
  for (const job of pending.values()) {
    const card = document.createElement("div");
    card.className = "card";
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.style.aspectRatio = ratioCss(job.snapshot.aspect);
    if (job.status === "loading")
      frame.innerHTML = `<div class="state"><div class="spinner"></div>Generating <span class="generating-time" data-started-at="${job.startedAt}">• ${((Date.now() - job.startedAt) / 1000).toFixed(2)}s</span></div>`;
    else {
      frame.innerHTML =
        '<div class="state err"></div><div class="tools">' +
        buttonHtml("x-lg", "Dismiss") +
        "</div>";
      frame.querySelector(".err")!.textContent =
        job.error ?? "Generation failed";
      frame.querySelector("button")!.onclick = () => {
        pending.delete(job.id);
        renderGrid();
      };
    }
    card.appendChild(frame);
    el.grid.appendChild(card);
  }
  for (const item of state.history) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="frame"><img alt=""><div class="tools">${buttonHtml("download", "Download")}${buttonHtml("paperclip", "Use as reference")}${buttonHtml("arrow-repeat", "Reuse prompt")}${buttonHtml("trash3", "Delete", "del")}</div></div><div class="caption"><p></p><span></span><small class="cost"></small></div>`;
    const image = card.querySelector("img") as HTMLImageElement;
    image.src = item.image;
    image.onclick = () => {
      (el.viewer.querySelector("img") as HTMLImageElement).src = item.image;
      el.viewer.classList.add("open");
    };
    card.querySelector("p")!.textContent = item.prompt;
    card.querySelector("span")!.textContent = settingsLine(item);
    const cost = card.querySelector(".cost")!;
    const costParts: string[] = [];
    if (item.cost !== null && Number.isFinite(Number(item.cost)))
      costParts.push(`$${Number(item.cost).toFixed(4)}`);
    if (item.duration !== undefined)
      costParts.push(`${(item.duration / 1000).toFixed(2)}s`);
    cost.textContent = costParts.join(" • ");
    void getImageInfo(item.image).then((info) => {
      if (!cost.isConnected) return;
      const parts = [cost.textContent];
      if (info.bytes !== null)
        parts.push(`${(info.bytes / (1024 * 1024)).toFixed(2)}MB`);
      parts.push(`${info.width}x${info.height}`);
      cost.textContent = parts.filter(Boolean).join(" • ");
    });
    card.querySelector('[data-a="download"]')!.addEventListener("click", () => {
      void download(item);
    });
    card
      .querySelector('[data-a="paperclip"]')!
      .addEventListener("click", () => {
        void useAsRef(item);
      });
    card
      .querySelector('[data-a="arrow-repeat"]')!
      .addEventListener("click", () => {
        state.prompt = item.prompt;
        el.prompt.value = item.prompt;
        autoGrow();
        save();
        el.prompt.focus();
      });
    card.querySelector('[data-a="trash3"]')!.addEventListener("click", () => {
      state.history = state.history.filter((entry) => entry.id !== item.id);
      save();
      renderGrid();
    });
    el.grid.appendChild(card);
  }
  if (!pending.size && !state.history.length)
    el.grid.innerHTML =
      '<div class="empty" style="grid-column:1/-1;min-height:50vh"><div><i class="bi bi-images"></i>Generated images will appear here</div></div>';
  el.info.textContent = state.history.length
    ? `${state.history.length} saved`
    : "";
}
async function download(item: History): Promise<void> {
  try {
    let href = item.image;
    if (!href.startsWith("data:"))
      href = URL.createObjectURL(await (await fetch(href)).blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${item.model.replace("/", "_")}-${item.ts}.png`;
    anchor.click();
  } catch {
    window.open(item.image, "_blank");
  }
}
async function useAsRef(item: History): Promise<void> {
  try {
    const blob = await (await fetch(item.image)).blob();
    await addFiles([
      new File([blob], "ref.png", { type: blob.type || "image/png" }),
    ]);
  } catch {
    alert("Could not load this image as a reference (cross-origin URL).");
  }
}
el.go.onclick = () => {
  void run();
};
$("clear").onclick = () => {
  if (state.history.length && confirm("Delete all saved images?")) {
    state.history = [];
    save();
    renderGrid();
  }
};
el.viewer.onclick = () => el.viewer.classList.remove("open");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") el.viewer.classList.remove("open");
  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !el.go.disabled
  )
    void run();
});
async function init(): Promise<void> {
  apiKey = localStorage.getItem("imagify-api-key") ?? "";
  el.key.value = apiKey;
  db = await openDb();
  const saved = await get<{ id: string; value: Partial<State> }>(
    "records",
    "state",
  );
  if (saved?.value) state = { ...defaults, ...saved.value };
  state.history = state.history.slice(0, 60);
  initUi();
}
void init().catch((error: unknown) => {
  console.error(error);
  alert("Could not initialize IndexedDB. Please use a modern browser.");
});

// the api key is stored unencrypted in localStorage; do not use this on an untrusted device.
