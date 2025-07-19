import jsPDF from "jspdf";
import { isRtlLang } from "rtl-detect";
import { loadModule } from "cld3-asm";

// Constants
const DEFAULT_MARGIN = 20;
const LINE_HEIGHT_MULTIPLIER = 0.5;

// Types
type Alignment = "left" | "center" | "right";

interface RichWord {
  word: string;
  isBold: boolean;
  isRtlLang: boolean;
}

interface FontConfig {
  font?: string;
  fontSize?: number;
  isBold?: boolean;
}

interface LineMetrics {
  lineHeight: number;
  pageWidth: number;
  maxWidth: number;
  spaceWidth: number;
}

interface ParagraphProcessingParams {
  doc: jsPDF;
  fragments: RichTextFragment[];
  currentY: number;
  customLineHeight?: number;
  isRTL?: boolean;
  margin?: number;
  align?: Alignment;
  showConsoleLogs?: boolean;
  fontSize?: number;
  defaultFontSize?: number;
  defaultFont?: string;
}

// Cache for the language detector
let detectorPromise: Promise<any> | null = null;

// Memoization cache for RTL detection
const rtlCache = new Map<string, boolean>();

/**
 * Initialize the language detector (cached)
 */
async function getLanguageDetector() {
  if (!detectorPromise) {
    detectorPromise = loadModule().then((cldFactory) =>
      cldFactory.create(0, 1000)
    );
  }
  return detectorPromise;
}

/**
 * Detects if a word is RTL using language detection with memoization
 * @param word - The word to analyze
 * @returns Promise<boolean> indicating if the word is RTL
 */
async function isWordRtlAsync(word: string): Promise<boolean> {
  if (rtlCache.has(word)) {
    return rtlCache.get(word)!;
  }

  try {
    const detector = await getLanguageDetector();
    const detection = detector.findLanguage(word);

    if (detection && detection.language) {
      // Use the detected language code with isRtlLang
      const isRtl = isRtlLang(detection.language) || false;
      rtlCache.set(word, isRtl);
      return isRtl;
    }
  } catch (error) {
    console.warn(
      "Language detection failed, falling back to pattern matching:",
      error
    );
  }

  // Fallback to Arabic Unicode range detection
  const isRtl =
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
      word
    );
  rtlCache.set(word, isRtl);
  return isRtl;
}

/**
 * Interface for rich text fragments with optional bold formatting
 */
export interface RichTextFragment {
  text: string;
  isBold?: boolean;
}

// Utility Functions

/**
 * Sets up font configuration for the document
 * @param doc - The jsPDF document instance
 * @param config - Font configuration options
 */
function setupFont(doc: jsPDF, config: FontConfig): void {
  if (config.fontSize) doc.setFontSize(config.fontSize);
  if (config.font) {
    const weight = config.isBold ? "bold" : "normal";
    doc.setFont(config.font, "normal", weight);
  }
}

/**
 * Resets font to default configuration
 * @param doc - The jsPDF document instance
 * @param defaultFont - Optional default font to reset to
 * @param defaultFontSize - Optional default font size to reset to
 */
function resetFont(
  doc: jsPDF,
  defaultFont?: string,
  defaultFontSize?: number
): void {
  if (defaultFont) doc.setFont(defaultFont);
  if (defaultFontSize) doc.setFontSize(defaultFontSize);
}

/**
 * Calculates line metrics for the current document state
 * @param doc - The jsPDF document instance
 * @param customLineHeight - Optional custom line height
 * @param margin - Page margin
 * @returns LineMetrics object with calculated values
 */
function calculateLineMetrics(
  doc: jsPDF,
  customLineHeight?: number,
  margin = DEFAULT_MARGIN
): LineMetrics {
  const lineHeight =
    customLineHeight || doc.getFontSize() * LINE_HEIGHT_MULTIPLIER;
  const pageWidth = doc.internal.pageSize.width;
  const maxWidth = pageWidth - margin * 2;
  const spaceWidth = doc.getTextWidth(" ");

  return { lineHeight, pageWidth, maxWidth, spaceWidth };
}

/**
 * Converts text fragments into an array of rich words with RTL detection
 * @param fragments - Array of rich text fragments to process
 * @returns Promise<RichWord[]> - Array of processed words with RTL information
 */
async function processFragmentsToWords(
  fragments: RichTextFragment[]
): Promise<RichWord[]> {
  const words: RichWord[] = [];

  for (const fragment of fragments) {
    const fragmentWords = fragment.text
      .split(/\s+/)
      .filter((w) => w.length > 0);

    for (const word of fragmentWords) {
      words.push({
        word,
        isBold: fragment.isBold || false,
        isRtlLang: await isWordRtlAsync(word),
      });
    }
  }

  return words;
}

