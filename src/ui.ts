import {
  Aspects,
  Models,
  type History,
  type Job,
  type ModelId,
  type State,
} from "./config";
import { GetImageInfo } from "./images";

export const Elements = {
  Key: document.getElementById("apiKey") as HTMLInputElement,
  Model: document.getElementById("model") as HTMLSelectElement,
  Prompt: document.getElementById("prompt") as HTMLTextAreaElement,
  Stream: document.getElementById("stream") as HTMLInputElement,
  Refs: document.getElementById("refs") as HTMLElement,
  File: document.getElementById("file") as HTMLInputElement,
  Go: document.getElementById("go") as HTMLButtonElement,
  Grid: document.getElementById("grid") as HTMLElement,
  Info: document.getElementById("info") as HTMLElement,
  Viewer: document.getElementById("viewer") as HTMLElement,
  Count: document.getElementById("countVal") as HTMLElement,
};

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
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

export function RenderSeg(
  id: string,
  values: string[],
  field: "aspect" | "quality" | "background" | "resolution",
  state: State,
  save: () => void,
): void {
  const box = byId(id);
  box.innerHTML = "";
  values.forEach((value) => {
    const button = document.createElement("button");
    button.textContent = value;
    button.className = state[field] === value ? "on" : "";
    button.onclick = () => {
      state[field] = value;
      save();
      RenderSeg(id, values, field, state, save);
    };
    box.appendChild(button);
  });
}

export function ApplyModelUI(state: State, save: () => void): void {
  const model = Models[state.model];
  byId("qualityBox").style.display = model.quality ? "" : "none";
  byId("backgroundBox").style.display = model.background ? "" : "none";
  byId("resolutionBox").style.display = model.resolution ? "" : "none";
  byId("streamBox").style.display = model.stream ? "" : "none";
  byId("qualityDetails").style.display =
    model.quality || model.background ? "" : "none";
  if (model.quality) {
    if (!(model.quality as readonly string[]).includes(state.quality)) {
      state.quality = "auto";
      save();
    }
    RenderSeg("qualitySeg", [...model.quality], "quality", state, save);
  }
}

export function AutoGrow(): void {
  Elements.Prompt.style.height = "auto";
  Elements.Prompt.style.height = `${Math.min(Elements.Prompt.scrollHeight, 200)}px`;
}

export function RenderRefs(
  state: State,
  save: () => void,
  showImage: (url: string) => void,
): void {
  Elements.Refs.innerHTML = "";
  state.refs.forEach((url, index) => {
    const item = document.createElement("div");
    item.className = "ref";
    item.innerHTML =
      '<img alt="reference"><button title="Remove" aria-label="Remove reference"><i class="bi bi-x"></i></button>';
    const image = item.querySelector("img") as HTMLImageElement;
    image.src = url;
    image.onclick = () => showImage(url);
    item.querySelector("button")!.onclick = () => {
      state.refs.splice(index, 1);
      save();
      RenderRefs(state, save, showImage);
    };
    Elements.Refs.appendChild(item);
  });
}

export function InitUi(
  state: State,
  save: () => void,
  renderRefs: () => void,
  renderGrid: () => void,
): void {
  fillSelect(
    Elements.Model,
    Object.keys(Models),
    (key) => Models[key as ModelId].label,
  );
  Elements.Model.value = state.model;
  Elements.Prompt.value = state.prompt;
  Elements.Stream.checked = state.stream;
  Elements.Count.textContent = String(state.count);
  RenderSeg("aspectSeg", Aspects, "aspect", state, save);
  RenderSeg("backgroundSeg", ["auto", "transparent", "opaque"], "background", state, save);
  RenderSeg("resolutionSeg", ["1K", "2K", "4K"], "resolution", state, save);
  ApplyModelUI(state, save);
  document.body.classList.toggle("collapsed", !state.panelOpen);
  AutoGrow();
  renderRefs();
  renderGrid();
}

