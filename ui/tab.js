/**
 * The editor tab of wasm-artcraft (see tab.html). Talks to two windows on its own origin:
 *  - the panel that opened it (`window.opener`): wac:hello → wac:doc; wac:saved, wac:closed back;
 *  - the editor iframe: the Craft bridge `<app>:ready|open|save|dirty|failed`.
 */
const APPS = ['wordcraft', 'gridcraft', 'pdfcraft'];
const params = new URLSearchParams(location.search);
const app = params.get('app');
const panel = window.opener;
const note = document.getElementById('note');

const show = (text) => {
	note.textContent = text;
	note.hidden = false;
};

if (!APPS.includes(app) || !panel) {
	show('Dieses Fenster wird aus ORISO heraus geöffnet („Dokumente“ › „In neuem Tab öffnen“).');
} else {
	const src = new URL(`craft/${app}/index.html`, import.meta.url);
	src.searchParams.set('host', 'parent');
	if (params.get('author')) src.searchParams.set('author', params.get('author'));
	const frame = Object.assign(document.createElement('iframe'), { src: src.href, title: `Editor: ${app}` });
	frame.allow = 'clipboard-read; clipboard-write; fullscreen';
	document.body.append(frame);

	let doc = null; // { name, bytes } from the panel
	let ready = false;
	let dirty = false;
	// Closing the tab with unsaved edits asks first, as the panel does for its own editor.
	window.addEventListener('beforeunload', (event) => {
		if (dirty && !window.wacReleased) event.preventDefault();
	});
	const toEditor = () => {
		if (!doc || !ready) return;
		const bytes = doc.bytes.slice(0);
		frame.contentWindow.postMessage({ type: `${app}:open`, name: doc.name, bytes }, location.origin, [bytes]);
		document.title = `${doc.name} · ORISO`;
		doc = { ...doc, sent: true };
	};

	window.addEventListener('message', (event) => {
		if (event.origin !== location.origin) return;
		const data = event.data ?? {};
		if (event.source === panel) {
			if (data.type === 'wac:doc' && data.bytes) {
				doc = { name: data.name, bytes: data.bytes };
				toEditor();
			}
			return;
		}
		if (event.source !== frame.contentWindow) return;
		const [from, kind] = String(data.type ?? '').split(':');
		if (from !== app) return;
		if (kind === 'ready') {
			ready = true;
			toEditor();
		} else if (kind === 'save' && data.bytes) {
			dirty = false;
			panel.postMessage({ type: 'wac:saved', name: data.name, bytes: data.bytes }, location.origin, [data.bytes]);
		} else if (kind === 'dirty') {
			dirty = Boolean(data.dirty);
			panel.postMessage({ type: 'wac:dirty', dirty }, location.origin);
		} else if (kind === 'failed') {
			show(`Das Programm konnte nicht starten (${data.error ?? ''}). Es braucht WebGL2 oder WebGPU.`);
		}
	});

	// Leaving this tab hands the work back to the panel, which reopens the last saved version.
	window.addEventListener('pagehide', () => {
		try {
			panel.postMessage({ type: 'wac:closed' }, location.origin);
		} catch {
			// The panel is gone too.
		}
	});
	panel.postMessage({ type: 'wac:hello' }, location.origin);
}
