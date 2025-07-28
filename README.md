# Ichi.moe Japanese Analyzer for Obsidian

An Obsidian plugin that analyzes Japanese text using [ichi.moe](https://ichi.moe) and inserts word definitions and readings directly into your notes.

## Features

- **Smart Text Selection**: Analyzes selected text or current line if no selection
- **Word Breakdown**: Shows individual word definitions with readings (furigana)
- **Romanization**: Displays romanized version when available
- **Clean Formatting**: Inserts analysis in a well-formatted, readable format

## Usage

1. **Select Japanese text** in your note, or position your cursor on a line with Japanese text
2. **Run the command**: Use the Command Palette (Ctrl/Cmd + P) and search for "Analyze Japanese text with ichi.moe"
3. **View analysis**: The plugin will insert a detailed breakdown below your cursor

### Example

**Input text**: `日本語の勉強が好き`

**Generated output**:

```markdown
---

**Japanese Analysis: 日本語の勉強が好き**

*Romanization:* nihongo no benkyō ga suki

**Word Breakdown:**

1. **日本語** (にほんご)
   - Japanese (language)

2. **の**
   - particle indicating possession/association

3. **勉強** (べんきょう) 
   - study; learning; scholarship

4. **が**
   - particle indicating subject of sentence

5. **好き** (すき)
   - liking; being fond of; to one's liking

---
```

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

- Internet connection (to access ichi.moe API)
- Obsidian v0.15.0 or higher

## How It Works

The plugin:

1. Sends your Japanese text to [ichi.moe](https://ichi.moe) for analysis
2. Parses the HTML response to extract word definitions and readings
3. Formats the results in a clean, readable markdown format
4. Inserts the analysis into your current note

## Privacy

This plugin sends text to the external service ichi.moe for analysis. Only the text you explicitly analyze is sent. No other data from your vault is transmitted.

## Credits

- Powered by [ichi.moe](https://ichi.moe) - an excellent Japanese text analyzer
- Inspired by [ichikasuto](https://github.com/varugasu/ichikasuto) and [obsidian-furigana](https://github.com/fasiha/obsidian-furigana)

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

MIT License - see LICENSE file for details.