/**
 * Processes line layout and writes lines to the document
 * @param doc - The jsPDF document instance
 * @param words - Array of rich words to layout
 * @param currentY - Current Y position
 * @param metrics - Calculated line metrics
 * @param config - Layout configuration options
 * @returns Final Y position after writing all lines
 */
function processLineLayout(
  doc: jsPDF,
  words: RichWord[],
  currentY: number,
  metrics: LineMetrics,
  config: {
    isRTL?: boolean;
    align?: Alignment;
    margin?: number;
    defaultFont?: string;
    showConsoleLogs?: boolean;
  }
): number {
  let currentLine: RichWord[] = [];
  let currentLineWidth = 0;
  let y = currentY;

  words.forEach((wordObj) => {
    const wordWidthPlusSpace = doc.getTextWidth(wordObj.word + " ");

    if (
      currentLine.length > 0 &&
      currentLineWidth + wordWidthPlusSpace > metrics.maxWidth
    ) {
      writeRichLine({
        doc,
        line: currentLine,
        y,
        isRTL: config.isRTL,
        align: config.align,
        pageWidth: metrics.pageWidth,
        margin: config.margin || DEFAULT_MARGIN,
        font: config.defaultFont,
      });
      y += metrics.lineHeight;
      currentLine = [];
      currentLineWidth = 0;
    }

    currentLine.push(wordObj);
    currentLineWidth += wordWidthPlusSpace;
  });

  // Write remaining words
  if (currentLine.length > 0) {
    writeRichLine({
      doc,
      line: currentLine,
      y,
      isRTL: config.isRTL,
      align: config.align,
      pageWidth: metrics.pageWidth,
      margin: config.margin || DEFAULT_MARGIN,
      showConsoleLogs: config.showConsoleLogs,
      font: config.defaultFont,
    });
  }

  return y + metrics.lineHeight;
}

/**
 * Creates a pre-configured rich text formatter function with default values
 * @param options - Configuration options for the formatter
 * @param options.doc - The jsPDF document instance
 * @param options.defaultMargin - Default margin for paragraphs
 * @param options.defaultIsRTL - Default RTL setting
 * @param options.defaultFontSize - Default font size
 * @param options.defaultFont - Default font family
 * @returns Object with addRichParagraph async function
 */
export function createRichTextFormatter({
  doc,
  defaultMargin = DEFAULT_MARGIN,
  defaultIsRTL = false,
  defaultFontSize,
  defaultFont,
}: {
  doc: jsPDF;
  defaultMargin?: number;
  defaultIsRTL?: boolean;
  defaultFontSize?: number;
  defaultFont?: string;
}): {
  addRichParagraph: (
    args: Omit<ParagraphProcessingParams, "doc">
  ) => Promise<number>;
} {
  setupFont(doc, { fontSize: defaultFontSize, font: defaultFont });

  return {
    addRichParagraph: async (args) => {
      const { margin, isRTL, fontSize, ...rest } = args;
      return addRichParagraphAsync({
        doc,
        margin: margin ?? defaultMargin,
        isRTL: isRTL ?? defaultIsRTL,
        fontSize: fontSize ?? defaultFontSize,
        defaultFont,
        defaultFontSize,
        ...rest,
      });
    },
  };
}

/**
 * Adds a rich text paragraph to the PDF with proper RTL support
 * @param params - Paragraph processing parameters
 * @returns Promise<number> - Final Y position after adding the paragraph
 */
async function addRichParagraphAsync({
  doc,
  fragments,
  currentY,
  customLineHeight,
  isRTL = false,
  margin = DEFAULT_MARGIN,
  align,
  showConsoleLogs = false,
  fontSize,
  defaultFontSize,
  defaultFont,
}: ParagraphProcessingParams): Promise<number> {
  // Setup font
  setupFont(doc, { fontSize });

  // Calculate metrics
  const metrics = calculateLineMetrics(doc, customLineHeight, margin);

  // Process fragments to words
  const words = await processFragmentsToWords(fragments);

  // Apply language sequence reversal
  const processedWords = reverseLanguageSequences(words, isRTL);

  // Process layout and render
  const finalY = processLineLayout(doc, processedWords, currentY, metrics, {
    isRTL,
    align,
    margin,
    defaultFont,
    showConsoleLogs,
  });

  // Reset font
  resetFont(doc, defaultFont, defaultFontSize);

  return finalY;
}

