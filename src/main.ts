import './style.css';
import { lang, switchLang, t, type Lang } from './i18n';
import { baseName, canvasToBlob, fileToCanvas, MAX_DIM, shareFile, takeSharedFile } from './image-io';
import { closeSheet, downloadBlob, esc, openSheet, registerPwa, showToast, uid } from './ui';

type Tool = 'select' | 'arrow' | 'rect' | 'hl' | 'text';
type Kind = Exclude<Tool, 'select'>;

interface Shape {
  id: string;
  kind: Kind;
  color: string;
  size: number; // 0,1,2 = S,M,L
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  pts?: number[]; // highlighter polyline (flat x,y)
  text?: string;
}

interface Prefs {
  tool: Tool;
  color: string;
  size: number;
}

const COLORS = ['#FF3B30', '#FFCC00', '#0A84FF', '#34C759', '#FFFFFF', '#111111'];
const PREFS_KEY = 'yajirushi-ippatsu:prefs';
const app = document.querySelector<HTMLDivElement>('#app')!;

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>;
    return {
      tool: p.tool && ['select', 'arrow', 'rect', 'hl', 'text'].includes(p.tool) ? p.tool : 'arrow',
      color: p.color && COLORS.includes(p.color) ? p.color : COLORS[0]!,
      size: typeof p.size === 'number' && p.size >= 0 && p.size <= 2 ? p.size : 1,
    };
  } catch {
    return { tool: 'arrow', color: COLORS[0]!, size: 1 };
  }
}
const prefs = loadPrefs();
function savePrefs(): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

let base: HTMLCanvasElement | null = null;
let view: HTMLCanvasElement | null = null;
let shapes: Shape[] = [];
let history: string[] = [];
let selectedId: string | null = null;
let fileName = 'screenshot';
let rafPending = false;

type Gesture =
  | { type: 'draw'; id: number; shape: Shape }
  | { type: 'move'; id: number; shape: Shape; lastX: number; lastY: number; moved: boolean; before: string };
let gesture: Gesture | null = null;

// ---------- geometry ----------
function unit(): number {
  return base ? Math.max(base.width, base.height) / 1000 : 1;
}
function strokeW(size: number): number {
  return unit() * [3.5, 6, 10][size]!;
}
function fontPx(size: number): number {
  return Math.round(unit() * [26, 40, 60][size]!);
}
function cssToImage(): number {
  if (!view) return 1;
  const r = view.getBoundingClientRect();
  return r.width ? view.width / r.width : 1;
}
function toImage(e: PointerEvent): { x: number; y: number } {
  const r = view!.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * view!.width,
    y: ((e.clientY - r.top) / r.height) * view!.height,
  };
}

function textColorFor(bg: string): string {
  return ['#FFCC00', '#FFFFFF', '#34C759'].includes(bg) ? '#111111' : '#FFFFFF';
}

function textBox(ctx: CanvasRenderingContext2D, s: Shape): { x: number; y: number; w: number; h: number; lines: string[]; fs: number; pad: number } {
  const fs = fontPx(s.size);
  ctx.font = `800 ${fs}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif`;
  const lines = (s.text || '').split('\n');
  const pad = fs * 0.45;
  const lh = fs * 1.25;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lh + pad * 1.2;
  return { x: s.x1, y: s.y1, w, h, lines, fs, pad };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function bbox(s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.kind === 'text') {
    measureCtx ??= document.createElement('canvas').getContext('2d')!;
    const b = textBox(measureCtx, s);
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  if (s.kind === 'hl' && s.pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.pts.length; i += 2) {
      x0 = Math.min(x0, s.pts[i]!);
      x1 = Math.max(x1, s.pts[i]!);
      y0 = Math.min(y0, s.pts[i + 1]!);
      y1 = Math.max(y1, s.pts[i + 1]!);
    }
    const pad = strokeW(s.size) * 2;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }
  const x = Math.min(s.x1, s.x2);
  const y = Math.min(s.y1, s.y2);
  return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let tt = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  tt = Math.max(0, Math.min(1, tt));
  return Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy));
}

