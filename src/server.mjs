import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from './manifest.mjs';

// UI_ROOT is only overridden by the tests, which serve stand-in editors.
const UI_ROOT = resolve(process.env.UI_ROOT ?? fileURLToPath(new URL('../ui', import.meta.url)));

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.txt': 'text/plain; charset=utf-8'
};

// Trunk names the editors' JS and wasm after their content (`wordcraft-web-<hash>_bg.wasm`).
const HASHED = /-[0-9a-f]{16,}(_bg)?\.(wasm|js)$/;

/** Maps a request path below /ui/ to a file inside UI_ROOT, or null when it would leave it. */
export function uiFile(pathname) {
	let relative;
	try {
		relative = decodeURIComponent(pathname.slice('/ui/'.length));
	} catch {
		return null;
	}
	if (relative.includes('\0')) {
		return null;
	}
	const file = normalize(join(UI_ROOT, relative));
	return file === UI_ROOT || file.startsWith(UI_ROOT + sep) ? file : null;
}

function cacheControl(file) {
	if (HASHED.test(file)) {
		return 'public, max-age=31536000, immutable';
	}
	return file.endsWith('.html') || file.endsWith('entry.js') ? 'no-cache' : 'public, max-age=3600';
}

async function serveUi(pathname, res, head) {
	let file = uiFile(pathname);
	if (!file) {
		return send(res, 404, 'not found');
	}
	try {
		if ((await stat(file)).isDirectory()) {
			file = join(file, 'index.html');
		}
		const body = await readFile(file);
		res.writeHead(200, {
			'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
			'Cache-Control': cacheControl(file),
			'X-Content-Type-Options': 'nosniff'
		});
		res.end(head ? undefined : body);
	} catch {
		send(res, 404, 'not found');
	}
}

function send(res, status, text, type = 'text/plain; charset=utf-8') {
	res.writeHead(status, { 'Content-Type': type });
	res.end(text);
}

export function handler(req, res) {
	const { pathname } = new URL(req.url, 'http://addon');
	const head = req.method === 'HEAD';
	if (req.method !== 'GET' && !head) {
		return send(res, 405, 'method not allowed');
	}
	if (pathname === '/.well-known/oriso-addon.json') {
		return send(res, 200, JSON.stringify(manifest), 'application/json');
	}
	if (pathname === '/health') {
		return send(res, 200, JSON.stringify({ status: 'UP' }), 'application/json');
	}
	if (pathname.startsWith('/ui/')) {
		return serveUi(pathname, res, head);
	}
	// No /api: this add-on never receives, stores or forwards a document.
	send(res, 404, 'not found');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.env.PORT ?? 8080);
	createServer(handler).listen(port, () => console.log(`${manifest.name} ${manifest.version} on :${port}`));
}
