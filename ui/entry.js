/**
 * wasm-artcraft: Word, Excel and PDF files beside the chat (contract oriso-addon/v1).
 *
 * The web app shows this app as a button in the case header, next to the call buttons
 * (slot consultant.session), and in the chat menu. It opens a side panel with:
 *  - a smart menu: Text (WordCraft), Tabelle (GridCraft), PDF (PdfCraft), "Datei öffnen";
 *  - the editor in three sizes (side panel, beside the chat, full screen), with zoom, or in its
 *    own tab (ui/tab.html) whose saves come back here;
 *  - the Ablage: every save becomes a version the person drags (or puts) into the chat.
 *
 * The editors run as WebAssembly in an iframe below this add-on's /ui/craft/ path, on the web
 * app's own origin, and talk to the panel through their postMessage bridge
 * (`<app>:ready|open|save|dirty|failed`). A document only ever lives in this browser tab: it
 * comes in as a dropped file or a decrypted chat attachment and leaves through the chat's own
 * upload, which encrypts it. Nothing is sent to the add-on's server.
 */

const EDITORS = [
	{ id: 'wordcraft', extensions: ['.docx', '.doc', '.odt', '.rtf', '.txt', '.md', '.html'], blank: true },
	{ id: 'gridcraft', extensions: ['.xlsx', '.xls', '.ods', '.csv'], blank: true },
	{ id: 'pdfcraft', extensions: ['.pdf'], blank: false }
];

