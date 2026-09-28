export type Lang = 'ja' | 'en';

const LANG_KEY = 'yajirushi-ippatsu-lang';

export function getLang(): Lang {
  const v = localStorage.getItem(LANG_KEY);
  if (v === 'en' || v === 'ja') return v;
  return 'ja';
}

export function setLang(lang: Lang): void {
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
}

type Dict = Record<string, string>;

let current: Lang = getLang();

export function lang(): Lang {
  return current;
}

export function switchLang(l: Lang): void {
  current = l;
  setLang(l);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = dictionaries[current][key] ?? dictionaries.ja[key] ?? key;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(String(v)),
    raw,
  );
}

const ja: Dict = {
  appTitle: '矢印一発',
  appSub: 'スクショに矢印・枠・文字',
  open: 'スクショを開く',
  openHint: 'ギャラリーから選ぶ・共有メニューから送る・貼り付け・ドロップ',
  point1: '矢印・枠・マーカー・文字ラベルで「ここ！」を伝える',
  point2: '処理はすべてこの端末のブラウザ内',
  point3: 'PNGで保存・そのまま共有',
  select: '選択',
  arrow: '矢印',
  rect: '枠',
  hl: 'マーカー',
  text: '文字',
  color: '色',
  size: '太さ',
  undo: '元に戻す',
  delete: '削除',
  editText: '文字を編集',
  newImage: '別の画像',
  save: 'PNGで保存',
  share: '共有',
  saved: '保存しました',
  shared: '共有しました',
  shareUnsupported: 'この端末では共有できません。保存をお使いください',
  loadFailed: '画像を読み込めませんでした',
  hintSelect: 'タップで選択・ドラッグで移動',
  hintArrow: 'ドラッグで矢印を引く',
  hintRect: 'ドラッグで枠を描く',
  hintHl: 'なぞってマーカーを引く',
  hintText: '文字を置きたい場所をタップ',
  textTitle: '文字ラベル',
  textPh: '例：ここをタップ',
  ok: 'OK',
  cancel: 'キャンセル',
  confirmNew: '編集中の画像を閉じますか？',
  resized: '大きな画像のため {w}×{h} に縮小しました',
  footer: '画像はこの端末から出ません · 無料 · 広告なし · ログイン不要',
};

const en: Dict = {
  appTitle: 'Arrow Now',
  appSub: 'Mark up screenshots fast',
  open: 'Open a screenshot',
  openHint: 'Pick from gallery · share to this app · paste · drop',
  point1: 'Point things out with arrows, boxes, highlighter and labels',
  point2: 'Everything is processed in this browser, on this device',
  point3: 'Save as PNG or share straight away',
  select: 'Select',
  arrow: 'Arrow',
  rect: 'Box',
  hl: 'Marker',
  text: 'Text',
  color: 'Colour',
  size: 'Size',
  undo: 'Undo',
  delete: 'Delete',
  editText: 'Edit text',
  newImage: 'New image',
  save: 'Save PNG',
  share: 'Share',
  saved: 'Saved',
  shared: 'Shared',
  shareUnsupported: 'Sharing isn’t available here — use Save instead',
  loadFailed: 'Could not load that image',
  hintSelect: 'Tap to select · drag to move',
  hintArrow: 'Drag to draw an arrow',
  hintRect: 'Drag to draw a box',
  hintHl: 'Drag to highlight',
  hintText: 'Tap where the label should go',
  textTitle: 'Text label',
  textPh: 'e.g. Tap here',
  ok: 'OK',
  cancel: 'Cancel',
  confirmNew: 'Close the current image?',
  resized: 'Large image scaled to {w}×{h}',
  footer: 'Images never leave this device · free · no ads · no login',
};

const dictionaries: Record<Lang, Dict> = { ja, en };
