import * as cheerio from 'cheerio';
import { Element } from 'cheerio';
import {
	App,
	Editor,
	MarkdownView,
	normalizePath,
	Notice,
	Plugin,
	PluginSettingTab,
	requestUrl,
	Setting,
} from 'obsidian';
import * as JSZip from 'jszip';

interface Alternative {
	reading: string;
	definitions: string[];
}

interface Furigana {
	ruby: string;
	rt?: string;
}

interface JmdictEntry {
	text: string;
	reading: string;
	furigana: Furigana[];
}

interface WordInfo {
	word: string;
	alternatives?: Alternative[]; // For multiple readings/forms
	reading?: string; // For single reading (backwards compatibility)
	definitions?: string[]; // For single form (backwards compatibility)
	pos?: string; // part of speech
}

interface SentenceInfo {
	original: string;
	romanization?: string;
	words: WordInfo[];
}

interface IchiMoeSettings {
	jmdictFuriganaPath: string;
}

const DEFAULT_SETTINGS: IchiMoeSettings = {
	jmdictFuriganaPath: '/JmdictFurigana.json.zip',
};

/**
 * Get selected text or current line if no selection
 */
function getTextToAnalyze(editor: Editor): string {
	const selection = editor.getSelection();

	if (selection && selection.trim().length > 0) {
		return selection.trim();
	}

	// If no selection, get current line
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	return line.trim();
}

/**
 * Send text to ichi.moe and parse the response
 */
async function analyzeText(editor: Editor, furiganaMap: Map<string, Furigana[]>) {
	const text = getTextToAnalyze(editor);

	if (!text) {
		new Notice('No text to analyze');
		return;
	}

	new Notice('Analyzing Japanese text...');

	try {
		const sentenceInfo = await fetchIchiMoeAnalysis(text);
		insertAnalysis(editor, sentenceInfo, furiganaMap);
	} catch (error) {
		console.error('IchiMoe: Error analyzing text:', error);
		console.error('IchiMoe: Error stack:', error.stack);
		new Notice('Failed to analyze text with ichi.moe');
	}
}

/**
 * Format a word with ruby tags using furigana data
 */
function formatWordWithRuby(
	word: string,
	reading: string | undefined,
	furiganaMap: Map<string, Furigana[]>
): { result: string; furiganaData?: Furigana[] } {
	if (!reading) {
		return { result: word };
	}

	const key = `${word}-${reading}`;
	const furiganaData = furiganaMap.get(key);

	if (!furiganaData) {
		// Fallback to bracket notation
		return { result: `${word} 【${reading}】` };
	}

	// Build ruby tags from furigana data
	let result = '';
	for (const entry of furiganaData) {
		if (entry.rt) {
			// Has furigana reading
			result += `<ruby>${entry.ruby}<rt>${entry.rt}</rt></ruby>`;
		} else {
			// Plain kana, no ruby tag needed
			result += entry.ruby;
		}
	}

	return { result, furiganaData };
}

/**
 * Apply ruby tags to the entire sentence using identified words
 */
function applySentenceRubyTags(originalSentence: string, allFurigana: Furigana[][]): string {
	// Strip leading and trailing non-kanji (no rt) strings from each furigana array
	const stripped = allFurigana
		.map((arr) => {
			// strip leading and trailing non-kanji strings
			const firstIdx = arr.findIndex((obj) => obj.rt);
			const lastIdx = arr.findLastIndex((obj) => !!obj.rt);
			const subArray = arr.slice(firstIdx, lastIdx + 1);
			const base = subArray.map((obj) => obj.ruby).join('');
			return { furigana: subArray, base };
		})
		.sort((a, b) => b.base.length - a.base.length);

	let result: (string | Furigana[])[] = [originalSentence];

	// Continually split the sentence into strings where we haven't mapped any furigana versus furigana.
	// This guarantees that we only add furigana to substrings that we haven't already mapped.
	for (const { base, furigana } of stripped) {
		let subIdx = -1;
		while ((subIdx = result.findIndex((x) => typeof x === 'string' && x.includes(base))) >= 0) {
			const substring = result[subIdx];
			if (typeof substring !== 'string') continue;

			const farLeft = result.slice(0, subIdx);
			const farRight = result.slice(subIdx + 1);

			const idx = substring.indexOf(base);
			const left = substring.slice(0, idx);
			const right = substring.slice(idx + base.length);

			// try to combine adjacent strings
			if (typeof farLeft[farLeft.length - 1] === 'string') {
				farLeft[farLeft.length - 1] += left;
			} else {
				farLeft.push(left);
			}

			if (typeof farRight[0] === 'string') {
				farRight[0] = `${right}${farRight[0]}`;
			} else {
				farRight.unshift(right);
			}

			result = [...farLeft, furigana, ...farRight];
		}
	}

	return result
		.map((x) =>
			typeof x === 'string' ? x : x.map(({ ruby, rt }) => (rt ? `<ruby>${ruby}<rt>${rt}</rt></ruby>` : ruby)).join('')
		)
		.join('');
}