/** MIME types the chat accepts as attachments (ORISO-Frontend attachmentHelpers). */
const TYPES = {
	'.pdf': 'application/pdf',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const CHAT_MAX_BYTES = 10 * 1024 * 1024;
/** In the large window the chat keeps at least this much room on the left. */
const CHAT_MIN_WIDTH = 380;

const ICONS = {
	wordcraft:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 12h6M10 15.5h6M10 19h4"/></svg>',
	gridcraft:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 15h16M10 4v16"/></svg>',
	pdfcraft:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9.5 17.5c2-4.5 3-7 3-8.5 0-1-1-1-1 0 0 2.5 3.5 6 6 6.5"/></svg>',
	back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
	panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
	wide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/></svg>',
	full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
	zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12"/></svg>',
	zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>',
	tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
};

const TEXTS = {
	de: {
		editors: { wordcraft: 'Text', gridcraft: 'Tabelle', pdfcraft: 'PDF' },
		engines: { wordcraft: 'WordCraft · .docx', gridcraft: 'GridCraft · .xlsx', pdfcraft: 'PdfCraft · .pdf' },
		menuLabel: 'Werkzeuge',
		open: 'Datei öffnen',
		blankHint: 'Leer beginnen oder Anhang hierher ziehen',
		pdfHint: 'Anhang hierher ziehen oder Datei öffnen',
		hint: (f) =>
			f
				? 'Ziehen Sie einen Anhang aus dem Chat auf ein Werkzeug (vorher „Prüfen“ bzw. „Entschlüsseln“ klicken).'
				: 'Zieh einen Anhang aus dem Chat auf ein Werkzeug (vorher „Prüfen“ bzw. „Entschlüsseln“ klicken).',
		dropHere: 'Hier ablegen, um zu öffnen',
		back: 'Werkzeuge',
		modes: { panel: 'Seitenpanel', wide: 'Neben dem Chat', full: 'Vollbild' },
		modesLabel: 'Größe',
		zoomOut: 'Verkleinern',
		zoomIn: 'Vergrößern',
		zoomReset: 'Zoom zurücksetzen',
		tab: 'In neuem Tab öffnen',
		tabRunning: (name) => `„${name}“ ist in einem eigenen Tab geöffnet. Was Sie dort speichern, landet hier in der Ablage.`,
		tabBack: 'Hier weiterarbeiten',
		tabBlocked: 'Der Browser hat den neuen Tab blockiert. Bitte Pop-ups für ORISO erlauben.',
		saveFirst: 'Bitte zuerst speichern (Strg+S), dann im neuen Tab öffnen.',
		tray: 'Ablage',
		trayHint: (f) => (f ? 'Jedes Speichern legt hier eine Version ab. Ziehen Sie sie in den Chat.' : 'Jedes Speichern legt hier eine Version ab. Zieh sie in den Chat.'),
		trayEmpty: 'Noch nichts gespeichert. Im Programm mit Strg+S oder „Datei › Speichern“ speichern.',
		version: (n, time) => `Version ${n} · ${time}`,
		putInChat: 'In Chat legen',
		reopen: 'Öffnen',
		tooBig: 'Zu groß für den Chat (höchstens 10 MB)',
		notForChat: 'Der Chat nimmt nur PDF, DOCX und XLSX an',
		stateNew: 'Neu',
		stateOpen: 'Geöffnet',
		stateDirty: 'Ungespeichert',
		stateSaved: (n) => `Gespeichert · Version ${n}`,
		saved: (name, n, f) =>
			f
				? `Version ${n} von „${name}“ liegt in der Ablage. Ziehen Sie sie in den Chat, damit die nächste Person weiterarbeiten kann.`
				: `Version ${n} von „${name}“ liegt in der Ablage. Zieh sie in den Chat, damit die nächste Person weiterarbeiten kann.`,
		discard: 'Ungespeicherte Änderungen gehen verloren. Trotzdem fortfahren?',
		leftDirty: 'Das Dokument hatte ungespeicherte Änderungen; sie wurden verworfen.',
		failed: (e) => `Das Programm konnte nicht starten (${e}). Es braucht einen Browser mit WebGL2 oder WebGPU.`,
		unsupported: (name) => `„${name}“ kann hier nicht geöffnet werden.`,
		unreadable: 'Der Anhang konnte nicht gelesen werden. Bitte im Chat zuerst „Prüfen“ bzw. „Entschlüsseln“ klicken.',
		noChatDrop: 'Der Chat nimmt gerade keine Datei an. Bitte die Datei mit der Maus in den Chat ziehen.',
		inChat: 'Die Datei liegt im Eingabefeld des Chats. „Senden“ verschlüsselt und verschickt sie.',
		privacy: 'Dateien bleiben in diesem Browserfenster und werden nur verschlüsselt über den Chat geteilt.',
		frameTitle: (app) => `Editor: ${app}`,
		wrongOrigin: 'Der Editor liegt auf einer anderen Adresse als ORISO und kann deshalb keine Dateien austauschen.'
	},
	en: {
		editors: { wordcraft: 'Text', gridcraft: 'Spreadsheet', pdfcraft: 'PDF' },
		engines: { wordcraft: 'WordCraft · .docx', gridcraft: 'GridCraft · .xlsx', pdfcraft: 'PdfCraft · .pdf' },
		menuLabel: 'Tools',
		open: 'Open file',
		blankHint: 'Start empty or drop an attachment here',
		pdfHint: 'Drop an attachment here or open a file',
		hint: () => 'Drag an attachment from the chat onto a tool (click “Check” or “Decrypt” on it first).',
		dropHere: 'Drop here to open',
		back: 'Tools',
		modes: { panel: 'Side panel', wide: 'Beside the chat', full: 'Full screen' },
		modesLabel: 'Size',
		zoomOut: 'Zoom out',
		zoomIn: 'Zoom in',
		zoomReset: 'Reset zoom',
		tab: 'Open in a new tab',
		tabRunning: (name) => `“${name}” is open in its own tab. What you save there lands here in Saved.`,
		tabBack: 'Work here again',
		tabBlocked: 'The browser blocked the new tab. Allow pop-ups for ORISO.',
		saveFirst: 'Save first (Ctrl+S), then open it in a new tab.',
		tray: 'Saved',
		trayHint: () => 'Every save puts a version here. Drag it into the chat.',
		trayEmpty: 'Nothing saved yet. Save in the program with Ctrl+S or “File › Save”.',
		version: (n, time) => `Version ${n} · ${time}`,
		putInChat: 'Put into chat',
		reopen: 'Open',
		tooBig: 'Too large for the chat (10 MB at most)',
		notForChat: 'The chat only takes PDF, DOCX and XLSX',
		stateNew: 'New',
		stateOpen: 'Open',
		stateDirty: 'Unsaved',
		stateSaved: (n) => `Saved · version ${n}`,
		saved: (name, n) => `Version ${n} of “${name}” is saved. Drag it into the chat so the next person can carry on.`,
		discard: 'Unsaved changes will be lost. Continue anyway?',
		leftDirty: 'The document had unsaved changes; they were discarded.',
		failed: (e) => `The program could not start (${e}). It needs a browser with WebGL2 or WebGPU.`,
		unsupported: (name) => `“${name}” cannot be opened here.`,
		unreadable: 'The attachment could not be read. Click “Check” or “Decrypt” on it in the chat first.',
		noChatDrop: 'The chat does not take a file right now. Drag the file into the chat with the mouse.',
		inChat: 'The file is in the chat’s message field. “Send” encrypts and sends it.',
		privacy: 'Files stay in this browser window and are only shared, encrypted, through the chat.',
		frameTitle: (app) => `Editor: ${app}`,
		wrongOrigin: 'The editor is on another address than ORISO and cannot exchange files.'
	}
};

const extensionOf = (name) => {
	const dot = name.lastIndexOf('.');
	return dot < 0 ? '' : name.slice(dot).toLowerCase();
};
export const editorFor = (name) => EDITORS.find((e) => e.extensions.includes(extensionOf(name)));
export const chatType = (name) => TYPES[extensionOf(name)];

const formatSize = (bytes, locale) => {
	const units = ['B', 'KB', 'MB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
};
const clock = (locale) => new Date().toLocaleTimeString(locale || 'de', { hour: '2-digit', minute: '2-digit' });

/** File names the editors keep in their "recent" lists would outlive the visit; drop them. */
const forgetRecentFiles = () => {
	for (const key of ['wordcraft.ui', 'gridcraft.ui', 'gridcraft.prefs', 'pdfcraft.ui', 'pdfcraft.prefs']) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			const value = JSON.parse(raw);
			let changed = false;
			for (const field of ['recent', 'recent_files', 'recentFiles']) {
				if (Array.isArray(value?.[field]) && value[field].length) {
					value[field] = [];
					changed = true;
				}
			}
			if (changed) localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// Storage unavailable or not JSON: nothing of ours to clean.
		}
	}
};