function hitTest(x: number, y: number): Shape | null {
  const tol = 16 * cssToImage();
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    const sw = strokeW(s.size);
    if (s.kind === 'arrow' && distSeg(x, y, s.x1, s.y1, s.x2, s.y2) < tol + sw) return s;
    if (s.kind === 'rect') {
      const b = bbox(s);
      const inside = x > b.x - tol && x < b.x + b.w + tol && y > b.y - tol && y < b.y + b.h + tol;
      const nearEdge = x < b.x + tol + sw || x > b.x + b.w - tol - sw || y < b.y + tol + sw || y > b.y + b.h - tol - sw;
      if (inside && nearEdge) return s;
    }
    if (s.kind === 'hl' && s.pts) {
      for (let k = 0; k + 3 < s.pts.length; k += 2) {
        if (distSeg(x, y, s.pts[k]!, s.pts[k + 1]!, s.pts[k + 2]!, s.pts[k + 3]!) < tol + sw * 2) return s;
      }
    }
    if (s.kind === 'text') {
      const b = bbox(s);
      if (x > b.x - tol && x < b.x + b.w + tol && y > b.y - tol && y < b.y + b.h + tol) return s;
    }
  }
  return null;
}

// ---------- drawing ----------
function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  const sw = strokeW(s.size);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.kind !== 'hl') {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = sw * 1.2;
    ctx.shadowOffsetY = sw * 0.25;
  }
  if (s.kind === 'arrow') {
    const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const head = Math.min(Math.max(sw * 4.2, unit() * 14), len * 0.6);
    const spread = 0.48;
    const bx = s.x2 - Math.cos(ang) * head * 0.8;
    const by = s.y2 - Math.sin(ang) * head * 0.8;
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(ang - spread), s.y2 - head * Math.sin(ang - spread));
    ctx.lineTo(s.x2 - head * Math.cos(ang + spread), s.y2 - head * Math.sin(ang + spread));
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = sw * 0.5;
    ctx.stroke();
  } else if (s.kind === 'rect') {
    const b = bbox(s);
    ctx.lineWidth = sw;
    ctx.beginPath();
    const r = Math.min(sw * 1.5, b.w / 2, b.h / 2);
    if (typeof ctx.roundRect === 'function') ctx.roundRect(b.x, b.y, b.w, b.h, r);
    else ctx.rect(b.x, b.y, b.w, b.h);
    ctx.stroke();
  } else if (s.kind === 'hl' && s.pts && s.pts.length >= 2) {
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = sw * 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.pts[0]!, s.pts[1]!);
    if (s.pts.length === 2) ctx.lineTo(s.pts[0]! + 0.1, s.pts[1]!);
    for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i]!, s.pts[i + 1]!);
    ctx.stroke();
  } else if (s.kind === 'text') {
    const b = textBox(ctx, s);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(b.x, b.y, b.w, b.h, b.fs * 0.35);
    else ctx.rect(b.x, b.y, b.w, b.h);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = textColorFor(s.color);
    ctx.textBaseline = 'middle';
    const lh = b.fs * 1.25;
    b.lines.forEach((line, i) => {
      ctx.fillText(line, b.x + b.pad, b.y + b.pad * 0.6 + lh * (i + 0.5));
    });
  }
  ctx.restore();
}

function renderTo(ctx: CanvasRenderingContext2D, withSelection: boolean): void {
  if (!base) return;
  ctx.clearRect(0, 0, base.width, base.height);
  ctx.drawImage(base, 0, 0);
  for (const s of shapes) drawShape(ctx, s);
  const g = gesture;
  if (g && g.type === 'draw') drawShape(ctx, g.shape);
  if (withSelection && selectedId) {
    const s = shapes.find((x) => x.id === selectedId);
    if (s) {
      const k = cssToImage();
      const b = bbox(s);
      const pad = 8 * k + (s.kind === 'text' ? 0 : strokeW(s.size) / 2);
      ctx.save();
      ctx.lineWidth = 2 * k;
      ctx.setLineDash([6 * k, 5 * k]);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.lineDashOffset = 5.5 * k;
      ctx.strokeStyle = '#ffb020';
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }
  }
}

function paint(): void {
  if (!view) return;
  renderTo(view.getContext('2d')!, true);
}
function schedulePaint(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    paint();
  });
}

// ---------- history ----------
function snapshot(): string {
  return JSON.stringify(shapes);
}
function pushHistory(before: string): void {
  history.push(before);
  if (history.length > 100) history.shift();
  syncButtons();
}
function undo(): void {
  const prev = history.pop();
  if (prev === undefined) return;
  shapes = JSON.parse(prev) as Shape[];
  if (selectedId && !shapes.some((s) => s.id === selectedId)) selectedId = null;
  syncButtons();
  paint();
}

function selected(): Shape | null {
  return shapes.find((s) => s.id === selectedId) ?? null;
}

