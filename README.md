# Ichi.moe Japanese Analyzer for Obsidian

An Obsidian plugin that analyzes Japanese text using Ichiran and [ichi.moe](https://ichi.moe), and inserts readings and word definitions directly into your notes.

## Features

- **Smart Text Selection**: Analyzes selected text or current line if no selection
- **Analysis section**: Adds a collapsible Obisdian callout with the text's furigana (kanji with readings on top), and tucks all further details inside the callout
- **Word Breakdown**: Shows individual word definitions with readings (furigana)

## Usage

1. **Select Japanese text** in your note, or position your cursor on a line with Japanese text
2. **Run the command**: Use the Command Palette (Ctrl/Cmd + P) and search for "Analyze Japanese text with ichi.moe"
3. **View analysis**: The plugin will insert a detailed breakdown below your cursor

### Example

**Input text**: `日本語の勉強が好き`

**Generated output**:

```markdown
> [!IchiMoe]- <ruby>日本<rt>にほん</rt></ruby><ruby>語<rt>ご</rt></ruby>の<ruby>勉<rt>べん</rt></ruby><ruby>強<rt>きょう</rt></ruby>が<ruby>好<rt>す</rt></ruby>き
>
> - <ruby>日本<rt>にほん</rt></ruby><ruby>語<rt>ご</rt></ruby>
>   - (n) Japanese (language)
> - の
>   - (prt) indicates possessive (☝️ occasionally ん, orig. written 乃 or 之)
>   - (prt) nominalizes verbs and adjectives
>   - (prt) substitutes for "ga" in subordinate phrases
> - <ruby>勉<rt>べん</rt></ruby><ruby>強<rt>きょう</rt></ruby>
>   - (n,vs,vt) study
```

This looks like this (with the caveat that GitHub's Markdown doesn't render the Obsidian callout):

> [!IchiMoe]- <ruby>日本<rt>にほん</rt></ruby><ruby>語<rt>ご</rt></ruby>の<ruby>勉<rt>べん</rt></ruby><ruby>強<rt>きょう</rt></ruby>が<ruby>好<rt>す</rt></ruby>き
>
> - <ruby>日本<rt>にほん</rt></ruby><ruby>語<rt>ご</rt></ruby>
>   - (n) Japanese (language)
> - の
>   - (prt) indicates possessive (☝️ occasionally ん, orig. written 乃 or 之)
>   - (prt) nominalizes verbs and adjectives
>   - (prt) substitutes for "ga" in subordinate phrases
> - <ruby>勉<rt>べん</rt></ruby><ruby>強<rt>きょう</rt></ruby>
>   - (n,vs,vt) study

## Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Search for "Ichi.moe Japanese Analyzer"
4. Install and enable the plugin

### Manual Installation

1. Download the latest release
2. Extract the files to `<vault>/.obsidian/plugins/obsidian-ichi.moe-japanese/`
3. Reload Obsidian and enable the plugin in Settings

## Requirements

- Internet connection (to access https://ichi.moe API)
- Obsidian v0.15.0 or higher

## How It Works

The plugin:

1. Sends your Japanese text to [ichi.moe](https://ichi.moe) for analysis
2. Parses the HTML response to extract word definitions and readings
3. Formats the results in a clean, readable markdown format
4. Inserts the analysis into your current note

## Privacy

This plugin sends text to the external service https://ichi.moe for analysis. Only the text you explicitly analyze is sent. No other data from your vault is transmitted.

## Credits

- Powered by Ichiran/[ichi.moe](https://ichi.moe) and Ichiran, an excellent Japanese text analyzer
- Ruby tag functionality powered by [JmdictFurigana](https://github.com/Doublevil/JmdictFurigana)
- JmdictFurigana and Ichiran both build atop the legendary [JMdict](https://en.wikipedia.org/wiki/JMdict) project

## Development

```bash
# Clone this repo
git clone https://github.com/your-username/obsidian-ichi.moe-japanese.git

# Install dependencies
npm install

# Start development with hot reload
npm run dev

# Build for production
npm run build
```

## License

[0BSD](https://choosealicense.com/licenses/0bsd/) — see LICENSE file for details.