export function SettingsLine(item: History): string {
  const model = Models[item.model];
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

function ratioCss(aspect: string): string {
  return /^\d+:\d+$/.test(aspect) ? aspect.replace(":", " / ") : "1 / 1";
}

function buttonHtml(icon: string, title: string, cls = ""): string {
  return `<button class="${cls}" data-a="${icon}" title="${title}" aria-label="${title}"><i class="bi bi-${icon}"></i></button>`;
}

export type GridActions = {
  save: () => void;
  download: (item: History) => void;
  useAsRef: (item: History) => void;
  reusePrompt: (prompt: string) => void;
  showImage: (url: string) => void;
};

export function RenderGrid(
  state: State,
  pending: Map<string, Job>,
  actions: GridActions,
): void {
  Elements.Grid.innerHTML = "";
  for (const job of pending.values()) {
    const card = document.createElement("div");
    card.className = "card";
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.style.aspectRatio = ratioCss(job.snapshot.aspect);
    if (job.status === "loading") {
      frame.innerHTML = `<div class="state"><div class="spinner"></div>Generating <span class="generating-time" data-started-at="${job.startedAt}">• ${((Date.now() - job.startedAt) / 1000).toFixed(2)}s</span></div>`;
    } else {
      frame.innerHTML =
        '<div class="state err"></div><div class="tools">' +
        buttonHtml("x-lg", "Dismiss") +
        "</div>";
      frame.querySelector(".err")!.textContent =
        job.error ?? "Generation failed";
      frame.querySelector("button")!.onclick = () => {
        pending.delete(job.id);
        RenderGrid(state, pending, actions);
      };
    }
    card.appendChild(frame);
    Elements.Grid.appendChild(card);
  }

  for (const item of state.history) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="frame"><img alt=""><div class="tools">${buttonHtml("download", "Download")}${buttonHtml("paperclip", "Use as reference")}${buttonHtml("arrow-repeat", "Reuse prompt")}${buttonHtml("trash3", "Delete", "del")}</div></div><div class="caption"><p></p><span></span><small class="cost"></small></div>`;
    const image = card.querySelector("img") as HTMLImageElement;
    image.src = item.image;
    image.onclick = () => actions.showImage(item.image);
    card.querySelector("p")!.textContent = item.prompt;
    card.querySelector("span")!.textContent = SettingsLine(item);

    const cost = card.querySelector(".cost")!;
    const costParts: string[] = [];
    if (item.cost !== null && Number.isFinite(Number(item.cost)))
      costParts.push(`$${Number(item.cost).toFixed(4)}`);
    if (item.duration !== undefined)
      costParts.push(`${(item.duration / 1000).toFixed(2)}s`);
    cost.textContent = costParts.join(" • ");
    void GetImageInfo(item.image).then((info) => {
      if (!cost.isConnected) return;
      const parts = [cost.textContent];
      if (info.bytes !== null)
        parts.push(`${(info.bytes / (1024 * 1024)).toFixed(2)}MB`);
      parts.push(`${info.width}x${info.height}`);
      cost.textContent = parts.filter(Boolean).join(" • ");
    });

    card.querySelector('[data-a="download"]')!.addEventListener("click", () => {
      actions.download(item);
    });
    card.querySelector('[data-a="paperclip"]')!.addEventListener("click", () => {
      actions.useAsRef(item);
    });
    card.querySelector('[data-a="arrow-repeat"]')!.addEventListener("click", () => {
      actions.reusePrompt(item.prompt);
    });
    card.querySelector('[data-a="trash3"]')!.addEventListener("click", () => {
      state.history = state.history.filter((entry) => entry.id !== item.id);
      actions.save();
      RenderGrid(state, pending, actions);
    });
    Elements.Grid.appendChild(card);
  }

  if (!pending.size && !state.history.length)
    Elements.Grid.innerHTML =
      '<div class="empty" style="grid-column:1/-1;min-height:50vh"><div><i class="bi bi-images"></i>Generated images will appear here</div></div>';
  Elements.Info.textContent = state.history.length
    ? `${state.history.length} saved`
    : "";
}