// ---------- text ----------
function textSheet(initial: string, onOk: (text: string) => void): void {
  const sheet = openSheet(`
    <h2>${t('textTitle')}</h2>
    <textarea id="tx" rows="3" maxlength="200" placeholder="${esc(t('textPh'))}">${esc(initial)}</textarea>
    <div class="actions">
      <button type="button" class="btn" data-s="cancel">${t('cancel')}</button>
      <button type="button" class="btn primary" data-s="ok">${t('ok')}</button>
    </div>`);
  const ta = sheet.querySelector<HTMLTextAreaElement>('#tx')!;
  window.setTimeout(() => {
    ta.focus();
    ta.select();
  }, 60);
  sheet.addEventListener('click', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>('[data-s]')?.dataset.s;
    if (s === 'cancel') closeSheet();
    if (s === 'ok') {
      const v = ta.value.replace(/\s+$/, '');
      closeSheet();
      if (v.trim()) onOk(v);
    }
  });
}

// ---------- pointer ----------
function bindCanvas(c: HTMLCanvasElement): void {
  c.addEventListener('pointerdown', (e) => {
    if (gesture) return;
    e.preventDefault();
    const p = toImage(e);
    const hit = prefs.tool === 'select' ? hitTest(p.x, p.y) : null;
    if (prefs.tool === 'select') {
      if (hit) {
        selectedId = hit.id;
        c.setPointerCapture(e.pointerId);
        gesture = { type: 'move', id: e.pointerId, shape: hit, lastX: p.x, lastY: p.y, moved: false, before: snapshot() };
      } else {
        selectedId = null;
      }
      syncButtons();
      paint();
      return;
    }
    if (prefs.tool === 'text') {
      textSheet('', (text) => {
        const before = snapshot();
        const s: Shape = { id: uid(), kind: 'text', color: prefs.color, size: prefs.size, x1: p.x, y1: p.y, x2: p.x, y2: p.y, text };
        // centre the label on the tap point and keep it inside the image
        const b = bbox(s);
        const W = base!.width;
        const H = base!.height;
        const m = unit() * 6;
        s.x1 = Math.max(m, Math.min(W - b.w - m, p.x - b.w / 2));
        s.y1 = Math.max(m, Math.min(H - b.h - m, p.y - b.h / 2));
        s.x2 = s.x1;
        s.y2 = s.y1;
        shapes.push(s);
        selectedId = s.id;
        pushHistory(before);
        paint();
      });
      return;
    }
    c.setPointerCapture(e.pointerId);
    const s: Shape = {
      id: uid(),
      kind: prefs.tool,
      color: prefs.color,
      size: prefs.size,
      x1: p.x,
      y1: p.y,
      x2: p.x,
      y2: p.y,
      pts: prefs.tool === 'hl' ? [p.x, p.y] : undefined,
    };
    gesture = { type: 'draw', id: e.pointerId, shape: s };
  });
  c.addEventListener('pointermove', (e) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    const p = toImage(e);
    if (g.type === 'draw') {
      g.shape.x2 = p.x;
      g.shape.y2 = p.y;
      if (g.shape.pts) {
        const n = g.shape.pts.length;
        const lx = g.shape.pts[n - 2]!;
        const ly = g.shape.pts[n - 1]!;
        if (Math.hypot(p.x - lx, p.y - ly) > 2 * cssToImage()) g.shape.pts.push(p.x, p.y);
      }
    } else {
      const dx = p.x - g.lastX;
      const dy = p.y - g.lastY;
      g.lastX = p.x;
      g.lastY = p.y;
      if (dx || dy) g.moved = true;
      const s = g.shape;
      s.x1 += dx;
      s.y1 += dy;
      s.x2 += dx;
      s.y2 += dy;
      if (s.pts) s.pts = s.pts.map((v, i) => v + (i % 2 ? dy : dx));
    }
    schedulePaint();
  });
  const end = (e: PointerEvent) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    gesture = null;
    if (g.type === 'draw') {
      const s = g.shape;
      const k = cssToImage();
      const big = s.kind === 'hl' ? (s.pts?.length ?? 0) >= 2 : Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 12 * k;
      const okRect = s.kind !== 'rect' || (Math.abs(s.x2 - s.x1) > 8 * k && Math.abs(s.y2 - s.y1) > 8 * k);
      if (big && okRect) {
        const before = snapshot();
        shapes.push(s);
        selectedId = s.id;
        pushHistory(before);
      }
    } else if (g.moved) {
      pushHistory(g.before);
    }
    syncButtons();
    paint();
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