/** Name and bytes of what was dropped: files, or a decrypted chat attachment (a blob: link). */
export async function readDrop(dataTransfer, origin = location.origin) {
	const file = dataTransfer.files?.[0];
	if (file) {
		return { name: file.name, bytes: await file.arrayBuffer() };
	}
	const uri = (dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
	if (!uri || !uri.startsWith(`blob:${origin}/`)) {
		return null;
	}
	const html = dataTransfer.getData('text/html') || '';
	const named = /download="([^"]+)"/.exec(html)?.[1] ?? /download=([^\s>]+)/.exec(html)?.[1];
	const text = dataTransfer.getData('text/plain');
	const name = (named && decodeHtml(named)) || (editorFor(text || '') ? text : 'Dokument');
	const response = await fetch(uri);
	if (!response.ok) {
		throw new Error(`blob ${response.status}`);
	}
	return { name, bytes: await response.arrayBuffer() };
}

const decodeHtml = (value) => {
	const area = document.createElement('textarea');
	area.innerHTML = value;
	return area.value;
};

const STYLE = `
.wac { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 520px; position: relative;
  font: inherit; color: var(--m3-on-surface, #1a1c1e); background: var(--m3-surface, #fcf9f9); }
.wac button { font: inherit; color: inherit; cursor: pointer; }
.wac :focus-visible { outline: 3px solid var(--m3-primary, #a5000a); outline-offset: 2px; }
.wac-menu { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.wac-tile { min-width: 0; display: grid; grid-template-columns: 40px 1fr; gap: 4px 10px; align-items: center; text-align: left;
  padding: 12px; border-radius: 16px; border: 1px solid var(--m3-outline-variant, #c4c7c8); background: var(--m3-surface, #fcf9f9); }
.wac-tile:hover, .wac-tile.drop-hot { border-color: var(--m3-primary, #a5000a); background: var(--m3-surface-container, #f0edee); }
.wac-tile svg { width: 26px; height: 26px; grid-row: span 2; justify-self: center; color: var(--m3-primary, #a5000a); }
.wac-tile b { font-weight: 600; }
.wac-tile small { color: var(--m3-on-surface-variant, #444748); font-size: 11px; line-height: 1.3; }
.wac-tile.secondary { grid-template-columns: 1fr; grid-column: 1 / -1; text-align: center; border-style: dashed; padding: 9px; }
.wac-hint { margin: 0; font-size: 12px; color: var(--m3-on-surface-variant, #444748); }
.wac-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wac-head .wac-title { flex: 1; min-width: 0; }
.wac-title b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wac-title small { color: var(--m3-on-surface-variant, #444748); font-size: 12px; }
.wac-icon { width: 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; display: grid; place-items: center; flex: none; }
.wac-icon:hover { background: var(--m3-surface-container, #f0edee); }
.wac-icon svg { width: 20px; height: 20px; }
.wac-state { font-size: 12px; padding: 3px 10px; border-radius: 99px; white-space: nowrap;
  background: var(--m3-surface-container, #f0edee); color: var(--m3-on-surface-variant, #444748); }
.wac-state.dirty { background: var(--m3-primary-container, #cc1e1c); color: var(--m3-on-primary, #fff); }
.wac-state.saved { background: #e2f1e6; color: #1d6b3a; }
.wac-stage { flex: 1; position: relative; min-height: 360px; border-radius: 16px; overflow: hidden;
  border: 1px solid var(--m3-outline-variant, #c4c7c8); background: var(--m3-surface-container, #f0edee); }
.wac-stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.wac-drop { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center;
  background: color-mix(in srgb, var(--m3-primary, #a5000a) 12%, transparent);
  border: 3px dashed var(--m3-primary, #a5000a); border-radius: 16px; font-weight: 600; color: var(--m3-primary, #a5000a);
  z-index: 3; pointer-events: none; opacity: 0; transition: opacity 120ms; }
.wac.dragging .wac-drop { opacity: 1; }
.wac.dragging iframe { pointer-events: none; }
.wac-tray { display: grid; gap: 8px; }
.wac-tray-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.wac-tray-head b { font-weight: 600; font-size: 13px; }
.wac-tray-head small { font-size: 12px; color: var(--m3-on-surface-variant, #444748); }
.wac-tray ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: auto; }
.wac.wide .wac-tray ul, .wac.full .wac-tray ul { max-height: 132px; }
.wac-empty { font-size: 12px; color: var(--m3-on-surface-variant, #444748); }
.wac-chip { display: grid; grid-template-columns: 32px 1fr auto; gap: 10px; align-items: center; padding: 7px 8px; border-radius: 12px;
  background: var(--m3-surface-container-high, #eae7e8); cursor: grab; border: 1px solid transparent; }
.wac-chip:hover { border-color: var(--m3-outline, #747878); }
.wac-chip:active { cursor: grabbing; }
.wac-ext { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; font-size: 9px; font-weight: 700;
  letter-spacing: .02em; color: #fff; background: var(--m3-primary, #a5000a); }
.wac-ext.xlsx { background: #2f6b47; } .wac-ext.pdf { background: #6b4b2f; }
.wac-chip-text { min-width: 0; display: flex; flex-direction: column; }
.wac-chip-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wac-chip-meta { font-size: 11px; color: var(--m3-on-surface-variant, #444748); }
.wac-chip-meta.warn { color: var(--m3-error, #ba1a1a); }
.wac-chip-actions { display: flex; gap: 4px; }
.wac-chip-actions button { border: 1px solid var(--m3-outline, #747878); background: transparent; border-radius: 99px; padding: 3px 10px; font-size: 11px; }
.wac-privacy { margin: 0; font-size: 11px; color: var(--m3-on-surface-variant, #444748); }
.wac-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.wac-tools { display: flex; align-items: center; gap: 2px; flex: none; }
.wac-seg { display: flex; border: 1px solid var(--m3-outline-variant, #c4c7c8); border-radius: 999px; padding: 2px; }
.wac-seg .wac-icon { width: 32px; height: 32px; }
.wac-seg .wac-icon[aria-pressed="true"] { background: var(--m3-secondary-container, #dde1ff); }
.wac-zoom { font-size: 12px; min-width: 44px; text-align: center; border: 0; background: transparent; padding: 4px; border-radius: 8px;
  font-variant-numeric: tabular-nums; }
.wac-zoom:hover { background: var(--m3-surface-container, #f0edee); }
.wac-sep { width: 1px; height: 22px; background: var(--m3-outline-variant, #c4c7c8); margin: 0 4px; }
.wac-stage iframe { transform-origin: 0 0; }
.wac-away { position: absolute; inset: 0; display: grid; place-content: center; gap: 12px; padding: 24px; text-align: center; }
.wac-away button { justify-self: center; border: 0; border-radius: 99px; padding: 8px 18px; font-weight: 500;
  background: var(--m3-primary, #a5000a); color: var(--m3-on-primary, #fff); }
.wac.wide, .wac.full { position: fixed; z-index: 1000; padding: 16px 18px; border-radius: 28px; min-height: 0; height: auto; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 12px 32px rgba(60,10,10,.18); border: 1px solid var(--m3-outline-variant, #c4c7c8); }
@media (max-width: 760px) { .wac.wide, .wac.full { inset: 0 !important; width: auto !important; border-radius: 0; } }
@media (prefers-reduced-motion: reduce) { .wac * { transition: none !important; } }
`;

