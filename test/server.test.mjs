import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'wac-ui-'));
await mkdir(join(root, 'craft', 'wordcraft'), { recursive: true });
await writeFile(join(root, 'entry.js'), 'export {}');
await writeFile(join(root, 'craft', 'wordcraft', 'index.html'), '<!doctype html>');
await writeFile(join(root, 'craft', 'wordcraft', 'wordcraft-web-0123456789abcdef_bg.wasm'), Buffer.from([0, 97, 115, 109]));
process.env.UI_ROOT = root;
const { handler, uiFile } = await import('../src/server.mjs');
const { manifest } = await import('../src/manifest.mjs');

const server = createServer(handler);
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('serves the manifest the AddonService validates', async () => {
	const res = await fetch(`${base}/.well-known/oriso-addon.json`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.contract, 'oriso-addon/v1');
	assert.match(body.name, /^[a-z][a-z0-9-]{1,40}$/);
	assert.ok(body.ui.startsWith('/ui/'));
	assert.match(body.apps[0].icon, /^\/ui(\/[A-Za-z0-9._-]+)+\.svg$/);
	assert.ok(body.apps[0].description.de.length <= 200);
	assert.deepEqual(body, manifest);
});

test('serves wasm as application/wasm, cached forever when hashed', async () => {
	const res = await fetch(`${base}/ui/craft/wordcraft/wordcraft-web-0123456789abcdef_bg.wasm`);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'application/wasm');
	assert.match(res.headers.get('cache-control'), /immutable/);
});

test('revalidates the editor page and the entry module', async () => {
	for (const path of ['/ui/craft/wordcraft/index.html', '/ui/craft/wordcraft/', '/ui/entry.js']) {
		const res = await fetch(`${base}${path}`);
		assert.equal(res.status, 200, path);
		assert.equal(res.headers.get('cache-control'), 'no-cache', path);
	}
});

test('never serves files outside ui/', async () => {
	assert.equal(uiFile('/ui/../src/server.mjs'), null);
	assert.equal(uiFile('/ui/%2e%2e/src/server.mjs'), null);
	assert.equal(uiFile('/ui/%E0%A4%A'), null);
	for (const path of ['/ui/%2e%2e/package.json', '/ui/..%2fpackage.json']) {
		assert.equal((await fetch(`${base}${path}`)).status, 404, path);
	}
});

test('answers a malformed request target with 400 and keeps serving', async () => {
	const { request } = await import('node:http');
	const status = await new Promise((ok, fail) => {
		const req = request({ host: '127.0.0.1', port: server.address().port, path: '//[' }, (res) => ok(res.statusCode));
		req.on('error', fail);
		req.end();
	});
	assert.equal(status, 400);
	assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('has no API and refuses writes', async () => {
	assert.equal((await fetch(`${base}/api/anything`)).status, 404);
	assert.equal((await fetch(`${base}/ui/entry.js`, { method: 'POST', body: 'x' })).status, 405);
});