/**
 * Fetch analysis from ichi.moe
 */
async function fetchIchiMoeAnalysis(text: string): Promise<SentenceInfo> {
	const url = `https://ichi.moe/cl/qr/?q=${encodeURIComponent(text)}`;

	try {
		const response = await requestUrl({
			url: url,
			method: 'GET',
		});

		if (response.status !== 200) {
			console.error('IchiMoe: Non-200 response:', response.status, response.text);
			throw new Error(`HTTP ${response.status}: ${response.text}`);
		}

		return parseIchiMoeResponse(response.text, text);
	} catch (error) {
		console.error('IchiMoe: Error fetching from ichi.moe:', error);
		console.error('IchiMoe: Error details:', {
			name: error.name,
			message: error.message,
			stack: error.stack,
		});
		throw new Error(`Failed to fetch analysis from ichi.moe: ${error.message}`);
	}
}

/**
 * Parse the HTML response from ichi.moe
 */
function parseIchiMoeResponse(html: string, originalText: string): SentenceInfo {
	const $ = cheerio.load(html);
	const words: WordInfo[] = [];

	// Find romanization from ds-word elements
	const romanizationParts: string[] = [];
	$('.ds-text .ds-word').each((index: number, element: Element) => {
		const wordText = $(element).text().trim();
		if (wordText) {
			romanizationParts.push(wordText);
		}
	});
	const romanization = romanizationParts.length > 0 ? romanizationParts.join(' ') : undefined;

	// Parse words from all visible gloss-rows
	const glossRows = $('.gloss-row').not('.hidden');
	glossRows.each((rowIndex: number, rowElement: Element) => {
		const $glossRow = $(rowElement);
		const glossElements = $glossRow.find('.gloss');

		glossElements.each((index: number, element: Element) => {
			const $glossElement = $(element);

			// Get romanized text from gloss-rtext
			const romanizedText = $glossElement.find('.gloss-rtext em').text().trim();

			// Check for alternatives structure
			const dtElements = $glossElement.find('.gloss-content .alternatives dt');

			if (dtElements.length > 1) {
				// Multiple alternatives case (like 中 with ちゅう and じゅう)
				const baseWord = romanizedText || 'unknown';
				const alternatives: Alternative[] = [];

				dtElements.each((dtIndex: number, dtElement: Element) => {
					const $dtElement = $(dtElement);
					const dtText = $dtElement.text().trim();

					// Strip leading numbers (e.g., "1. 中 【ちゅう】" -> "中 【ちゅう】")
					const cleanedDtText = dtText.replace(/^\d+\.\s*/, '');

					// Use the cleaned text as-is for the reading (no parsing)
					const reading = cleanedDtText;

					// Get definitions for this alternative from the following dd element
					const $ddElement = $dtElement.next('dd');
					const definitions: string[] = [];

					$ddElement.find('li').each((liIndex: number, liElement: Element) => {
						const $liElement = $(liElement);

						const posDesc = $liElement.find('.pos-desc').text().trim();
						const glossDesc = $liElement.find('.gloss-desc').text().trim();

						if (glossDesc) {
							let definition = '';
							if (posDesc) {
								definition += `(${posDesc}) `;
							}
							definition += glossDesc;

							// Check for notes
							const note = $liElement.find('.sense-info-note');
							if (note.length > 0) {
								const noteText = note.attr('title') || note.attr('data-tooltip');
								if (noteText) {
									definition += ` (☝️ ${noteText})`;
								}
							}

							definitions.push(definition);
						}
					});

					if (definitions.length > 0) {
						alternatives.push({ reading, definitions });
					}
				});

				if (alternatives.length > 0) {
					// Extract the base word from the first alternative
					const firstDtText = dtElements
						.first()
						.text()
						.trim()
						.replace(/^\d+\.\s*/, '');
					const wordMatch = firstDtText.match(/^([^【]+)/);
					const word = wordMatch?.[1]?.trim() || baseWord;

					words.push({
						word,
						alternatives,
					});
				}
			} else {
				// Single alternative case (existing logic)
				const dtElement = $glossElement.find('.gloss-content dt').first();
				const dtText = dtElement.text().trim();

				let word = '';
				let reading: string | undefined;

				if (dtText) {
					// Strip leading numbers and parse
					const cleanedDtText = dtText.replace(/^\d+\.\s*/, '');
					const match = cleanedDtText.match(/^([^【]+)(?:【([^】]+)】)?/);
					if (match) {
						word = match[1].trim();
						reading = match[2] ? match[2].trim() : undefined;
					} else {
						word = cleanedDtText;
					}
				} else if (romanizedText) {
					word = romanizedText;
				}

				if (!word) {
					return;
				}

				// Get definitions
				const definitions: string[] = [];
				$glossElement.find('li').each((defIndex: number, liElement: Element) => {
					const $liElement = $(liElement);

					const posDesc = $liElement.find('.pos-desc').text().trim();
					const glossDesc = $liElement.find('.gloss-desc').text().trim();

					if (glossDesc) {
						let definition = '';
						if (posDesc) {
							definition += `(${posDesc}) `;
						}
						definition += glossDesc;

						// Check for notes
						const note = $liElement.find('.sense-info-note');
						if (note.length > 0) {
							const noteText = note.attr('title') || note.attr('data-tooltip');
							if (noteText) {
								definition += ` (☝️ ${noteText})`;
							}
						}

						definitions.push(definition);
					}
				});

				if (definitions.length > 0) {
					words.push({
						word,
						reading,
						definitions,
					});
				}
			}
		});
	});

	return {
		original: originalText,
		romanization,
		words,
	};
}