const el = (tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === null || value === false) continue;
		if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
		else if (key === 'text') node.textContent = value;
		else if (key === 'html') node.innerHTML = value;
		else node.setAttribute(key, value === true ? '' : value);
	}
	node.append(...children.filter(Boolean));
	return node;
};

/** One mounted panel. Kept per DOM element, so two panels on a page do not share state. */
class Panel {
	constructor(props) {
		this.props = props;
		this.base = new URL('./craft/', import.meta.url);
		this.editor = null; // the open editor, or null while the smart menu shows
		this.file = null; // name of the open document
		this.pending = null; // { name, bytes } waiting for the editor's ready message
		this.dirty = false;
		this.mode = 'panel'; // 'panel' | 'wide' (beside the chat) | 'full'
		this.zoom = 1;
		this.source = null; // { name, bytes } of the open document: what was opened or last saved
		this.tab = null; // the window of "Open in a new tab", while it runs
		this.onKey = (event) => this.key(event);
		this.versions = []; // { file, version, time }, newest first
		this.ownDrag = null;
		this.dragDepth = 0;
		this.onMessage = (event) => this.message(event);
		this.onChipDrop = (event) => this.chipDrop(event);
		this.onResize = () => this.place();
		// Bumped when the chat changes or the panel unmounts: reads that finish later belong to
		// another case and are dropped instead of opened (see `current`).
		this.generation = 0;
	}

	/** Resolves to the value of `read`, or to null if the chat changed while it ran. */
	async current(read) {
		const generation = this.generation;
		const value = await read;
		return generation === this.generation ? value : null;
	}

	get t() {
		const lang = (this.props.locale || 'de').split(/[-@]/)[0];
		return TEXTS[lang] ?? TEXTS.de;
	}

	get formal() {
		return !this.props.informal;
	}

	// ---------- layout ----------

