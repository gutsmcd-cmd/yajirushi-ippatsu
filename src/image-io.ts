/** Shared image helpers: load files, share-target pickup, export. All local. */

export const MAX_DIM = 4096;

export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('decode'));
        i.src = url;
      });
      source = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  if (!w || !h) throw new Error('empty');
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  if ('close' in source && typeof (source as ImageBitmap).close === 'function') (source as ImageBitmap).close();
  return c;
}

/** If the app was opened via the Web Share Target, return the shared file (and clear it). */
export async function takeSharedFile(): Promise<File | null> {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open('share-target');
    const res = await cache.match('shared-image');
    if (!res) return null;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-filename') || 'shared-image');
    await cache.delete('shared-image');
    return new File([blob], name, { type: blob.type || 'image/png' });
  } catch {
    return null;
  }
}

/** Re-encode a canvas. Canvas encoding never carries EXIF/GPS metadata. */
export function canvasToBlob(src: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Blob> {
  let c = src;
  if (type === 'image/jpeg') {
    // JPEG has no alpha: flatten onto white so transparent areas don't turn black.
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
  }
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, quality);
  });
}

export function baseName(name: string): string {
  const n = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return n || 'image';
}

export async function shareFile(file: File, title: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) return 'unsupported';
  try {
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}
