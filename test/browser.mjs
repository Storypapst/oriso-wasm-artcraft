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

	await step('three sizes: beside the chat leaves it free, full screen covers it, Esc steps back', async () => {
		await page.click('.wac-head button[aria-label="Neben dem Chat"]');
		let box = await page.locator('.wac').boundingBox();
		assert.ok(box.x >= 380, `beside the chat starts at ${box.x}`);
		assert.ok(box.width > 700 && box.y >= 0 && box.y + box.height <= 900, `beside the chat: ${JSON.stringify(box)}`);
		await page.click('.wac-head button[aria-label="Vollbild"]');
		box = await page.locator('.wac').boundingBox();
		assert.ok(box.x <= 16 && box.width >= 1360 && box.y + box.height <= 900, `full screen: ${JSON.stringify(box)}`);
		assert.equal(await page.getAttribute('.wac-head button[aria-label="Vollbild"]', 'aria-pressed'), 'true');
		assert.match(await frame().locator('#state').textContent(), /opened Antrag & Co.docx/, 'editor was not reloaded');
		await page.keyboard.press('Escape');
		assert.equal(await page.locator('.wac.wide').count(), 1, 'Esc: full screen → beside the chat');
		await page.keyboard.press('Escape');
		assert.equal(await page.locator('.wac.wide, .wac.full').count(), 0, 'Esc: beside the chat → side panel');
	});

	await step('zoom scales the editor and is remembered per program', async () => {
		await page.click('.wac-head button[aria-label="Vergrößern"]');
		assert.equal(await page.textContent('.wac-zoom'), '110 %');
		assert.match(await page.getAttribute('.wac iframe', 'style'), /scale\(1\.1\)/);
		await page.click('.wac-head button[aria-label="Verkleinern"]');
		await page.click('.wac-head button[aria-label="Verkleinern"]');
		assert.equal(await page.textContent('.wac-zoom'), '90 %');
		assert.equal(await page.evaluate(() => localStorage.getItem('wac.zoom.wordcraft')), '0.9');
		await page.click('.wac-zoom');
		assert.equal(await page.textContent('.wac-zoom'), '100 %');
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

	await step('starting to drag a version out of full screen shrinks the window so the chat is free', async () => {
		await page.click('.wac-head button[aria-label="Vollbild"]');
		// The drop itself is covered above; here only the panel's reaction to a drag start.
		await page.evaluate(() => {
			const chip = document.querySelector('.wac-chip');
			chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
			chip.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
		});
		assert.equal(await page.locator('.wac.wide').count(), 1);
		await page.keyboard.press('Escape');
	});

	await step('"In neuem Tab öffnen" moves the document to a tab whose saves land in the Ablage', async () => {
		const [tab] = await Promise.all([
			page.context().waitForEvent('page'),
			page.click('.wac-head button[aria-label="In neuem Tab öffnen"]')
		]);
		await tab.waitForLoadState();
		const tabFrame = tab.frameLocator('iframe');
		await tabFrame.locator('#state').filter({ hasText: 'opened Antrag & Co.docx: original text +edit +edit' }).waitFor();
		assert.match(await page.textContent('.wac-away'), /eigenen Tab/);
		assert.equal(await page.locator('.wac-stage iframe').count(), 0, 'no second editor in the panel');
		await tabFrame.locator('#edit').click();
		await tabFrame.locator('#save').click();
		await page.locator('.wac-chip-meta').filter({ hasText: /^Version 3 · / }).waitFor();
		await tab.close();
		await page.locator('.wac-stage iframe').waitFor();
		await frame().locator('#state').filter({ hasText: '+edit +edit +edit' }).waitFor();
	});

	await step('leaving a tab for the tools menu detaches it; closing it later does not break the panel', async () => {
		const [tab] = await Promise.all([
			page.context().waitForEvent('page'),
			page.click('.wac-head button[aria-label="In neuem Tab öffnen"]')
		]);
		await tab.waitForLoadState();
		await page.click('.wac-head button[aria-label="Werkzeuge"]');
		await page.locator('.wac-menu').waitFor();
		await tab.close().catch(() => {});
		await page.waitForTimeout(300);
		assert.equal(await page.locator('.wac-menu').count(), 1, 'the menu stays');
		assert.deepEqual(errors, [], 'no error in the panel');
		await page.click('.wac-tile[data-editor=wordcraft]');
		await frame().locator('#state').waitFor();
		assert.equal(await page.locator('.wac-away').count(), 0, 'the new editor is not hidden behind a tab notice');
	});

	await step('"Hier weiterarbeiten" asks before dropping unsaved edits made in the tab', async () => {
		await page.click('.wac-head button[aria-label="Werkzeuge"]');
		await page.locator('.wac-chip').filter({ hasText: /Version 3 · / }).locator('button:has-text("Öffnen")').click();
		await frame().locator('#state').filter({ hasText: 'opened' }).waitFor();
		const [tab] = await Promise.all([
			page.context().waitForEvent('page'),
			page.click('.wac-head button[aria-label="In neuem Tab öffnen"]')
		]);
		await tab.waitForLoadState();
		await tab.frameLocator('iframe').locator('#state').filter({ hasText: 'opened' }).waitFor();
		await tab.frameLocator('iframe').locator('#edit').click();
		await page.locator('.wac-state.dirty').waitFor();
		const before = confirms;
		await page.click('.wac-away button');
		assert.equal(confirms, before + 1, 'asked before discarding');
		await frame().locator('#state').filter({ hasText: 'opened' }).waitFor();
	});

	await step('"In Chat legen" hands over an older version from the keyboard', async () => {
		const versionOne = page.locator('.wac-chip').filter({ hasText: /Version 1 · / });
		await versionOne.locator('button:has-text("In Chat legen")').focus();
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => window.received.length === 2);
		assert.equal((await page.evaluate(() => window.received))[1].text, 'original text +edit');
	});

	await step('back to the tools asks before dropping unsaved changes', async () => {
		await frame().locator('#edit').click();
		await page.locator('.wac-state.dirty').waitFor();
		const before = confirms;
		await page.click('.wac-head button[aria-label="Werkzeuge"]');
		assert.equal(confirms, before + 1);
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

	await step('a file still being read when the chat changes is not opened in the new chat', async () => {
		await page.evaluate(() => {
			const read = Blob.prototype.arrayBuffer;
			window.originalRead = read;
			window.releaseRead = null;
			Blob.prototype.arrayBuffer = function () {
				return new Promise((ok) => {
					window.releaseRead = () => ok(read.call(this));
				});
			};
		});
		await page.click('.wac-head button[aria-label="Werkzeuge"]').catch(() => {});
		await page.setInputFiles('.wac input[type=file]', { name: 'Fall-eins.docx', mimeType: '', buffer: Buffer.from('case one') });
		await page.waitForFunction(() => typeof window.releaseRead === 'function');
		await page.evaluate(() => window.addon.update({ ...window.addonProps, sessionId: 3 }));
		await page.evaluate(() => window.releaseRead());
		await page.waitForTimeout(300);
		assert.equal(await page.locator('.wac iframe').count(), 0, 'no editor opened');
		await page.locator('.wac-menu').waitFor();
		await page.evaluate(() => {
			Blob.prototype.arrayBuffer = window.originalRead;
		});
	});

	await step('another chat clears the Ablage and the editors\' recent-file lists', async () => {
		await page.evaluate(() => localStorage.setItem('gridcraft.ui', JSON.stringify({ recent: ['Fall-eins.xlsx'] })));
		await page.evaluate(() => window.addon.update({ ...window.addonProps, sessionId: 2 }));
		assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('gridcraft.ui'))), { recent: [] });
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
