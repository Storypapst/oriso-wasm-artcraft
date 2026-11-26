/**
 * wasm-artcraft: Word, Excel and PDF files beside the chat (contract oriso-addon/v1).
 *
 * The web app shows this app as a button in the case header, next to the call buttons
 * (slot consultant.session), and in the chat menu. It opens a side panel with:
 *  - a smart menu: Text (WordCraft), Tabelle (GridCraft), PDF (PdfCraft), "Datei öffnen";
 *  - the editor, which can grow into a large window over the right part of the screen;
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
	grow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg>',
	shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6l6 6-6 6M21 6l-6 6 6 6"/></svg>'
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
		grow: 'Großes Fenster',
		shrink: 'Zurück ins Seitenpanel',
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
		grow: 'Large window',
		shrink: 'Back into the side panel',
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
.wac.large .wac-tray ul { max-height: 132px; }
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
.wac.large { position: fixed; z-index: 1000; padding: 16px 18px; border-radius: 28px; min-height: 0; height: auto; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 12px 32px rgba(60,10,10,.18); border: 1px solid var(--m3-outline-variant, #c4c7c8); }
@media (max-width: 760px) { .wac.large { inset: 0 !important; width: auto !important; border-radius: 0; } }
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
		this.large = false;
		this.versions = []; // { file, version, time }, newest first
		this.ownDrag = null;
		this.dragDepth = 0;
		this.onMessage = (event) => this.message(event);
		this.onChipDrop = (event) => this.chipDrop(event);
		this.onResize = () => this.placeLarge();
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
			this.leaveLarge();
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
		this.growButton = el('button', {
			type: 'button',
			class: 'wac-icon',
			onclick: () => (this.large ? this.leaveLarge() : this.enterLarge())
		});
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
			this.growButton
		);
		this.stage = el('div', { class: 'wac-stage' }, el('div', { class: 'wac-drop', text: t.dropHere }));
		if (this.frame) this.stage.append(this.frame);
		this.body.replaceChildren(head, this.stage);
		this.syncState();
		this.syncGrow();
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

	syncGrow() {
		if (!this.growButton) return;
		const label = this.large ? this.t.shrink : this.t.grow;
		this.growButton.innerHTML = this.large ? ICONS.shrink : ICONS.grow;
		this.growButton.setAttribute('aria-label', label);
		this.growButton.title = label;
		this.growButton.setAttribute('aria-pressed', String(this.large));
	}

	/**
	 * The large window: the panel's own box becomes a fixed window over the right part of the
	 * screen (the iframe is not moved, so the editor keeps its document). The chat keeps
	 * CHAT_MIN_WIDTH on the left, so files can still be dragged into it.
	 */
	enterLarge() {
		this.large = true;
		this.box.classList.add('large');
		this.placeLarge();
		window.addEventListener('resize', this.onResize);
		this.syncGrow();
	}

	placeLarge() {
		if (!this.large) return;
		const panel = this.props.domElement.getBoundingClientRect();
		const left = Math.max(CHAT_MIN_WIDTH, Math.min(panel.left, window.innerWidth - 980));
		Object.assign(this.box.style, { top: '16px', bottom: '16px', right: '16px', left: `${left}px` });
	}

	leaveLarge() {
		if (!this.large) return;
		this.large = false;
		this.box.classList.remove('large');
		for (const side of ['top', 'bottom', 'right', 'left']) this.box.style[side] = '';
		window.removeEventListener('resize', this.onResize);
		this.syncGrow();
	}

	backToMenu() {
		if (!this.confirmDiscard()) return;
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
		this.frame?.remove();
		this.editor = editor;
		this.file = file?.name ?? null;
		this.pending = file;
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
			if (this.large && window.matchMedia('(max-width: 760px)').matches) this.leaveLarge();
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
		this.render();
	}

	update(props) {
		const otherCase = props.sessionId !== this.props.sessionId;
		this.props = props;
		if (otherCase) {
			this.generation += 1;
			// Versions saved for one chat must not be dropped into another by mistake.
			if (this.dirty) this.say(this.t.leftDirty, 'warning');
			this.versions = [];
			forgetRecentFiles();
			this.frame?.remove();
			this.frame = null;
			this.editor = null;
			this.file = null;
			this.dirty = false;
			this.leaveLarge();
			this.render();
		}
	}

	unmount() {
		this.generation += 1;
		window.removeEventListener('message', this.onMessage);
		window.removeEventListener('drop', this.onChipDrop, true);
		this.leaveLarge();
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
