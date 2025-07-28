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
		console.log('IchiMoe: Getting text to analyze...');
		console.log('IchiMoe: Selection:', JSON.stringify(selection));

		if (selection && selection.trim().length > 0) {
			const trimmedSelection = selection.trim();
			console.log('IchiMoe: Using selected text:', JSON.stringify(trimmedSelection));
			return trimmedSelection;
		}

		// If no selection, get current line
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const trimmedLine = line.trim();
		console.log('IchiMoe: No selection, using current line:', JSON.stringify(trimmedLine));
		console.log('IchiMoe: Cursor position:', cursor);
		return trimmedLine;
	}

	/**
	 * Send text to ichi.moe and parse the response
	 */
	async analyzeText(editor: Editor) {
		console.log('IchiMoe: Starting text analysis...');
		const text = this.getTextToAnalyze(editor);

		console.log('IchiMoe: Text to analyze:', JSON.stringify(text));

		if (!text) {
			console.log('IchiMoe: No text found to analyze');
			new Notice('No text to analyze');
			return;
		}

		console.log('IchiMoe: Proceeding with analysis for text:', text);
		new Notice('Analyzing Japanese text...');

		try {
			const sentenceInfo = await this.fetchIchiMoeAnalysis(text);
			console.log('IchiMoe: Analysis successful, inserting results...');
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
		console.log('IchiMoe: Fetching from URL:', url);

		try {
			console.log('IchiMoe: Sending request to ichi.moe...');
			const response = await requestUrl({
				url: url,
				method: 'GET',
			});

			console.log('IchiMoe: Response status:', response.status);
			console.log('IchiMoe: Response headers:', response.headers);
			console.log('IchiMoe: Response text length:', response.text?.length || 0);

			if (response.status !== 200) {
				console.error('IchiMoe: Non-200 response:', response.status, response.text);
				throw new Error(`HTTP ${response.status}: ${response.text}`);
			}

			console.log('IchiMoe: Starting to parse response...');
			const result = this.parseIchiMoeResponse(response.text, text);
			console.log('IchiMoe: Parsing completed, result:', result);
			return result;
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
		console.log('IchiMoe: Loading HTML with cheerio...');
		console.log('IchiMoe: HTML preview (first 500 chars):', html.substring(0, 500));

		const $ = cheerio.load(html);
		const words: WordInfo[] = [];

		// Find romanization from ds-word elements
		console.log('IchiMoe: Looking for romanization in .ds-word elements...');
		const romanizationParts: string[] = [];
		$('.ds-text .ds-word').each((index: number, element: any) => {
			const wordText = $(element).text().trim();
			if (wordText) {
				romanizationParts.push(wordText);
			}
		});
		const romanization = romanizationParts.length > 0 ? romanizationParts.join(' ') : undefined;
		console.log('IchiMoe: Found .ds-word elements:', romanizationParts.length);
		console.log('IchiMoe: Romanization parts:', romanizationParts);
		console.log('IchiMoe: Combined romanization:', romanization);

		// Parse words from the first visible gloss-row
		console.log('IchiMoe: Looking for .gloss-row elements...');
		const firstGlossRow = $('.gloss-row').not('.hidden').first();
		console.log('IchiMoe: Found visible gloss-row:', firstGlossRow.length > 0);

		if (firstGlossRow.length > 0) {
			const glossElements = firstGlossRow.find('.gloss');
			console.log('IchiMoe: Found .gloss elements in first row:', glossElements.length);

			glossElements.each((index: number, element: any) => {
				console.log(`IchiMoe: Processing .gloss element ${index + 1}/${glossElements.length}`);
				const $glossElement = $(element);

				// Get romanized text from gloss-rtext
				const romanizedText = $glossElement.find('.gloss-rtext em').text().trim();
				console.log('IchiMoe: Found romanized text:', JSON.stringify(romanizedText));

				// Get Japanese word and reading from dt element
				const dtElement = $glossElement.find('.gloss-content dt').first();
				const dtText = dtElement.text().trim();
				console.log('IchiMoe: Found dt text:', JSON.stringify(dtText));

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

				console.log('IchiMoe: Parsed word:', JSON.stringify(word));
				console.log('IchiMoe: Parsed reading:', JSON.stringify(reading));

				if (!word) {
					console.log('IchiMoe: Skipping element with no word');
					return;
				}

				// Get definitions from gloss-desc elements
				const definitions: string[] = [];
				$glossElement.find('.gloss-desc').each((defIndex: number, defElement: any) => {
					const defText = $(defElement).text().trim();
					if (defText) {
						definitions.push(defText);
					}
				});

				console.log('IchiMoe: Found definitions:', definitions);

				if (definitions.length > 0) {
					const wordInfo = {
						word,
						reading,
						definitions,
					};
					console.log('IchiMoe: Adding word info:', wordInfo);
					words.push(wordInfo);
				} else {
					console.log('IchiMoe: Skipping word due to no definitions:', word);
				}
			});
		}

		// Fallback parsing if no words found
		console.log('IchiMoe: Primary parsing found', words.length, 'words');
		if (words.length === 0) {
			console.log('IchiMoe: No words found with primary method, trying fallback parsing...');

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
				$element.find('.gloss-desc').each((defIndex: number, defElement: any) => {
					const defText = $(defElement).text().trim();
					if (defText && !definitions.includes(defText)) {
						definitions.push(defText);
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

		const result = {
			original: originalText,
			romanization,
			words,
		};

		console.log('IchiMoe: Final parsing result:', result);
		console.log('IchiMoe: Total words extracted:', words.length);
		return result;
	}

	/**
	 * Insert the analysis into the editor
	 */
	insertAnalysis(editor: Editor, sentenceInfo: SentenceInfo) {
		console.log('IchiMoe: Inserting analysis...');
		console.log('IchiMoe: Sentence info to insert:', sentenceInfo);

		const cursor = editor.getCursor();
		console.log('IchiMoe: Current cursor position:', cursor);

		let analysisText = '\n\n---\n\n';

		// Add title
		analysisText += `**Japanese Analysis: ${sentenceInfo.original}**\n\n`;

		// Add romanization if available
		if (sentenceInfo.romanization) {
			analysisText += `*Romanization:* ${sentenceInfo.romanization}\n\n`;
		}

		// Add word breakdown
		if (sentenceInfo.words.length > 0) {
			analysisText += '**Word Breakdown:**\n\n';

			sentenceInfo.words.forEach((wordInfo, index) => {
				analysisText += `${index + 1}. **${wordInfo.word}**`;

				if (wordInfo.reading) {
					analysisText += ` (${wordInfo.reading})`;
				}

				analysisText += '\n';

				wordInfo.definitions.forEach((def, defIndex) => {
					analysisText += `   - ${def}\n`;
				});

				analysisText += '\n';
			});
		} else {
			analysisText +=
				'*No word definitions found. The text might be too complex or ichi.moe might be having issues.*\n\n';
		}

		analysisText += '---\n\n';

		console.log('IchiMoe: Final analysis text to insert:');
		console.log(analysisText);
		console.log('IchiMoe: Analysis text length:', analysisText.length);

		// Insert at cursor position
		try {
			editor.replaceRange(analysisText, cursor);
			console.log('IchiMoe: Successfully inserted analysis text');
			new Notice(`Analysis inserted for: ${sentenceInfo.original}`);
		} catch (error) {
			console.error('IchiMoe: Error inserting analysis:', error);
			new Notice('Error inserting analysis into editor');
		}
	}
}
