// Компресиране на снимки преди запис: по-малък размер, JPEG.
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

function toBlob(src, maxSide, quality) {
  const w0 = src.width, h0 = src.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("Снимката не може да се обработи."))), "image/jpeg", quality));
}

export async function compressPhoto(file, cfg) {
  const src = await decode(file);
  const blob = await toBlob(src, cfg.photoMaxSide, cfg.photoQuality);
  const thumb = await toBlob(src, cfg.thumbMaxSide, 0.72);
  if (src.close) src.close();
  return { blob, thumb };
}

export async function makeThumb(blob, cfg) {
  const src = await decode(blob);
  const thumb = await toBlob(src, cfg.thumbMaxSide, 0.72);
  if (src.close) src.close();
  return thumb;
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

export async function dataURLToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}
