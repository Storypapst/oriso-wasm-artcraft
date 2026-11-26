// Browser test of the panel: the smart menu, a decrypted chat attachment dragged onto a tool,
// saved versions in the Ablage, the large window, and versions dragged back into the chat.
//   node test/browser.mjs        (needs Playwright with Chromium)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'wac-browser-'));
await cp(join(here, '..', 'ui'), root, { recursive: true });
for (const app of ['wordcraft', 'gridcraft', 'pdfcraft']) {
	await mkdir(join(root, 'craft', app), { recursive: true });
	await copyFile(join(here, 'fixtures', 'stub-editor.html'), join(root, 'craft', app, 'index.html'));
}
await copyFile(join(here, 'fixtures', 'host.html'), join(root, 'host.html'));
process.env.UI_ROOT = root;
const { handler } = await import('../src/server.mjs');
const server = createServer(handler);
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const require = createRequire(import.meta.url);
let playwright;
try {
	playwright = require('playwright');
} catch {
	playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/usr/local/lib/node_modules', 'playwright'));
}
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let confirms = 0;
page.on('dialog', (d) => {
	confirms += 1;
	d.accept();
});
const results = [];
const step = async (name, fn) => {
	await fn();
	results.push(name);
	console.log(`ok - ${name}`);
};
const frame = () => page.frameLocator('.wac iframe');

try {
	await page.goto(`${base}/ui/host.html`);
	await page.waitForFunction(() => window.mounted);

	await step('opens on the smart menu: Text, Tabelle, PDF, Datei öffnen, and an empty Ablage', async () => {
		const tiles = await page.locator('.wac-tile').allTextContents();
		assert.deepEqual(tiles.map((s) => s.split(/WordCraft|GridCraft|PdfCraft/)[0].trim()), ['Text', 'Tabelle', 'PDF', 'Datei öffnen']);
		assert.match(await page.textContent('.wac-tray'), /Noch nichts gespeichert/);
	});

	await step('a decrypted chat attachment dropped on a tool opens in its editor, signed by the user', async () => {
		await page.dragAndDrop('#attachment', '.wac-tile[data-editor=wordcraft]');
		await frame().locator('#state').filter({ hasText: 'opened' }).waitFor();
		assert.equal(await frame().locator('#state').textContent(), 'opened Antrag & Co.docx: original text by Beraterin Test');
		assert.equal(await page.textContent('.wac-title b'), 'Antrag & Co.docx');
		assert.match(await page.getAttribute('.wac iframe', 'src'), /\/ui\/craft\/wordcraft\/index\.html\?host=parent&author=Beraterin\+Test/);
	});

	await step('editing shows "Ungespeichert"; each save adds a version to the Ablage', async () => {
		await frame().locator('#edit').click();
		await page.locator('.wac-state.dirty').waitFor();
		await frame().locator('#save').click();
		await page.locator('.wac-state.saved').filter({ hasText: 'Version 1' }).waitFor();
		await frame().locator('#edit').click();
		await frame().locator('#save').click();
		await page.locator('.wac-state.saved').filter({ hasText: 'Version 2' }).waitFor();
		const metas = await page.locator('.wac-chip-meta').allTextContents();
		assert.equal(metas.length, 2);
		assert.match(metas[0], /^Version 2 · \d\d:\d\d · /);
		assert.match(metas[1], /^Version 1 · /);
		const notices = await page.evaluate(() => window.notices);
		assert.ok(notices.some((n) => n.type === 'success' && /Version 2 von „Antrag & Co.docx“/.test(n.text) && /Ziehen Sie/.test(n.text)));
	});

	await step('the large window keeps the document and leaves the chat free on the left', async () => {
		await page.click('.wac-head button[aria-label="Großes Fenster"]');
		const box = await page.locator('.wac').boundingBox();
		assert.ok(box.x >= 380, `window starts at ${box.x}`);
		assert.ok(box.width > 700, `window is ${box.width} wide`);
		assert.ok(box.y >= 0 && box.y + box.height <= 900, `window ${box.y}..${box.y + box.height} fits the 900px screen`);
		assert.match(await frame().locator('#state').textContent(), /opened Antrag & Co.docx/, 'editor was not reloaded');
		await page.click('.wac-head button[aria-label="Zurück ins Seitenpanel"]');
		assert.equal(await page.locator('.wac.large').count(), 0);
	});

	await step('the newest version dragged into the chat arrives as a .docx with both edits', async () => {
		await page.dragAndDrop('.wac-chip >> nth=0', '#composer');
		await page.waitForFunction(() => window.received.length === 1);
		const [got] = await page.evaluate(() => window.received);
		assert.deepEqual(got, {
			name: 'Antrag & Co.docx',
			type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			text: 'original text +edit +edit'
		});
	});

	await step('"In Chat legen" hands over an older version from the keyboard', async () => {
		await page.focus('.wac-chip >> nth=1 >> button:has-text("In Chat legen")');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => window.received.length === 2);
		assert.equal((await page.evaluate(() => window.received))[1].text, 'original text +edit');
	});

	await step('back to the tools asks before dropping unsaved changes', async () => {
		await frame().locator('#edit').click();
		await page.locator('.wac-state.dirty').waitFor();
		await page.click('.wac-head button[aria-label="Werkzeuge"]');
		assert.equal(confirms, 1);
		await page.locator('.wac-menu').waitFor();
	});

	await step('Tabelle starts an empty GridCraft; an .xlsx file and a .pdf open in theirs', async () => {
		await page.click('.wac-tile[data-editor=gridcraft]');
		await frame().locator('#state').filter({ hasText: 'waiting' }).waitFor();
		assert.match(await page.getAttribute('.wac iframe', 'src'), /gridcraft/);
		await page.click('.wac-head button[aria-label="Werkzeuge"]');
		await page.setInputFiles('.wac input[type=file]', { name: 'Haushalt.xlsx', mimeType: '', buffer: Buffer.from('grid') });
		await frame().locator('#state').filter({ hasText: 'opened Haushalt.xlsx' }).waitFor();
		await page.setInputFiles('.wac input[type=file]', { name: 'Bescheid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
		await frame().locator('#state').filter({ hasText: 'opened Bescheid.pdf' }).waitFor();
		assert.match(await page.getAttribute('.wac iframe', 'src'), /pdfcraft/);
	});

	await step('a file no editor opens is refused with a message', async () => {
		await page.setInputFiles('.wac input[type=file]', { name: 'tool.exe', mimeType: '', buffer: Buffer.from('MZ') });
		await page.waitForFunction(() => window.notices.some((n) => n.type === 'warning' && n.text.includes('tool.exe')));
	});

	await step('another chat clears the Ablage, so nothing is dropped into the wrong case', async () => {
		await page.evaluate(() => window.addon.update({ ...window.addonProps, sessionId: 2 }));
		assert.equal(await page.locator('.wac-chip').count(), 0);
		await page.locator('.wac-menu').waitFor();
	});

	await step("the editors' recent-file lists are emptied on unmount", async () => {
		await page.evaluate(() => localStorage.setItem('wordcraft.ui', JSON.stringify({ recent: ['Antrag.docx'], theme: 'light' })));
		await page.evaluate(() => window.addon.unmount({ ...window.addonProps, sessionId: 2 }));
		assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('wordcraft.ui'))), { recent: [], theme: 'light' });
	});

	assert.deepEqual(errors, []);
	console.log(`\n${results.length} browser checks passed`);
} finally {
	await browser.close();
	server.close();
}
