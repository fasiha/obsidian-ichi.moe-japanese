import * as cheerio from 'cheerio';
import { Editor, MarkdownView, Notice, Plugin, requestUrl } from 'obsidian';

interface WordInfo {
	word: string;
	reading?: string;
	definitions: string[];
	pos?: string; // part of speech
}

interface SentenceInfo {
	original: string;
	romanization?: string;
	words: WordInfo[];
}

export default class IchiMoePlugin extends Plugin {
	async onload() {
		// Add command to analyze Japanese text
		this.addCommand({
			id: 'analyze-japanese-text',
			name: 'Analyze Japanese text with ichi.moe',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.analyzeText(editor);
			},
		});
	}

	onunload() {}

	/**
	 * Get selected text or current line if no selection
	 */
	getTextToAnalyze(editor: Editor): string {
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
	async analyzeText(editor: Editor) {
		const text = this.getTextToAnalyze(editor);

		if (!text) {
			new Notice('No text to analyze');
			return;
		}

		new Notice('Analyzing Japanese text...');

		try {
			const sentenceInfo = await this.fetchIchiMoeAnalysis(text);
			this.insertAnalysis(editor, sentenceInfo);
		} catch (error) {
			console.error('IchiMoe: Error analyzing text:', error);
			console.error('IchiMoe: Error stack:', error.stack);
			new Notice('Failed to analyze text with ichi.moe');
		}
	}

	/**
	 * Fetch analysis from ichi.moe
	 */
	async fetchIchiMoeAnalysis(text: string): Promise<SentenceInfo> {
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

			return this.parseIchiMoeResponse(response.text, text);
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
	parseIchiMoeResponse(html: string, originalText: string): SentenceInfo {
		const $ = cheerio.load(html);
		const words: WordInfo[] = [];

		// Find romanization from ds-word elements
		const romanizationParts: string[] = [];
		$('.ds-text .ds-word').each((index: number, element: any) => {
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

			glossElements.each((index: number, element: any) => {
				const $glossElement = $(element);

				// Get romanized text from gloss-rtext
				const romanizedText = $glossElement.find('.gloss-rtext em').text().trim();

				// Get Japanese word and reading from dt element
				const dtElement = $glossElement.find('.gloss-content dt').first();
				const dtText = dtElement.text().trim();

				let word = '';
				let reading: string | undefined;

				if (dtText) {
					// Parse "日本語 【にほんご】" format
					const match = dtText.match(/^([^【]+)(?:【([^】]+)】)?/);
					if (match) {
						word = match[1].trim();
						reading = match[2] ? match[2].trim() : undefined;
					} else {
						// Fallback to the whole text if pattern doesn't match
						word = dtText;
					}
				} else if (romanizedText) {
					// Fallback to romanized text if no dt found
					word = romanizedText;
				}

				if (!word) {
					return;
				}

				// Get definitions from gloss-desc elements
				const definitions: string[] = [];
				$glossElement.find('li').each((defIndex: number, liElement: any) => {
					const $liElement = $(liElement);

					// Get part of speech and definition text
					const posDesc = $liElement.find('.pos-desc').text().trim();
					const glossDesc = $liElement.find('.gloss-desc').text().trim();

					if (glossDesc) {
						let definition = '';
						if (posDesc) {
							definition += `(${posDesc}) `;
						}
						definition += glossDesc;

						// Check for notes and add them with ☝️ emoji
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
					const wordInfo = {
						word,
						reading,
						definitions,
					};
					words.push(wordInfo);
				}
			});
		}

		// Fallback parsing if no words found
		if (words.length === 0) {
			// Try to extract from any .gloss elements
			$('.gloss').each((index: number, element: any) => {
				const $element = $(element);

				// Get word from dt or romanized text
				const dtText = $element.find('dt').first().text().trim();
				const romanizedText = $element.find('.gloss-rtext em').text().trim();

				let word = '';
				let reading: string | undefined;

				if (dtText) {
					const match = dtText.match(/^([^【]+)(?:【([^】]+)】)?/);
					if (match) {
						word = match[1].trim();
						reading = match[2] ? match[2].trim() : undefined;
					}
				} else if (romanizedText) {
					word = romanizedText;
				}

				if (!word) return;

				// Get definitions
				const definitions: string[] = [];
				$element.find('li').each((defIndex: number, liElement: any) => {
					const $liElement = $(liElement);

					// Get part of speech and definition text
					const posDesc = $liElement.find('.pos-desc').text().trim();
					const glossDesc = $liElement.find('.gloss-desc').text().trim();

					if (glossDesc) {
						let definition = '';
						if (posDesc) {
							definition += `(${posDesc}) `;
						}
						definition += glossDesc;

						// Check for notes and add them with ☝️ emoji
						const note = $liElement.find('.sense-info-note');
						if (note.length > 0) {
							const noteText = note.attr('title') || note.attr('data-tooltip');
							if (noteText) {
								definition += ` (☝️ ${noteText})`;
							}
						}

						if (!definitions.includes(definition)) {
							definitions.push(definition);
						}
					}
				});

				if (definitions.length > 0) {
					words.push({
						word,
						reading,
						definitions,
					});
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
	insertAnalysis(editor: Editor, sentenceInfo: SentenceInfo) {
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
				// First level bullet: word with reading
				if (wordInfo.reading) {
					analysisText += `> - ${wordInfo.word} 【${wordInfo.reading}】\n`;
				} else {
					analysisText += `> - ${wordInfo.word}\n`;
				}

				// Second level bullets: definitions
				wordInfo.definitions.forEach((def) => {
					analysisText += `>   - ${def}\n`;
				});
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
}