// ---------- load / export ----------
async function loadFile(file: Blob, name = 'screenshot'): Promise<void> {
  if (file.type && !file.type.startsWith('image/')) {
    showToast(t('loadFailed'));
    return;
  }
  try {
    base = await fileToCanvas(file);
    shapes = [];
    history = [];
    selectedId = null;
    fileName = baseName(name);
    render();
    if (Math.max(base.width, base.height) === MAX_DIM) showToast(t('resized', { w: base.width, h: base.height }));
  } catch {
    showToast(t('loadFailed'));
  }
}

function openPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void loadFile(f, f.name);
  });
  input.click();
}

async function exportPng(): Promise<File | null> {
  if (!base) return null;
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  renderTo(c.getContext('2d')!, false);
  const blob = await canvasToBlob(c, 'image/png');
  return new File([blob], `${fileName}-annotated.png`, { type: 'image/png' });
}

// ---------- UI ----------
const ICONS: Record<Tool, string> = {
  select: '<path d="M6 3l12 9-5.5 1L15 19l-2.5 1.2L10 14.4 6 18z" fill="currentColor"/>',
  arrow: '<path d="M5 19L18 6M18 6h-8M18 6v8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  hl: '<path d="M4 17c4-1 6-6 9-6s3 4 7 3" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".55"/><path d="M4 17c4-1 6-6 9-6s3 4 7 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  text: '<path d="M5 6h14M12 6v13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
};

function hintFor(tool: Tool): string {
  return t({ select: 'hintSelect', arrow: 'hintArrow', rect: 'hintRect', hl: 'hintHl', text: 'hintText' }[tool]);
}

function headerHtml(): string {
  const l = lang();
  return `
  <header>
    <div class="header-row">
      <div class="titles">
        <img class="logo" src="./icons/icon-192.png" alt="" />
        <div>
          <h1>${t('appTitle')}</h1>
          <p class="sub">${t('appSub')}</p>
        </div>
      </div>
      <div class="lang-toggle" role="group" aria-label="Language">
        <button type="button" data-lang="ja" class="${l === 'ja' ? 'active' : ''}">日本語</button>
        <button type="button" data-lang="en" class="${l === 'en' ? 'active' : ''}">English</button>
      </div>
    </div>
  </header>`;
}