	render() {
		const t = this.t;
		this.box = el('div', { class: 'wac' }, el('style', { text: STYLE }));
		this.body = el('div', { style: 'display:contents' });
		this.live = el('div', { class: 'wac-live', 'aria-live': 'polite' });
		this.input = el('input', {
			type: 'file',
			hidden: true,
			accept: EDITORS.flatMap((e) => e.extensions).join(','),
			onchange: async () => {
				const file = this.input.files?.[0];
				this.input.value = '';
				if (!file) return;
				const bytes = await this.current(file.arrayBuffer());
				if (bytes) await this.open({ name: file.name, bytes });
			}
		});
		this.list = el('ul');
		this.tray = el(
			'section',
			{ class: 'wac-tray', 'aria-label': t.tray },
			el('div', { class: 'wac-tray-head' }, el('b', { text: t.tray }), el('small', { text: t.trayHint(this.formal) })),
			this.list
		);
		this.box.append(this.body, this.tray, el('p', { class: 'wac-privacy', text: t.privacy }), this.input, this.live);
		this.props.domElement.replaceChildren(this.box);
		this.listenForDrops();
		this.renderBody();
		this.renderVersions();
	}

	/** The smart menu, or the open editor. The editor's iframe is kept across re-renders. */
	renderBody() {
		const t = this.t;
		if (!this.editor) {
			this.setMode('panel');
			const menu = el(
				'div',
				{ class: 'wac-menu', role: 'group', 'aria-label': t.menuLabel },
				...EDITORS.map((editor) =>
					el(
						'button',
						{
							type: 'button',
							class: 'wac-tile',
							'data-editor': editor.id,
							onclick: () => (editor.blank ? this.start(editor, null) : this.input.click()),
							html: `${ICONS[editor.id]}<b>${t.editors[editor.id]}</b><small>${t.engines[editor.id]}</small>`
						}
					)
				),
				el('button', { type: 'button', class: 'wac-tile secondary', text: t.open, onclick: () => this.input.click() })
			);
			this.body.replaceChildren(menu, el('p', { class: 'wac-hint', text: t.hint(this.formal) }));
			this.stage = null;
			return;
		}
		this.stateBadge = el('span', { class: 'wac-state' });
		const icon = (name, label, onclick, extra = {}) =>
			el('button', { type: 'button', class: 'wac-icon', 'aria-label': label, title: label, html: ICONS[name], onclick, ...extra });
		this.modeButtons = ['panel', 'wide', 'full'].map((mode) =>
			icon(mode, t.modes[mode], () => this.setMode(mode), { 'data-mode': mode })
		);
		this.zoomLabel = el('button', { type: 'button', class: 'wac-zoom', title: t.zoomReset, 'aria-label': t.zoomReset, onclick: () => this.setZoom(1) });
		const tools = el(
			'div',
			{ class: 'wac-tools' },
			icon('zoomOut', t.zoomOut, () => this.stepZoom(-1)),
			this.zoomLabel,
			icon('zoomIn', t.zoomIn, () => this.stepZoom(1)),
			el('span', { class: 'wac-sep', 'aria-hidden': 'true' }),
			el('div', { class: 'wac-seg', role: 'group', 'aria-label': t.modesLabel }, ...this.modeButtons),
			icon('tab', t.tab, () => this.openInTab())
		);
		const head = el(
			'div',
			{ class: 'wac-head' },
			el('button', { type: 'button', class: 'wac-icon', 'aria-label': t.back, title: t.back, html: ICONS.back, onclick: () => this.backToMenu() }),
			el(
				'div',
				{ class: 'wac-title' },
				el('b', { text: this.file || t.editors[this.editor.id] }),
				el('small', { text: `${t.editors[this.editor.id]} · ${t.engines[this.editor.id].split(' · ')[0]}` })
			),
			this.stateBadge,
			tools
		);
		this.stage = el('div', { class: 'wac-stage' }, el('div', { class: 'wac-drop', text: t.dropHere }));
		if (this.tab) {
			this.stage.append(
				el(
					'div',
					{ class: 'wac-away' },
					el('p', { text: t.tabRunning(this.file || t.editors[this.editor.id]) }),
					el('button', { type: 'button', text: t.tabBack, onclick: () => this.backFromTab() })
				)
			);
		} else if (this.frame) {
			this.stage.append(this.frame);
		}
		this.body.replaceChildren(head, this.stage);
		this.syncState();
		this.syncModes();
		this.applyZoom();
	}

	syncState(savedVersion) {
		if (!this.stateBadge) return;
		const t = this.t;
		if (this.dirty) {
			this.stateBadge.className = 'wac-state dirty';
			this.stateBadge.textContent = t.stateDirty;
		} else if (savedVersion) {
			this.stateBadge.className = 'wac-state saved';
			this.stateBadge.textContent = t.stateSaved(savedVersion);
		} else if (!this.stateBadge.classList.contains('saved')) {
			this.stateBadge.className = 'wac-state';
			this.stateBadge.textContent = this.file ? t.stateOpen : t.stateNew;
		}
	}

	syncModes() {
		for (const button of this.modeButtons ?? []) {
			button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
		}
	}

