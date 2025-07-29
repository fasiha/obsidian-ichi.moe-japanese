import * as cheerio from 'cheerio';
import { Element } from 'cheerio';
import { Editor, FileSystemAdapter, MarkdownView, normalizePath, Notice, Plugin, requestUrl } from 'obsidian';
import * as JSZip from 'jszip';

interface Alternative {
	reading: string;
	definitions: string[];
}

interface FuriganaEntry {
	ruby: string;
	rt?: string;
}

interface JmdictEntry {
	text: string;
	reading: string;
	furigana: FuriganaEntry[];
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
async function analyzeText(editor: Editor, furiganaMap: Map<string, FuriganaEntry[]>) {
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
	furiganaMap: Map<string, FuriganaEntry[]>
): string {
	if (!reading) {
		return word;
	}

	const key = `${word}-${reading}`;
	const furiganaData = furiganaMap.get(key);

	if (!furiganaData) {
		// Fallback to bracket notation
		return `${word} 【${reading}】`;
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

	return result;
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

	// Parse words from the first visible gloss-row
	const firstGlossRow = $('.gloss-row').not('.hidden').first();

	if (firstGlossRow.length > 0) {
		const glossElements = firstGlossRow.find('.gloss');

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
	}

	return {
		original: originalText,
		romanization,
		words,
	};
}

/**
 * Insert the analysis into the editor
 */
function insertAnalysis(editor: Editor, sentenceInfo: SentenceInfo, furiganaMap: Map<string, FuriganaEntry[]>) {
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

	let analysisText = '\n';

	// Create callout with collapsible format
	analysisText += `> [!IchiMoe]- ${sentenceInfo.original}\n`;

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
					const formattedAlt = formatWordWithRuby(altWord, altReading, furiganaMap);
					analysisText += `>   - ${formattedAlt}\n`;

					// Third level: definitions for this reading
					alternative.definitions.forEach((def) => {
						analysisText += `>     - ${def}\n`;
					});
				});
			} else {
				// Single alternative case - two-level structure
				const formattedWord = formatWordWithRuby(wordInfo.word, wordInfo.reading, furiganaMap);
				analysisText += `> - ${formattedWord}\n`;

				// Second level bullets: definitions
				if (wordInfo.definitions) {
					wordInfo.definitions.forEach((def) => {
						analysisText += `>   - ${def}\n`;
					});
				}
			}
		});
	} else {
		analysisText +=
			'> *No word definitions found. The text might be too complex or ichi.moe might be having issues.*\n';
	}

	analysisText += '\n';

	// Insert at end of line position
	try {
		editor.replaceRange(analysisText, endOfLinePosition);
		new Notice(`Analysis inserted for: ${sentenceInfo.original}`);
	} catch (error) {
		console.error('IchiMoe: Error inserting analysis:', error);
		new Notice('Error inserting analysis into editor');
	}
}
export default class IchiMoePlugin extends Plugin {
	private furiganaMap: Map<string, FuriganaEntry[]> = new Map();

	async onload() {
		// Load JmdictFurigana data
		await this.loadFuriganaData();

		// Add command to analyze Japanese text
		this.addCommand({
			id: 'analyze-japanese-text',
			name: 'Analyze Japanese text with ichi.moe',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				analyzeText(editor, this.furiganaMap);
			},
		});
	}

	private async loadFuriganaData() {
		try {
			const pluginFolder = this.manifest.dir; // This usually gives you the plugin's root directory
			const binaryFilePath = normalizePath(`${pluginFolder}/JmdictFurigana.json.zip`);
			console.log('binaryFilePath,', binaryFilePath);
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

				// Convert kana-only entries to plain strings
				const processedFurigana = entry.furigana.map((f) => {
					if (!f.rt) {
						// This is plain kana, we'll handle it differently in display
						return f;
					}
					return f;
				});

				this.furiganaMap.set(key, processedFurigana);
			}

			new Notice(`Loaded ${this.furiganaMap.size} furigana entries`);
		} catch (error) {
			console.error('Failed to load JmdictFurigana data:', error);
			new Notice('Could not load furigana data. Ruby tags will not be available.');
		}
	}

	onunload() {}
}
