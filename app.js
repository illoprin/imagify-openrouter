
const API_URL = "https://openrouter.ai/api/v1/images";
const STORAGE_KEY = "imagify-internal-tool-v1";
const HISTORY_LIMIT = 60;
const ASPECTS = ["auto", "1:1", "2:3", "3:2", "4:3", "16:9", "9:16", "21:9"];
const BACKGROUNDS = ["auto", "transparent", "opaque"];
const QUALITIES = ["auto", "low", "medium", "high"];
const RESOLUTIONS = ["1K", "2K", "4K"];

// per-model field support
const MODELS = {
  "openai/gpt-image-2": {
    label: "GPT Image 2",
    quality: QUALITIES,
    background: true,
    resolution: false,
    stream: false,
  },
  "openai/gpt-image-2.5-sunburst": {
    label: "GPT Image 2.5 Sunburst",
    quality: [...QUALITIES, "xhigh", "max"],
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
};

const defaults = {
  apiKey: "",
  model: "openai/gpt-image-2",
  prompt: "",
  aspect: "1:1",
  count: 1,
  quality: "auto",
  background: "auto",
  resolution: "1K",
  stream: false,
  panelOpen: true,
  refs: [], // data urls
  history: [], // { id, model, prompt, settings, image, ts }
};

let state = load();
const $ = (id) => document.getElementById(id);
const el = {
  apiKey: $("apiKey"),
  model: $("model"),
  prompt: $("prompt"),
  stream: $("stream"),
  refs: $("refs"),
  file: $("file"),
  go: $("go"),
  grid: $("grid"),
  info: $("info"),
  viewer: $("viewer"),
  countVal: $("countVal"),
};
const pending = new Map(); // running or failed jobs, not persisted

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
  } catch (e) {
    return { ...defaults };
  }
}

function save() {
  // on quota errors drop oldest history entries until it fits
  for (let i = 0; i < 100; i++) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    } catch (e) {
      if (!state.history.length) break;
      state.history.pop();
    }
  }
}

// ---------- settings ui ----------

function fillSelect(sel, values, labelFn) {
  sel.innerHTML = "";
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = labelFn ? labelFn(v) : v;
    sel.appendChild(o);
  }
}

// segmented chip group bound to a state key
function renderSeg(id, values, key) {
  const box = $(id);
  box.innerHTML = "";
  for (const v of values) {
    const b = document.createElement("button");
    b.textContent = v;
    b.className = state[key] === v ? "on" : "";
    b.onclick = () => {
      state[key] = v;
      save();
      renderSeg(id, values, key);
    };
    box.appendChild(b);
  }
}

function applyModelUI() {
  const m = MODELS[state.model];
  $("qualityBox").style.display = m.quality ? "" : "none";
  $("backgroundBox").style.display = m.background ? "" : "none";
  $("resolutionBox").style.display = m.resolution ? "" : "none";
  $("streamBox").style.display = m.stream ? "" : "none";
  $("qualityDetails").style.display = m.quality || m.background ? "" : "none";
  if (m.quality) {
    if (!m.quality.includes(state.quality)) state.quality = "auto";
    renderSeg("qualitySeg", m.quality, "quality");
  }
}

function setPanel(open) {
  state.panelOpen = open;
  document.body.classList.toggle("collapsed", !open);
  save();
}

function autoGrow() {
  el.prompt.style.height = "auto";
  el.prompt.style.height = Math.min(el.prompt.scrollHeight, 200) + "px";
}

function initUI() {
  fillSelect(el.model, Object.keys(MODELS), (k) => MODELS[k].label);
  if (!MODELS[state.model]) state.model = defaults.model;
  el.apiKey.value = state.apiKey;
  el.model.value = state.model;
  el.prompt.value = state.prompt;
  el.stream.checked = state.stream;
  el.countVal.textContent = state.count;
  renderSeg("aspectSeg", ASPECTS, "aspect");
  renderSeg("backgroundSeg", BACKGROUNDS, "background");
  renderSeg("resolutionSeg", RESOLUTIONS, "resolution");
  applyModelUI();
  document.body.classList.toggle("collapsed", !state.panelOpen);
  autoGrow();
  renderRefs();
  renderGrid();
}