	/**
	 * Sizes: the side panel, a window beside the chat (the chat keeps CHAT_MIN_WIDTH on the left,
	 * so files can be dragged into it) and nearly full screen. The panel's own box becomes the
	 * fixed window; the iframe is not moved, so the editor keeps its document.
	 */
	setMode(mode) {
		if (mode === this.mode) return;
		this.mode = mode;
		this.box.classList.toggle('wide', mode === 'wide');
		this.box.classList.toggle('full', mode === 'full');
		if (mode === 'panel') {
			for (const side of ['top', 'bottom', 'right', 'left']) this.box.style[side] = '';
			window.removeEventListener('resize', this.onResize);
		} else {
			this.place();
			window.addEventListener('resize', this.onResize);
		}
		this.syncModes();
	}

	place() {
		if (this.mode === 'full') {
			Object.assign(this.box.style, { top: '12px', bottom: '12px', right: '12px', left: '12px' });
		} else if (this.mode === 'wide') {
			const panel = this.props.domElement.getBoundingClientRect();
			const left = Math.max(CHAT_MIN_WIDTH, Math.min(panel.left, window.innerWidth - 980));
			Object.assign(this.box.style, { top: '16px', bottom: '16px', right: '16px', left: `${left}px` });
		}
	}

	/** Esc steps down one size: full screen, beside the chat, side panel. */
	key(event) {
		if (event.key !== 'Escape' || this.mode === 'panel' || event.defaultPrevented) return;
		event.preventDefault();
		this.setMode(this.mode === 'full' ? 'wide' : 'panel');
	}

	// ---------- zoom ----------

	static ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

	zoomKey() {
		return `wac.zoom.${this.editor?.id ?? 'none'}`;
	}

	loadZoom() {
		try {
			const value = Number(localStorage.getItem(this.zoomKey()));
			this.zoom = Panel.ZOOMS.includes(value) ? value : 1;
		} catch {
			this.zoom = 1;
		}
	}

	stepZoom(direction) {
		const steps = Panel.ZOOMS;
		const index = steps.findIndex((z) => z >= this.zoom - 1e-9);
		const next = steps[Math.min(steps.length - 1, Math.max(0, (index < 0 ? steps.length - 1 : index) + direction))];
		this.setZoom(next);
	}

	setZoom(zoom) {
		this.zoom = zoom;
		try {
			localStorage.setItem(this.zoomKey(), String(zoom));
		} catch {
			// Not remembered then; the zoom still applies.
		}
		this.applyZoom();
	}