/**
 * Helper function to get the starting X position based on alignment
 */
function getStartingX(
  pageWidth: number,
  margin: number,
  currentLineWidth: number,
  isRTL?: boolean,
  align?: Alignment
): number {
  switch (align) {
    case "left":
      return margin;
    case "right":
      return pageWidth - margin - currentLineWidth;
    case "center":
      return (pageWidth - currentLineWidth) / 2;
    default:
      return getStartingX(
        pageWidth,
        margin,
        currentLineWidth,
        isRTL,
        isRTL ? "right" : "left"
      );
  }
}

interface WriteRichLineParams {
  doc: jsPDF;
  line: RichWord[];
  y: number;
  isRTL?: boolean;
  align?: Alignment;
  pageWidth: number;
  margin: number;
  showConsoleLogs?: boolean;
  font?: string;
}

/**
 * Writes a single line of rich text with proper alignment support
 * @param params - Line writing parameters including doc, line data, and formatting options
 */
function writeRichLine({
  doc,
  line,
  y,
  isRTL,
  align,
  pageWidth,
  margin,
  showConsoleLogs = false,
  font,
}: WriteRichLineParams) {
  const spaceWidth = doc.getTextWidth(" ");
  const lineCopy = [...line];
  if (isRTL) lineCopy.reverse();
  // Calculate the total width of the line for alignment purposes
  let currentLineWidth = 0;
  lineCopy.forEach((item, index) => {
    if (font) doc.setFont(font, "normal", item.isBold ? "bold" : "normal");
    currentLineWidth += doc.getTextWidth(item.word);
    if (index != lineCopy.length - 1) {
      currentLineWidth += spaceWidth;
    }
  });

  // Calculate the starting X position based on alignment
  let currentX = getStartingX(
    pageWidth,
    margin,
    currentLineWidth,
    isRTL,
    align
  );

  lineCopy.forEach((item, index) => {
    if (font) {
      if (item.isBold) {
        doc.setFont(font, "normal", "bold");
      } else {
        doc.setFont(font, "normal", "normal");
      }
    }

    doc.text(item.word, currentX, y, { isOutputRtl: item.isRtlLang });

    const wordWidth = doc.getTextWidth(item.word);
    currentX += wordWidth;
    // we always need to add space between words
    if (index != lineCopy.length - 1) currentX += spaceWidth;
  });
}

/**
 * Swaps parentheses for RTL text rendering
 * @param text - Input text with parentheses
 * @returns Text with swapped parentheses
 */
export function swapParentheses(text: string): string {
  return text
    .replace(/\(/g, "TEMP_MARKER")
    .replace(/\)/g, "(")
    .replace(/TEMP_MARKER/g, ")");
}

/**
 * Reverses sequences of words based on language direction for proper RTL/LTR rendering
 * @param paragraph - Array of rich words to process
 * @param isRTL - Whether the overall paragraph direction is RTL
 * @returns Processed array with properly ordered word sequences
 */
function reverseLanguageSequences(
  paragraph: RichWord[],
  isRTL: boolean
): RichWord[] {
  const result: RichWord[] = [];
  let currentSequence: RichWord[] = [];
  let currentLanguageType: boolean | null = null; // true for RTL, false for LTR

  for (const wordObj of paragraph) {
    const wordLanguageType = wordObj.isRtlLang;

    // If this is the first word or same language type, add to current sequence
    if (
      currentLanguageType === null ||
      currentLanguageType === wordLanguageType
    ) {
      currentSequence.push(wordObj);
      currentLanguageType = wordLanguageType;
    } else {
      // Language changed, process the current sequence first
      if (currentSequence.length > 0) {
        // For RTL: reverse English sequences
        // For LTR: reverse Arabic sequences
        const shouldReverse = isRTL
          ? !currentLanguageType
          : currentLanguageType;

        if (shouldReverse) {
          result.push(...currentSequence.reverse());
        } else {
          result.push(...currentSequence);
        }
      }

      // Start new sequence with current word
      currentSequence = [wordObj];
      currentLanguageType = wordLanguageType;
    }
  }

  // Process the last sequence
  if (currentSequence.length > 0) {
    const shouldReverse = isRTL ? !currentLanguageType : currentLanguageType;

    if (shouldReverse) {
      result.push(...currentSequence.reverse());
    } else {
      result.push(...currentSequence);
    }
  }

  return result;
}

// Export the main functionality
export { createRichTextFormatter as default };