/**
 * Insert the analysis into the editor
 */
function insertAnalysis(editor: Editor, sentenceInfo: SentenceInfo, furiganaMap: Map<string, Furigana[]>) {
	// Get the end position of selection, or current cursor if no selection
	const selection = editor.getSelection();
	let insertPosition;

	if (selection && selection.trim().length > 0) {
		// If there's a selection, get the end of the selection
		insertPosition = editor.getCursor('to');
	} else {
		// If no selection, use current cursor position
		insertPosition = editor.getCursor();
	}

	// Move to the end of the line and insert on next line
	const lineLength = editor.getLine(insertPosition.line).length;
	const endOfLinePosition = { line: insertPosition.line, ch: lineLength };

	let analysisText = '';

	// Maps "ruby"s to "rt"s
	const allFurigana: Furigana[][] = [];

	// Add word breakdown
	if (sentenceInfo.words.length > 0) {
		sentenceInfo.words.forEach((wordInfo) => {
			if (wordInfo.alternatives && wordInfo.alternatives.length > 0) {
				// Multiple alternatives case - three-level structure
				analysisText += `> - ${wordInfo.word}\n`;

				wordInfo.alternatives.forEach((alternative) => {
					// Extract word and reading from alternative reading string for furigana lookup
					const match = alternative.reading.match(/^([^【]+)(?:【([^】]+)】)?/);
					const altWord = match?.[1]?.trim() || alternative.reading;
					const altReading = match?.[2]?.trim();

					// Second level: alternative readings with ruby tags
					const { result: formattedAlt, furiganaData } = formatWordWithRuby(altWord, altReading, furiganaMap);
					analysisText += `>   - ${formattedAlt}\n`;

					// Third level: definitions for this reading
					alternative.definitions.forEach((def) => {
						analysisText += `>     - ${def}\n`;
					});

					if (furiganaData) {
						allFurigana.push(furiganaData);
					}
				});
			} else {
				// Single alternative case - two-level structure
				const { result: formattedWord, furiganaData } = formatWordWithRuby(
					wordInfo.word,
					wordInfo.reading,
					furiganaMap
				);
				analysisText += `> - ${formattedWord}\n`;

				// Second level bullets: definitions
				if (wordInfo.definitions) {
					wordInfo.definitions.forEach((def) => {
						analysisText += `>   - ${def}\n`;
					});
				}

				// Same as above
				if (furiganaData) {
					allFurigana.push(furiganaData);
				}
			}
		});
	} else {
		analysisText +=
			'> *No word definitions found. The text might be too complex or ichi.moe might be having issues.*\n';
	}

	analysisText += '\n';

	// Now go back and try to add ruby tags to the sentence for the callout
	const rubyTaggedSentence = applySentenceRubyTags(sentenceInfo.original, allFurigana);
	const head = `\n> [!IchiMoe]- ${rubyTaggedSentence}\n`;

	// Insert at end of line position
	try {
		const final = `${head}${analysisText}`;
		editor.replaceRange(final, endOfLinePosition);
		new Notice(`Analysis inserted for: ${sentenceInfo.original}`);
	} catch (error) {
		console.error('IchiMoe: Error inserting analysis:', error);
		new Notice('Error inserting analysis into editor');
	}
}
export default class IchiMoePlugin extends Plugin {
	settings: IchiMoeSettings;
	private furiganaMap: Map<string, Furigana[]> = new Map();