	/** The editor draws at a larger or smaller CSS size and is scaled to fit the stage. */
	applyZoom() {
		if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.zoom * 100)} %`;
		if (!this.frame) return;
		const z = this.zoom;
		Object.assign(this.frame.style, {
			width: `${100 / z}%`,
			height: `${100 / z}%`,
			transform: z === 1 ? '' : `scale(${z})`
		});
	}

	// ---------- new tab ----------

	/**
	 * Moves the document into its own tab (ui/tab.html). The tab hosts the same editor and
	 * sends every save back here, so versions still land in the Ablage and nothing is
	 * downloaded. Needs a saved state: unsaved edits live only inside this editor.
	 */
	openInTab() {
		// One tab per document: a second click brings the running one forward.
		if (this.tab && !this.tab.closed) {
			this.tab.focus();
			return;
		}
		if (this.dirty) {
			this.say(this.t.saveFirst, 'warning');
			return;
		}
		const url = new URL('tab.html', new URL('..', this.base));
		url.searchParams.set('app', this.editor.id);
		const author = this.props.user?.username;
		if (author) url.searchParams.set('author', author);
		const tab = window.open(url.href, '_blank');
		if (!tab) {
			this.say(this.t.tabBlocked, 'warning');
			return;
		}
		this.tab = tab;
		this.frame?.remove();
		this.frame = null;
		this.setMode('panel');
		this.renderBody();
	}

	closeTab() {
		try {
			// The person already decided about unsaved edits here; the tab must not ask again.
			if (this.tab) this.tab.wacReleased = true;
			this.tab?.close();
		} catch {
			// Already closed.
		}
		this.tab = null;
	}

	backFromTab() {
		// Edits made in the tab since its last save are only in the tab.
		if (!this.confirmDiscard()) return;
		this.start(this.editor, this.source);
	}

	/** Messages from the tab: hello (send the document), saved (a new version), closed. */
	tabMessage(data) {
		if (data.type === 'wac:hello') {
			if (this.source) {
				const bytes = this.source.bytes.slice(0);
				this.tab.postMessage({ type: 'wac:doc', name: this.source.name, bytes }, location.origin, [bytes]);
			}
		} else if (data.type === 'wac:saved' && data.bytes) {
			this.addVersion(data.name || this.file || 'Dokument', data.bytes);
		} else if (data.type === 'wac:dirty') {
			this.setDirty(Boolean(data.dirty));
		} else if (data.type === 'wac:closed') {
			// The person closed the tab (it asked them about unsaved edits itself).
			this.tab = null;
			this.dirty = false;
			if (this.editor) this.start(this.editor, this.source);
		}
	}

	backToMenu() {
		if (!this.confirmDiscard()) return;
		this.closeTab();
		this.frame?.remove();
		this.frame = null;
		this.editor = null;
		this.file = null;
		this.setDirty(false);
		this.renderBody();
	}

	listenForDrops() {
		// An iframe swallows drag events over it, so while a drag is over the panel the iframe
		// lets the pointer through and the panel itself takes the drop. The overlay is only a
		// picture: were it the drop target, appearing under the pointer would cancel the drop.
		const box = this.box;
		const accepts = (event) =>
			[...(event.dataTransfer?.types ?? [])].some((type) => type === 'Files' || type === 'text/uri-list');
		box.addEventListener('dragenter', (event) => {
			if (!accepts(event) || this.ownDrag) return;
			this.dragDepth += 1;
			box.classList.add('dragging');
		});
		box.addEventListener('dragover', (event) => {
			if (!accepts(event) || this.ownDrag) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			box.querySelectorAll('.wac-tile').forEach((tile) => tile.classList.toggle('drop-hot', tile.contains(event.target)));
		});
		box.addEventListener('dragleave', () => {
			this.dragDepth = Math.max(0, this.dragDepth - 1);
			if (!this.dragDepth) {
				box.classList.remove('dragging');
				box.querySelectorAll('.drop-hot').forEach((tile) => tile.classList.remove('drop-hot'));
			}
		});
		box.addEventListener('drop', async (event) => {
			this.dragDepth = 0;
			box.classList.remove('dragging');
			box.querySelectorAll('.drop-hot').forEach((tile) => tile.classList.remove('drop-hot'));
			if (this.ownDrag) return;
			event.preventDefault();
			// The chat's own drop zone listens on the window; this drop is ours.
			event.stopPropagation();
			try {
				const dropped = await this.current(readDrop(event.dataTransfer));
				if (dropped) await this.open(dropped);
			} catch {
				this.say(this.t.unreadable, 'error');
			}
		});
	}

	// ---------- documents ----------

	confirmDiscard() {
		return !this.dirty || window.confirm(this.t.discard);
	}

	async open({ name, bytes }) {
		const editor = editorFor(name);
		if (!editor) {
			this.say(this.t.unsupported(name), 'warning');
			return;
		}
		if (!this.confirmDiscard()) return;
		this.start(editor, { name, bytes });
	}

	/** Starts an editor afresh (a new iframe) and hands it `file` once it says it is ready. */
	start(editor, file) {
		// A tab belongs to the document it was opened for; a new document ends it.
		this.closeTab();
		this.frame?.remove();
		this.editor = editor;
		this.file = file?.name ?? null;
		this.pending = file;
		this.source = file ? { name: file.name, bytes: file.bytes.slice(0) } : null;
		this.loadZoom();
		this.setDirty(false);
		const src = new URL(`${editor.id}/index.html`, this.base);
		if (src.origin !== location.origin) {
			this.say(this.t.wrongOrigin, 'error');
			return;
		}
		src.searchParams.set('host', 'parent');
		const author = this.props.user?.username;
		if (author) src.searchParams.set('author', author);
		this.frame = el('iframe', {
			src: src.href,
			title: this.t.frameTitle(this.t.editors[editor.id]),
			allow: 'clipboard-read; clipboard-write; fullscreen'
		});
		this.stateBadge = null;
		this.renderBody();
	}

	message(event) {
		if (this.tab && event.source === this.tab && event.origin === location.origin) {
			this.tabMessage(event.data ?? {});
			return;
		}
		if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== location.origin) return;
		const data = event.data ?? {};
		const [app, kind] = String(data.type ?? '').split(':');
		if (app !== this.editor?.id) return;
		if (kind === 'ready') {
			if (this.pending) {
				// Send a copy: the transfer empties the buffer it moves.
				const bytes = this.pending.bytes.slice(0);
				this.frame.contentWindow.postMessage({ type: `${app}:open`, name: this.pending.name, bytes }, location.origin, [bytes]);
				this.pending = null;
			}
		} else if (kind === 'save' && data.bytes) {
			this.addVersion(data.name || this.file || 'Dokument', data.bytes);
		} else if (kind === 'dirty') {
			this.setDirty(Boolean(data.dirty));
		} else if (kind === 'failed') {
			this.say(this.t.failed(String(data.error ?? '')), 'error');
		}
	}

	setDirty(dirty) {
		this.dirty = dirty;
		this.syncState();
	}

	addVersion(name, bytes) {
		const file = new File([bytes], name, { type: chatType(name) ?? 'application/octet-stream' });
		const version = this.versions.filter((v) => v.file.name === name).length + 1;
		this.versions.unshift({ file, version, time: clock(this.props.locale) });
		this.source = { name, bytes: bytes.slice(0) };
		this.file = name;
		this.dirty = false;
		this.syncState(version);
		this.renderVersions();
		this.say(this.t.saved(name, version, this.formal), 'success');
	}

	renderVersions() {
		const t = this.t;
		if (!this.versions.length) {
			this.list.replaceChildren(el('li', { class: 'wac-empty', text: t.trayEmpty }));
			return;
		}
		this.list.replaceChildren(
			...this.versions.map((entry) => {
				const { file, version, time } = entry;
				const ext = extensionOf(file.name).slice(1);
				const forChat = Boolean(chatType(file.name));
				const tooBig = file.size > CHAT_MAX_BYTES;
				const usable = forChat && !tooBig;
				const meta = !forChat
					? t.notForChat
					: tooBig
						? t.tooBig
						: `${t.version(version, time)} · ${formatSize(file.size, this.props.locale)}`;
				return el(
					'li',
					{
						class: 'wac-chip',
						draggable: String(usable),
						tabindex: '0',
						'aria-label': `${file.name}, ${meta}`,
						ondragstart: (event) => {
							this.ownDrag = file;
							// The chat is under the full-screen window: make room for the drop.
							if (this.mode === 'full') this.setMode('wide');
							event.dataTransfer.effectAllowed = 'copy';
							event.dataTransfer.items.add(file);
							event.dataTransfer.setData('text/plain', file.name);
						},
						ondragend: () => {
							this.ownDrag = null;
						}
					},
					el('span', { class: `wac-ext ${ext}`, 'aria-hidden': 'true', text: ext.toUpperCase().slice(0, 4) }),
					el(
						'span',
						{ class: 'wac-chip-text' },
						el('span', { class: 'wac-chip-name', text: file.name }),
						el('span', { class: `wac-chip-meta${usable ? '' : ' warn'}`, text: meta })
					),
					el(
						'span',
						{ class: 'wac-chip-actions' },
						usable ? el('button', { type: 'button', text: t.putInChat, onclick: () => this.putInChat(file) }) : null,
						el('button', {
							type: 'button',
							text: t.reopen,
							onclick: async () => {
								const bytes = await this.current(file.arrayBuffer());
								if (bytes) await this.open({ name: file.name, bytes });
							}
						})
					)
				);
			})
		);
	}

	// ---------- into the chat ----------

	/**
	 * Hands the file to the chat's drop zone the way a mouse drop would; the chat then uploads
	 * it encrypted. The contract has no "attach a file" call yet (a candidate for
	 * oriso-addon/v2), so this looks for the web app's drop zone and says so when there is none.
	 */
	putInChat(file, target = document.querySelector('.dragAndDropArea')) {
		if (!target || typeof DataTransfer !== 'function') {
			this.say(this.t.noChatDrop, 'warning');
			return;
		}
		try {
			const transfer = new DataTransfer();
			transfer.items.add(file);
			for (const type of ['dragenter', 'dragover', 'drop']) {
				target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
			}
			if (this.mode !== 'panel' && window.matchMedia('(max-width: 760px)').matches) this.setMode('panel');
			this.say(this.t.inChat, 'info');
		} catch {
			this.say(this.t.noChatDrop, 'warning');
		}
	}

	/**
	 * A chip dropped on the chat's drop zone. Browsers differ in whether a file added in
	 * `dragstart` survives to the drop; when it did not, hand the file over ourselves.
	 */
	chipDrop(event) {
		const file = this.ownDrag;
		if (!file || event.dataTransfer?.files?.length) return;
		const zone = event.target instanceof Element ? event.target.closest('.dragAndDropArea') : null;
		if (!zone) return;
		event.preventDefault();
		event.stopPropagation();
		this.ownDrag = null;
		this.putInChat(file, zone);
	}

	say(text, type = 'info') {
		this.live.textContent = text;
		if (typeof this.props.notify === 'function') {
			this.props.notify({ type, text });
		}
	}

	// ---------- lifecycle ----------

	mount() {
		forgetRecentFiles();
		window.addEventListener('message', this.onMessage);
		window.addEventListener('drop', this.onChipDrop, true);
		window.addEventListener('keydown', this.onKey);
		this.render();
	}

	update(props) {
		const otherCase = props.sessionId !== this.props.sessionId;
		this.props = props;
		if (otherCase) {
			this.generation += 1;
			// A tab opened for the previous case must not keep feeding this one.
			this.closeTab();
			// Versions saved for one chat must not be dropped into another by mistake.
			if (this.dirty) this.say(this.t.leftDirty, 'warning');
			this.versions = [];
			forgetRecentFiles();
			this.frame?.remove();
			this.frame = null;
			this.editor = null;
			this.file = null;
			this.dirty = false;
			this.setMode('panel');
			this.render();
		}
	}

	unmount() {
		this.generation += 1;
		window.removeEventListener('message', this.onMessage);
		window.removeEventListener('drop', this.onChipDrop, true);
		window.removeEventListener('keydown', this.onKey);
		this.closeTab();
		this.setMode('panel');
		if (this.dirty) this.say(this.t.leftDirty, 'warning');
		this.frame?.remove();
		this.versions = [];
		forgetRecentFiles();
		this.props.domElement.replaceChildren();
	}
}

const panels = new WeakMap();

export async function bootstrap() {}

export async function mount(props) {
	const panel = new Panel(props);
	panels.set(props.domElement, panel);
	panel.mount();
}

export async function update(props) {
	panels.get(props.domElement)?.update(props);
}

export async function unmount(props) {
	panels.get(props.domElement)?.unmount();
	panels.delete(props.domElement);
}
