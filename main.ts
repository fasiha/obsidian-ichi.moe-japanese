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

		// Find romanization
		console.log('IchiMoe: Looking for romanization...');
		const romanizationElement = $('.ds-input').first();
		const romanization = romanizationElement.text().trim() || undefined;
		console.log('IchiMoe: Found romanization element count:', $('.ds-input').length);
		console.log('IchiMoe: Romanization:', romanization);

		// Parse word glosses - ichi.moe shows words in sections
		console.log('IchiMoe: Looking for .gloss-all elements...');
		const glossAllElements = $('.gloss-all');
		console.log('IchiMoe: Found .gloss-all elements:', glossAllElements.length);

		glossAllElements.each((index: number, element: any) => {
			console.log(`IchiMoe: Processing .gloss-all element ${index + 1}/${glossAllElements.length}`);
			const $element = $(element);

			// Get the word text
			const wordElement = $element.find('.ds-text').first();
			const word = wordElement.text().trim();
			console.log('IchiMoe: Found word:', JSON.stringify(word));

			if (!word) {
				console.log('IchiMoe: Skipping empty word');
				return;
			}

			// Get reading (furigana)
			const readingElement = $element.find('.ds-furigana').first();
			const reading = readingElement.text().trim() || undefined;
			console.log('IchiMoe: Found reading:', JSON.stringify(reading));

			// Get definitions
			const definitions: string[] = [];
			console.log('IchiMoe: Looking for definitions...');
			$element.find('.gloss-content').each((defIndex: number, defElement: any) => {
				const $defElement = $(defElement);

				// Extract definition text
				const defText = $defElement.find('.gloss-content').text().trim();
				if (defText) {
					definitions.push(defText);
				}

				// Alternative: look for definition list items
				$defElement.find('li').each((liIndex: number, liElement: any) => {
					const liText = $(liElement).text().trim();
					if (liText && !definitions.includes(liText)) {
						definitions.push(liText);
					}
				});
			});

			// Extract definitions from the word info sections
			$element.find('.word-info').each((wordIndex: number, wordElement: any) => {
				const $wordElement = $(wordElement);

				// Look for definition content
				const defList = $wordElement.find('.gloss-content').text().trim();

				if (defList && !definitions.some((def) => def.includes(defList))) {
					definitions.push(defList);
				}
			});

			console.log('IchiMoe: Definitions found for word:', definitions.length);
			if (word && definitions.length > 0) {
				const wordInfo = {
					word,
					reading,
					definitions,
				};
				console.log('IchiMoe: Adding word info:', wordInfo);
				words.push(wordInfo);
			} else {
				console.log('IchiMoe: Skipping word due to missing definitions:', {
					word,
					definitionsCount: definitions.length,
				});
			}
		});

		// Alternative parsing approach for different HTML structure
		console.log('IchiMoe: Primary parsing found', words.length, 'words');
		if (words.length === 0) {
			console.log('IchiMoe: No words found with primary method, trying alternative parsing...');
			const alternativeElements = $('.word-block, .gloss');
			console.log('IchiMoe: Found alternative elements:', alternativeElements.length);

			// Try parsing word blocks directly
			alternativeElements.each((index: number, element: any) => {
				console.log(`IchiMoe: Processing alternative element ${index + 1}/${alternativeElements.length}`);
				const $element = $(element);

				const word = $element.find('.word, .ds-text').first().text().trim();
				const reading = $element.find('.reading, .ds-furigana').first().text().trim() || undefined;

				const definitions: string[] = [];
				$element.find('.definition, .gloss-content, li').each((defIndex: number, defElement: any) => {
					const defText = $(defElement).text().trim();
					if (defText && !definitions.includes(defText)) {
						definitions.push(defText);
					}
				});

				if (word && definitions.length > 0) {
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
