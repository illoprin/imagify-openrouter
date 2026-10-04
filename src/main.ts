import { GenerateOne } from "./api";
import {
  Defaults,
  type History,
  type Job,
  type ModelId,
  type Snapshot,
  type State,
} from "./config";
import { FileToDataUrl } from "./images";
import { Get, OpenDb, Put } from "./storage";
import {
  ApplyModelUI,
  AutoGrow,
  Elements,
  InitUi,
  RenderGrid,
  RenderRefs,
} from "./ui";

let state: State = { ...Defaults };
let apiKey = "";
let db: IDBDatabase;
const pending = new Map<string, Job>();
const el = Elements;

function save(): void {
  void Put(db, "records", { id: "state", value: state }).catch(console.error);
}

function showImage(url: string): void {
  (el.Viewer.querySelector("img") as HTMLImageElement).src = url;
  el.Viewer.classList.add("open");
}

function renderRefs(): void {
  RenderRefs(state, save, showImage);
}

function renderGrid(): void {
  RenderGrid(state, pending, {
    save,
    download,
    useAsRef,
    showImage,
    reusePrompt: (prompt) => {
      state.prompt = prompt;
      el.Prompt.value = prompt;
      AutoGrow();
      save();
      el.Prompt.focus();
    },
  });
}

function setPanel(open: boolean): void {
  state.panelOpen = open;
  document.body.classList.toggle("collapsed", !open);
  save();
}

function setCount(value: number): void {
  state.count = Math.max(1, Math.min(8, value));
  el.Count.textContent = String(state.count);
  save();
}

async function addFiles(files: File[]): Promise<void> {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      state.refs.push(await FileToDataUrl(file));
    } catch {
      // skip unreadable images
    }
  }
  save();
  renderRefs();
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

function bindControls(): void {
  el.Key.oninput = () => {
    apiKey = el.Key.value.trim();
    if (apiKey) localStorage.setItem("imagify-api-key", apiKey);
    else localStorage.removeItem("imagify-api-key");
  };
  el.Model.onchange = () => {
    state.model = el.Model.value as ModelId;
    ApplyModelUI(state, save);
    save();
  };
  el.Prompt.oninput = () => {
    state.prompt = el.Prompt.value;
    AutoGrow();
    save();
  };
  el.Stream.onchange = () => {
    state.stream = el.Stream.checked;
    save();
  };

  document.getElementById("toggle")!.onclick = () => {
    setPanel(document.body.classList.contains("collapsed"));
  };
  document.getElementById("eye")!.onclick = () => {
    const show = el.Key.type === "password";
    el.Key.type = show ? "text" : "password";
    document.getElementById("eye")!.innerHTML =
      `<i class="bi bi-eye${show ? "-slash" : ""}"></i>`;
  };
  document.getElementById("dec")!.onclick = () => setCount(state.count - 1);
  document.getElementById("inc")!.onclick = () => setCount(state.count + 1);
  document.getElementById("attach")!.onclick = () => el.File.click();
  el.File.onchange = () => {
    void addFiles(Array.from(el.File.files ?? []));
    el.File.value = "";
  };
  el.Go.onclick = () => void run();
  document.getElementById("clear")!.onclick = () => {
    if (state.history.length && confirm("Delete all saved images?")) {
      state.history = [];
      save();
      renderGrid();
    }
  };
  el.Viewer.onclick = () => el.Viewer.classList.remove("open");

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
    const files = Array.from((event as ClipboardEvent).clipboardData?.files ?? []);
    if (files.length) void addFiles(files);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") el.Viewer.classList.remove("open");
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      !el.Go.disabled
    )
      void run();
  });
}

async function run(): Promise<void> {
  if (!apiKey.trim()) {
    setPanel(true);
    el.Key.focus();
    return;
  }
  if (!state.prompt.trim()) {
    el.Prompt.focus();
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
  el.Go.disabled = true;
  const jobs: string[] = [];
  for (let index = 0; index < state.count; index++) {
    const id = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
    pending.set(id, { id, snapshot, status: "loading", startedAt: Date.now() });
    jobs.push(id);
  }
  renderGrid();

  const timer = window.setInterval(() => {
    document.querySelectorAll<HTMLElement>(".generating-time").forEach((time) => {
      const startedAt = Number(time.dataset.startedAt);
      time.textContent = `• ${((Date.now() - startedAt) / 1000).toFixed(2)}s`;
    });
  }, 100);

  await Promise.all(
    jobs.map(async (id) => {
      try {
        const startedAt = pending.get(id)?.startedAt ?? Date.now();
        const result = await GenerateOne(snapshot, apiKey);
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
  el.Go.disabled = false;
}

async function init(): Promise<void> {
  apiKey = localStorage.getItem("imagify-api-key") ?? "";
  el.Key.value = apiKey;
  db = await OpenDb();
  const saved = await Get<{ id: string; value: Partial<State> }>(
    db,
    "records",
    "state",
  );
  if (saved?.value) state = { ...Defaults, ...saved.value };
  state.history = state.history.slice(0, 60);

  InitUi(state, save, renderRefs, renderGrid);
  bindControls();
}

// the api key is stored unencrypted in localStorage; avoid using this on an untrusted device
void init().catch((error: unknown) => {
  console.error(error);
  alert("Could not initialize IndexedDB. Please use a modern browser.");
});