el.apiKey.oninput = () => {
  state.apiKey = el.apiKey.value;
  save();
};
el.model.onchange = () => {
  state.model = el.model.value;
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
$("toggle").onclick = () =>
  setPanel(document.body.classList.contains("collapsed"));
$("eye").onclick = () => {
  const show = el.apiKey.type === "password";
  el.apiKey.type = show ? "text" : "password";
  $("eye").innerHTML = `<i class="bi bi-eye${show ? "-slash" : ""}"></i>`;
};
$("dec").onclick = () => setCount(state.count - 1);
$("inc").onclick = () => setCount(state.count + 1);
function setCount(n) {
  state.count = Math.max(1, Math.min(8, n));
  el.countVal.textContent = state.count;
  save();
}

// ---------- references ----------

function fileToDownscaledDataUrl(file, maxSide = 1536) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.9));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      state.refs.push(await fileToDownscaledDataUrl(f));
    } catch (e) {
      /* skip broken file */
    }
  }
  save();
  renderRefs();
}

function renderRefs() {
  el.refs.innerHTML = "";
  state.refs.forEach((url, i) => {
    const d = document.createElement("div");
    d.className = "ref";
    d.innerHTML =
      '<img alt="reference"><button title="Remove" aria-label="Remove reference"><i class="bi bi-x"></i></button>';
    d.querySelector("img").src = url;
    d.querySelector("button").onclick = () => {
      state.refs.splice(i, 1);
      save();
      renderRefs();
    };
    el.refs.appendChild(d);
  });
}

$("attach").onclick = () => el.file.click();
el.file.onchange = () => {
  addFiles(el.file.files);
  el.file.value = "";
};
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("drop-over");
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.classList.remove("drop-over");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drop-over");
  addFiles([...e.dataTransfer.files]);
});
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

// ---------- request ----------

function buildBody(s) {
  const m = MODELS[s.model];
  const body = {
    model: s.model,
    prompt: s.prompt,
    aspect_ratio: s.aspect,
  };
  if (m.quality) body.quality = s.quality;
  if (m.background) body.background = s.background;
  if (m.resolution) body.resolution = s.resolution;
  if (m.stream && s.stream) body.stream = true;
  if (s.refs.length) {
    body.input_references = s.refs.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  }
  return body;
}

// walks any json and returns the last image found (b64 or url)
function extractImage(obj) {
  let found = null;
  (function walk(v, key) {
    if (v == null) return;
    if (typeof v === "string") {
      if (v.startsWith("data:image/")) found = v;
      else if (
        key === "b64_json" ||
        key === "image_b64" ||
        key === "partial_image_b64"
      )
        found = "data:image/png;base64," + v;
      else if ((key === "url" || key === "image_url") && /^https?:\/\//.test(v))
        found = v;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, key));
      return;
    }
    if (typeof v === "object") for (const k of Object.keys(v)) walk(v[k], k);
  })(obj, "");
  return found;
}

async function readResponse(res, streaming) {
  const ctype = res.headers.get("content-type") || "";
  if (streaming && ctype.includes("text/event-stream")) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "",
      last = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (j.error)
            throw new Error(j.error.message || JSON.stringify(j.error));
          last = extractImage(j) || last;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    if (!last) throw new Error("stream finished without an image");
    return last;
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(text.slice(0, 500) || "empty response");
  }
  if (!res.ok || json.error)
    throw new Error(
      json.error?.message || `HTTP ${res.status}\n${text.slice(0, 500)}`,
    );
  const img = extractImage(json);
  if (!img) throw new Error("no image in response:\n" + text.slice(0, 500));
  return img;
}

async function generateOne(snapshot) {
  const body = buildBody(snapshot);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Imagify Internal Tool",
    },
    body: JSON.stringify(body),
  });
  return readResponse(res, !!body.stream);
}