	async onload() {
		await this.loadSettings();

		// Load JmdictFurigana data
		await this.loadFuriganaData();

		// Add command to analyze Japanese text
		this.addCommand({
			id: 'analyze-japanese-text',
			name: 'Analyze Japanese text with ichi.moe',
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				analyzeText(editor, this.furiganaMap);
			},
		});

		// Add settings tab
		this.addSettingTab(new IchiMoeSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getFuriganaEntryCount(): number {
		return this.furiganaMap.size;
	}

	async loadFuriganaData() {
		this.furiganaMap.clear();

		try {
			const binaryFilePath = normalizePath(this.settings.jmdictFuriganaPath);
			const zipData = await this.app.vault.adapter.readBinary(binaryFilePath);

			const zipContent = await JSZip.loadAsync(zipData);

			// Get the JSON file from the zip
			const jsonFile = Object.values(zipContent.files)[0];
			if (!jsonFile) {
				throw new Error('No files found in zip');
			}
			const jsonText = await jsonFile.async('text');
			// trim initial byte order mark (BOM)
			const jmdictData: JmdictEntry[] = JSON.parse(jsonText.trimStart());

			// Build the lookup map
			for (const entry of jmdictData) {
				const key = `${entry.text}-${entry.reading}`;
				this.furiganaMap.set(key, entry.furigana);
			}

			new Notice(`Loaded ${this.furiganaMap.size} furigana entries`);
		} catch (error) {
			console.error('Failed to load JmdictFurigana data:', error);
			new Notice(
				`Could not load furigana data from ${this.settings.jmdictFuriganaPath}. Ruby tags will not be available.`
			);
		}
	}

	onunload() {}
}

class IchiMoeSettingTab extends PluginSettingTab {
	plugin: IchiMoePlugin;

	constructor(app: App, plugin: IchiMoePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	statusText(): string {
		return `Current status: ${this.plugin.getFuriganaEntryCount()} furigana entries loaded`;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName('Ichi.moe Japanese Analyzer Settings').setHeading();

		new Setting(containerEl)
			.setName('JmdictFurigana file path')
			.setDesc('Path to the JmdictFurigana.json.zip file in your vault.')
			.addText((text) =>
				text
					.setPlaceholder('/JmdictFurigana.json.zip')
					.setValue(this.plugin.settings.jmdictFuriganaPath)
					.onChange(async (value) => {
						this.plugin.settings.jmdictFuriganaPath = value;
						await this.plugin.saveSettings();
					})
			);

		// Create status element that we can update later
		const statusEl = containerEl.createEl('p', {
			text: this.statusText(),
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Reload furigana data')
			.setDesc('Reload the JmdictFurigana data from the current file path')
			.addButton((button) =>
				button
					.setButtonText('Reload')
					.setCta()
					.onClick(async () => {
						button.setButtonText('Reloading...');
						button.setDisabled(true);
						try {
							await this.plugin.loadFuriganaData();
						} finally {
							button.setButtonText('Reload');
							button.setDisabled(false);
							// Update the status after reload completes
							statusEl.textContent = this.statusText();
						}
					})
			);

		new Setting(containerEl).setName('Setup Instructions').setHeading();

		const instructionsList = containerEl.createEl('ol');

		// Step 1 with link
		const step1 = instructionsList.createEl('li');
		step1.appendText('Visit the ');
		const link = step1.createEl('a', {
			href: 'https://github.com/Doublevil/JmdictFurigana/releases',
			text: 'JmdictFurigana releases page',
		});
		link.setAttr('target', '_blank');

		const step2 = instructionsList.createEl('li');
		step2.appendText('Download a recent ');
		step2.createEl('code', { text: 'JmdictFurigana.json.zip' });

		instructionsList.createEl('li', { text: 'Place the zip file in your vault (e.g., at the root level)' });
		instructionsList.createEl('li', { text: 'Update the file path above to match your file location' });
		instructionsList.createEl('li', { text: 'Click "Reload" to load the furigana data' });
	}
}
