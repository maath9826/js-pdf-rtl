# js-pdf-rtl

A comprehensive library for RTL/LTR text rendering in jsPDF with rich text support and automatic language detection.

## Features

- 🌍 **Automatic Language Detection**: Uses `cld3-asm` for intelligent language detection
- 🔄 **RTL/LTR Support**: Proper handling of right-to-left and left-to-right text
- 🎨 **Rich Text Formatting**: Support for bold text within paragraphs
- 📐 **Smart Text Layout**: Word wrapping, alignment (left/center/right), and line spacing
- 🔤 **Mixed Language Support**: Handles mixed RTL/LTR text with proper sequence reversal
- ⚡ **Performance Optimized**: Memoization for language detection results
- 🎯 **Easy Integration**: Simple API that works seamlessly with jsPDF

## Installation

```bash
npm install js-pdf-rtl jspdf rtl-detect cld3-asm
```

## Dependencies

This library requires the following peer dependencies:

- `jspdf` (^3.0.0) - PDF generation
- `rtl-detect` (^1.1.0) - RTL language detection
- `cld3-asm` (^4.0.0) - Language detection

## Quick Start

```typescript
import jsPDF from "jspdf";
import { createRichTextFormatter, RichTextFragment } from "js-pdf-rtl";

// Create a new PDF document
const doc = new jsPDF();

// Create the rich text formatter
const formatter = createRichTextFormatter({
  doc,
  defaultMargin: 20,
  defaultIsRTL: false,
  defaultFontSize: 12,
  defaultFont: "helvetica",
});

// Define your text content with rich formatting
const fragments: RichTextFragment[] = [
  { text: "Hello ", isBold: false },
  { text: "world", isBold: true },
  { text: " مرحبا ", isBold: false },
  { text: "بالعالم", isBold: true },
];

// Add the paragraph to your PDF
const startY = 50;
formatter
  .addRichParagraph({
    fragments,
    currentY: startY,
    isRTL: false,
    align: "left",
  })
  .then((finalY) => {
    console.log(`Text rendered, final Y position: ${finalY}`);

    // Save the PDF
    doc.save("example.pdf");
  });
```

## API Reference

### `createRichTextFormatter(options)`

Creates a pre-configured rich text formatter function with default values.

#### Parameters

- `options.doc` (jsPDF): The jsPDF document instance
- `options.defaultMargin` (number, optional): Default margin for paragraphs (default: 20)
- `options.defaultIsRTL` (boolean, optional): Default RTL setting (default: false)
- `options.defaultFontSize` (number, optional): Default font size
- `options.defaultFont` (string, optional): Default font family

#### Returns

An object with an `addRichParagraph` async function.

### `addRichParagraph(params)`

Adds a rich text paragraph to the PDF with proper RTL support.

#### Parameters

- `fragments` (RichTextFragment[]): Array of text fragments with formatting
- `currentY` (number): Current Y position on the page
- `customLineHeight` (number, optional): Custom line height
- `isRTL` (boolean, optional): Whether text direction is RTL
- `margin` (number, optional): Page margin
- `align` ('left' | 'center' | 'right', optional): Text alignment
- `showConsoleLogs` (boolean, optional): Enable debug logging
- `fontSize` (number, optional): Font size for this paragraph

#### Returns

Promise\<number\> - Final Y position after adding the paragraph

### `RichTextFragment`

Interface for rich text fragments:

```typescript
interface RichTextFragment {
  text: string;
  isBold?: boolean;
}
```

### `swapParentheses(text)`

Utility function to swap parentheses for RTL text rendering.

#### Parameters

- `text` (string): Input text with parentheses

#### Returns

String with swapped parentheses

## Examples

### Basic Usage

```typescript
import jsPDF from "jspdf";
import { createRichTextFormatter } from "js-pdf-rtl";

const doc = new jsPDF();
const formatter = createRichTextFormatter({ doc });

const fragments = [
  { text: "Regular text " },
  { text: "bold text", isBold: true },
  { text: " and more regular text." },
];

await formatter.addRichParagraph({
  fragments,
  currentY: 50,
  align: "center",
});
```

### RTL Text with Mixed Languages

```typescript
const fragments = [
  { text: "English text " },
  { text: "نص عربي", isBold: true },
  { text: " more English" },
];

await formatter.addRichParagraph({
  fragments,
  currentY: 100,
  isRTL: true,
  align: "right",
});
```

### Custom Styling

```typescript
const formatter = createRichTextFormatter({
  doc,
  defaultMargin: 30,
  defaultFontSize: 14,
  defaultFont: "times",
});

await formatter.addRichParagraph({
  fragments: [{ text: "Custom styled text", isBold: true }],
  currentY: 150,
  fontSize: 18,
  customLineHeight: 25,
});
```

### Sequential Paragraphs

```typescript
let currentY = 50;

// First paragraph
currentY = await formatter.addRichParagraph({
  fragments: [{ text: "First paragraph" }],
  currentY,
});

// Add some spacing
currentY += 10;

// Second paragraph
currentY = await formatter.addRichParagraph({
  fragments: [{ text: "Second paragraph" }],
  currentY,
});
```

## Language Support

The library automatically detects the language of each word and applies appropriate RTL/LTR rendering:

- **RTL Languages**: Arabic, Hebrew, Persian, Urdu, etc.
- **LTR Languages**: English, French, German, Spanish, etc.
- **Mixed Text**: Properly handles text containing both RTL and LTR content

## Performance

- **Memoization**: Language detection results are cached for better performance
- **Efficient Processing**: Smart word processing and layout algorithms
- **Minimal Dependencies**: Only essential peer dependencies required

## Browser Support

This library works in all modern browsers that support:

- ES2018+ features
- WebAssembly (for cld3-asm)
- jsPDF compatibility

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

### 0.1.0

- Initial release
- RTL/LTR text support with automatic language detection
- Rich text formatting with bold support
- Smart text alignment and wrapping
- Performance optimizations with memoization