function render(): void {
  if (!base) {
    view = null;
    app.innerHTML = `
      ${headerHtml()}
      <main class="landing">
        <button type="button" class="drop card" data-open>
          <span class="drop-art" aria-hidden="true"><img src="./icons/icon-192.png" alt="" /></span>
          <span class="btn primary big">${t('open')}</span>
          <span class="muted small">${t('openHint')}</span>
        </button>
        <ul class="points">
          <li><span>➡️</span>${t('point1')}</li>
          <li><span>📱</span>${t('point2')}</li>
          <li><span>🖼️</span>${t('point3')}</li>
        </ul>
      </main>
      <footer class="note">${t('footer')}</footer>`;
    return;
  }
  const tools: Tool[] = ['select', 'arrow', 'rect', 'hl', 'text'];
  app.innerHTML = `
    ${headerHtml()}
    <main class="editor">
      <div class="stage"><canvas id="view"></canvas></div>
      <p class="hint" id="hint">${hintFor(prefs.tool)}</p>
      <section class="panel card">
        <div class="tools" role="toolbar">
          ${tools
            .map(
              (tl) => `<button type="button" class="tool ${prefs.tool === tl ? 'active' : ''}" data-tool="${tl}" aria-pressed="${prefs.tool === tl}">
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${ICONS[tl]}</svg><span>${t(tl)}</span></button>`,
            )
            .join('')}
        </div>
        <div class="row between">
          <div class="swatches" role="group" aria-label="${t('color')}">
            ${COLORS.map((c) => `<button type="button" class="swatch ${prefs.color === c ? 'active' : ''}" data-color="${c}" style="--sw:${c}" aria-label="${c}"></button>`).join('')}
          </div>
          <div class="seg-group sizes" role="group" aria-label="${t('size')}">
            ${['S', 'M', 'L'].map((l, i) => `<button type="button" class="seg ${prefs.size === i ? 'active' : ''}" data-size="${i}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="row">
          <button type="button" class="btn small" data-undo>↶ ${t('undo')}</button>
          <button type="button" class="btn small danger" data-delete>🗑 ${t('delete')}</button>
          <button type="button" class="btn small" data-edit-text>✎ ${t('editText')}</button>
          <span class="spacer"></span>
          <button type="button" class="btn small ghost" data-new>${t('newImage')}</button>
        </div>
      </section>
      <section class="export">
        <button type="button" class="btn" data-share>${t('share')}</button>
        <button type="button" class="btn primary grow" data-save>⬇ ${t('save')}</button>
      </section>
    </main>
    <footer class="note">${t('footer')}</footer>`;
  view = app.querySelector<HTMLCanvasElement>('#view')!;
  view.width = base.width;
  view.height = base.height;
  bindCanvas(view);
  syncButtons();
  paint();
}

function syncButtons(): void {
  const sel = selected();
  const q = <T extends HTMLElement>(s: string) => app.querySelector<T>(s);
  const undoB = q<HTMLButtonElement>('[data-undo]');
  if (undoB) undoB.disabled = !history.length;
  const delB = q<HTMLButtonElement>('[data-delete]');
  if (delB) delB.disabled = !sel;
  const edB = q<HTMLButtonElement>('[data-edit-text]');
  if (edB) edB.hidden = !(sel && sel.kind === 'text');
}

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const l = target.closest<HTMLElement>('[data-lang]')?.dataset.lang as Lang | undefined;
  if (l) {
    switchLang(l);
    render();
    return;
  }
  if (target.closest('[data-open]')) return openPicker();
  const tool = target.closest<HTMLElement>('[data-tool]')?.dataset.tool as Tool | undefined;
  if (tool) {
    prefs.tool = tool;
    savePrefs();
    // switching to a drawing tool starts fresh: colour/size now apply to the next shape
    if (tool !== 'select' && selectedId) {
      selectedId = null;
      syncButtons();
      paint();
    }
    app.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    const h = app.querySelector('#hint');
    if (h) h.textContent = hintFor(tool);
    return;
  }
  const color = target.closest<HTMLElement>('[data-color]')?.dataset.color;
  if (color) {
    prefs.color = color;
    savePrefs();
    app.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.classList.toggle('active', b.dataset.color === color));
    const s = selected();
    if (s && s.color !== color) {
      pushHistory(snapshot());
      s.color = color;
      paint();
    }
    return;
  }
  const size = target.closest<HTMLElement>('[data-size]')?.dataset.size;
  if (size !== undefined) {
    prefs.size = Number(size);
    savePrefs();
    app.querySelectorAll<HTMLElement>('[data-size]').forEach((b) => b.classList.toggle('active', b.dataset.size === size));
    const s = selected();
    if (s && s.size !== prefs.size) {
      pushHistory(snapshot());
      s.size = prefs.size;
      paint();
    }
    return;
  }
  if (target.closest('[data-undo]')) return undo();
  if (target.closest('[data-delete]')) {
    const s = selected();
    if (!s) return;
    pushHistory(snapshot());
    shapes = shapes.filter((x) => x !== s);
    selectedId = null;
    syncButtons();
    paint();
    return;
  }
  if (target.closest('[data-edit-text]')) {
    const s = selected();
    if (!s || s.kind !== 'text') return;
    textSheet(s.text || '', (text) => {
      pushHistory(snapshot());
      s.text = text;
      paint();
    });
    return;
  }
  if (target.closest('[data-new]')) {
    if (shapes.length && !confirm(t('confirmNew'))) return;
    openPicker();
    return;
  }
  if (target.closest('[data-save]')) {
    void exportPng().then((f) => {
      if (!f) return;
      downloadBlob(f, f.name);
      showToast(t('saved'));
    });
    return;
  }
  if (target.closest('[data-share]')) {
    void exportPng().then(async (f) => {
      if (!f) return;
      const r = await shareFile(f, t('appTitle'));
      if (r === 'shared') showToast(t('shared'));
      if (r === 'unsupported') showToast(t('shareUnsupported'));
    });
  }
});

window.addEventListener('paste', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('textarea,input')) return;
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) {
    e.preventDefault();
    void loadFile(f, f.name || 'pasted');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = Array.from(e.dataTransfer?.files ?? []).find((x) => x.type.startsWith('image/'));
  if (f) void loadFile(f, f.name);
});
window.addEventListener('keydown', (e) => {
  if (document.querySelector('.overlay')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
    const s = selected();
    if (!s) return;
    pushHistory(snapshot());
    shapes = shapes.filter((x) => x !== s);
    selectedId = null;
    syncButtons();
    paint();
  }
});

document.documentElement.lang = lang();
render();
void takeSharedFile().then((f) => {
  if (f) void loadFile(f, f.name);
});
registerPwa();
