export const NAME = 'wasm-artcraft';

/**
 * Editors shipped under /ui/craft/<id>/ (static web builds of the ArtCraft Crafting Apps).
 * `extensions` decides which editor opens a file; `types` gives a saved file its MIME type,
 * so the chat accepts it (ORISO allows PDF, DOCX and XLSX attachments).
 */
export const EDITORS = [
	{
		id: 'wordcraft',
		label: { de: 'Text', en: 'Text' },
		extensions: ['.docx', '.doc', '.odt', '.rtf', '.txt', '.md', '.html'],
		newFile: 'Dokument.docx'
	},
	{
		id: 'gridcraft',
		label: { de: 'Tabelle', en: 'Spreadsheet' },
		extensions: ['.xlsx', '.xls', '.ods', '.csv'],
		newFile: 'Tabelle.xlsx'
	},
	{
		id: 'pdfcraft',
		label: { de: 'PDF', en: 'PDF' },
		extensions: ['.pdf'],
		newFile: null
	}
];

export const manifest = {
	name: NAME,
	version: '0.1.0',
	contract: 'oriso-addon/v1',
	ui: '/ui/entry.js',
	apps: [
		{
			id: 'office',
			title: { de: 'Dokumente', en: 'Documents' },
			description: {
				de: 'Word-, Excel- und PDF-Dateien neben dem Chat bearbeiten und als Anhang weitergeben. Alles bleibt im Browser.',
				en: 'Edit Word, Excel and PDF files beside the chat and pass them on as attachments. Everything stays in the browser.'
			},
			icon: '/ui/icons/office.svg',
			slots: ['consultant.session', 'consultant.session-menu', 'asker.session-menu'],
			visibility: 'static'
		}
	],
	health: '/health'
};
