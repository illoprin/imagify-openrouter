export type ImageInfo = {
  bytes: number | null;
  width: number;
  height: number;
};

const imageInfoCache = new Map<string, Promise<ImageInfo>>();

export function FileToDataUrl(file: File, maxSide = 1536): Promise<string> {
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

export function GetImageInfo(url: string): Promise<ImageInfo> {
  const cached = imageInfoCache.get(url);
  if (cached) return cached;

  const info = new Promise<ImageInfo>((resolve) => {
    const image = new Image();
    image.onload = async () => {
      let bytes: number | null = null;
      try {
        bytes = (await (await fetch(url)).blob()).size;
      } catch {
        // keep the dimensions when cross-origin fetching is blocked
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
