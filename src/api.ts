import { API, Models, type Snapshot } from "./config";

export function BuildBody(snapshot: Snapshot): Record<string, unknown> {
  const model = Models[snapshot.model];
  const body: Record<string, unknown> = {
    model: snapshot.model,
    prompt: snapshot.prompt,
    aspect_ratio: snapshot.aspect,
  };
  if (model.quality) body.quality = snapshot.quality;
  if (model.background) body.background = snapshot.background;
  if (model.resolution) body.resolution = snapshot.resolution;
  if (model.stream && snapshot.stream) body.stream = true;
  if (snapshot.refs.length)
    body.input_references = snapshot.refs.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  return body;
}

export function ExtractImage(value: unknown): string | null {
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

export async function ReadResponse(
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
          image = ExtractImage(json) ?? image;
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
  const image = ExtractImage(json);
  if (!image) throw new Error(`No image in response: ${text.slice(0, 500)}`);
  return { image, cost: json.usage?.cost ?? json.cost ?? null };
}

export async function GenerateOne(
  snapshot: Snapshot,
  apiKey: string,
): Promise<{ image: string; cost: number | null }> {
  const body = BuildBody(snapshot);
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
  return ReadResponse(response, Boolean(body.stream));
}