async function run() {
  if (!state.apiKey.trim()) {
    setPanel(true);
    el.apiKey.focus();
    return;
  }
  if (!state.prompt.trim()) {
    el.prompt.focus();
    return;
  }

  const snapshot = {
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

  const jobs = [];
  for (let i = 0; i < state.count; i++) {
    const id =
      Date.now() + "-" + i + "-" + Math.random().toString(36).slice(2, 6);
    pending.set(id, { id, snapshot, status: "loading" });
    jobs.push(id);
  }
  renderGrid();

  await Promise.all(
    jobs.map(async (id) => {
      try {
        const image = await generateOne(snapshot);
        pending.delete(id);
        state.history.unshift({
          id,
          ts: Date.now(),
          model: snapshot.model,
          prompt: snapshot.prompt,
          image,
          settings: {
            aspect: snapshot.aspect,
            quality: snapshot.quality,
            background: snapshot.background,
            resolution: snapshot.resolution,
            refs: snapshot.refs.length,
          },
        });
      } catch (e) {
        const p = pending.get(id);
        p.status = "error";
        p.error = e.message || String(e);
      }
      state.history = state.history.slice(0, HISTORY_LIMIT);
      save();
      renderGrid();
    }),
  );

  el.go.disabled = false;
}

// ---------- gallery ----------

function settingsLine(h) {
  const m = MODELS[h.model],
    s = h.settings;
  const parts = [m?.label || h.model, s.aspect];
  if (m?.quality) parts.push(s.quality);
  if (m?.background && s.background !== "auto") parts.push(s.background);
  if (m?.resolution) parts.push(s.resolution);
  if (s.refs) parts.push(s.refs + (s.refs > 1 ? " refs" : " ref"));
  return parts.join(" · ");
}

function ratioCss(a) {
  return /^\d+:\d+$/.test(a) ? a.replace(":", " / ") : "1 / 1";
}

function toolBtn(icon, title, cls) {
  return `<button class="${cls || ""}" data-a="${icon}" title="${title}" aria-label="${title}"><i class="bi bi-${icon}"></i></button>`;
}

function renderGrid() {
  el.grid.innerHTML = "";

  for (const p of pending.values()) {
    const c = document.createElement("div");
    c.className = "card";
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.style.aspectRatio = ratioCss(p.snapshot.aspect);
    if (p.status === "loading") {
      frame.innerHTML =
        '<div class="state"><div class="spinner"></div>Generating</div>';
    } else {
      frame.innerHTML =
        '<div class="state err"></div><div class="tools">' +
        toolBtn("x-lg", "Dismiss") +
        "</div>";
      frame.querySelector(".err").textContent = p.error;
      frame.querySelector("button").onclick = () => {
        pending.delete(p.id);
        renderGrid();
      };
    }
    c.appendChild(frame);
    el.grid.appendChild(c);
  }

  for (const h of state.history) {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div class="frame">
        <img alt="">
        <div class="tools">
          ${toolBtn("download", "Download")}
          ${toolBtn("paperclip", "Use as reference")}
          ${toolBtn("arrow-repeat", "Reuse prompt")}
          ${toolBtn("trash3", "Delete", "del")}
        </div>
      </div>
      <div class="caption"><p></p><span></span></div>`;
    const img = c.querySelector("img");
    img.src = h.image;
    img.onclick = () => {
      el.viewer.querySelector("img").src = h.image;
      el.viewer.classList.add("open");
    };
    c.querySelector("p").textContent = h.prompt;
    c.querySelector("span").textContent = settingsLine(h);
    c.querySelector("[data-a=download]").onclick = () => download(h);
    c.querySelector("[data-a=paperclip]").onclick = () => useAsRef(h);
    c.querySelector("[data-a=arrow-repeat]").onclick = () => {
      state.prompt = h.prompt;
      el.prompt.value = h.prompt;
      autoGrow();
      save();
      el.prompt.focus();
    };
    c.querySelector("[data-a=trash3]").onclick = () => {
      state.history = state.history.filter((x) => x.id !== h.id);
      save();
      renderGrid();
    };
    el.grid.appendChild(c);
  }

  if (!pending.size && !state.history.length) {
    el.grid.innerHTML =
      '<div class="empty" style="grid-column:1/-1;min-height:50vh"><div><i class="bi bi-images"></i>Generated images will appear here</div></div>';
  }
  el.info.textContent = state.history.length
    ? `${state.history.length} saved`
    : "";
}

async function download(h) {
  try {
    let href = h.image;
    if (!href.startsWith("data:"))
      href = URL.createObjectURL(await (await fetch(href)).blob());
    const a = document.createElement("a");
    a.href = href;
    a.download = `${h.model.replace("/", "_")}-${h.ts}.png`;
    a.click();
  } catch (e) {
    window.open(h.image, "_blank");
  }
}

async function useAsRef(h) {
  try {
    const blob = await (await fetch(h.image)).blob();
    await addFiles([
      new File([blob], "ref.png", { type: blob.type || "image/png" }),
    ]);
  } catch (e) {
    alert("Could not load this image as a reference (cross-origin url).");
  }
}

el.go.onclick = run;
$("clear").onclick = () => {
  if (state.history.length && confirm("Delete all saved images?")) {
    state.history = [];
    save();
    renderGrid();
  }
};
el.viewer.onclick = () => el.viewer.classList.remove("open");
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") el.viewer.classList.remove("open");
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !el.go.disabled) run();
});

initUI();
