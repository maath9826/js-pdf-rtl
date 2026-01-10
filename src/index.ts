import jsPDF from "jspdf";
import { isRtlLang } from "rtl-detect";

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
  pageHeight: number;
  maxWidth: number;
  spaceWidth: number;
  leftMargin: number;
  rightMargin: number;
  topMargin: number;
  bottomMargin: number;
}

export interface ParagraphMeasurementResult {
  lineHeight: number;
  lineCount: number;
  currentY: number;
}

interface ParagraphProcessingParams {
  doc: jsPDF;
  fragments: RichTextFragment[];
  currentY: number;
  customLineHeight?: number;
  isRTL?: boolean;
  margin?: number;
  leftMargin?: number;
  rightMargin?: number;
  topMargin?: number;
  bottomMargin?: number;
  align?: Alignment;
  showConsoleLogs?: boolean;
  fontSize?: number;
  defaultFontSize?: number;
  defaultFont?: string;
}

// Cache for the language detector
let detectorPromise: Promise<any> | null = null;
let cld3Available: boolean | null = null;

// Memoization cache for RTL detection
const rtlCache = new Map<string, boolean>();

/**
 * Initialize the language detector (cached)
 */
async function getLanguageDetector(): Promise<any | null> {
  // If we already know cld3 is unavailable, skip
  if (cld3Available === false) {
    return null;
  }

  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        // Dynamic import to handle CDN loading gracefully
        const cld3Module = await import("cld3-asm");
        // Handle both default export and named export patterns
        const loadModule =
          cld3Module.loadModule ||
          (cld3Module.default && cld3Module.default.loadModule) ||
          cld3Module.default;

        if (typeof loadModule !== "function") {
          cld3Available = false;
          return null;
        }

        const cldFactory = await loadModule();
        if (!cldFactory || typeof cldFactory.create !== "function") {
          cld3Available = false;
          return null;
        }

        const detector = cldFactory.create(0, 1000);
        cld3Available = true;
        return detector;
      } catch {
        cld3Available = false;
        return null;
      }
    })();
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

  const detector = await getLanguageDetector();

  if (detector && typeof detector.findLanguage === "function") {
    try {
      const detection = detector.findLanguage(word);

      if (detection && detection.language) {
        // Use the detected language code with isRtlLang
        const isRtl = isRtlLang(detection.language) || false;
        rtlCache.set(word, isRtl);
        return isRtl;
      }
    } catch {
      // Silently fall back to pattern matching
    }
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
 * @param leftMargin - Page left margin
 * @param rightMargin - Page right margin
 * @returns LineMetrics object with calculated values
 */
function calculateLineMetrics(
  doc: jsPDF,
  customLineHeight?: number,
  leftMargin = DEFAULT_MARGIN,
  rightMargin = DEFAULT_MARGIN,
  topMargin = DEFAULT_MARGIN,
  bottomMargin = DEFAULT_MARGIN
): LineMetrics {
  const lineHeight =
    customLineHeight || doc.getFontSize() * LINE_HEIGHT_MULTIPLIER;
  const pageSize = doc.internal.pageSize as unknown as {
    width: number;
    height: number;
    getHeight?: () => number;
  };
  const pageWidth = pageSize.width;
  const pageHeight =
    typeof pageSize.getHeight === "function"
      ? pageSize.getHeight()
      : pageSize.height;
  const maxWidth = pageWidth - leftMargin - rightMargin;
  const spaceWidth = doc.getTextWidth(" ");

  return {
    lineHeight,
    pageWidth,
    pageHeight,
    maxWidth,
    spaceWidth,
    leftMargin,
    rightMargin,
    topMargin,
    bottomMargin,
  };
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

function buildRichLines(
  doc: jsPDF,
  words: RichWord[],
  metrics: LineMetrics
): RichWord[][] {
  const lines: RichWord[][] = [];
  let currentLine: RichWord[] = [];
  let currentLineWidth = 0;

  words.forEach((wordObj) => {
    const wordWidthPlusSpace = doc.getTextWidth(wordObj.word + " ");

    if (
      currentLine.length > 0 &&
      currentLineWidth + wordWidthPlusSpace > metrics.maxWidth
    ) {
      lines.push(currentLine);
      currentLine = [];
      currentLineWidth = 0;
    }

    currentLine.push(wordObj);
    currentLineWidth += wordWidthPlusSpace;
  });

  // Write remaining words
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

interface LayoutLinesConfig {
  lines: RichWord[][];
  metrics: LineMetrics;
  currentY: number;
  onPageBreak?: () => void;
  onLine?: (line: RichWord[], y: number) => void;
}

function layoutLinesAcrossPages({
  lines,
  metrics,
  currentY,
  onPageBreak,
  onLine,
}: LayoutLinesConfig): number {
  const bottomBoundary = metrics.pageHeight - metrics.bottomMargin;
  const safeTopMargin = Math.max(
    0,
    Math.min(metrics.topMargin, bottomBoundary)
  );
  let y = currentY;

  if (lines.length === 0) {
    return currentY + metrics.lineHeight;
  }

  lines.forEach((line) => {
    if (y > bottomBoundary) {
      onPageBreak?.();
      y = safeTopMargin;
    }

    onLine?.(line, y);
    y += metrics.lineHeight;
  });

  return y;
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
    defaultFont?: string;
    showConsoleLogs?: boolean;
  }
): number {
  const lines = buildRichLines(doc, words, metrics);

  const finalY = layoutLinesAcrossPages({
    lines,
    metrics,
    currentY,
    onPageBreak: () => doc.addPage(),
    onLine: (line, y) =>
      writeRichLine({
        doc,
        line,
        y,
        isRTL: config.isRTL,
        align: config.align,
        pageWidth: metrics.pageWidth,
        leftMargin: metrics.leftMargin,
        rightMargin: metrics.rightMargin,
        showConsoleLogs: config.showConsoleLogs,
        font: config.defaultFont,
      }),
  });

  return finalY;
}

/**
 * Creates a pre-configured rich text formatter function with default values
 * @param options - Configuration options for the formatter
 * @param options.doc - The jsPDF document instance
 * @param options.defaultMargin - Default symmetric margin for paragraphs (fallback)
 * @param options.defaultLeftMargin - Default left margin
 * @param options.defaultRightMargin - Default right margin
 * @param options.defaultIsRTL - Default RTL setting
 * @param options.defaultFontSize - Default font size
 * @param options.defaultFont - Default font family
 * @returns Object with addRichParagraph async function
 */
export function createRichTextFormatter({
  doc,
  defaultMargin = DEFAULT_MARGIN,
  defaultLeftMargin,
  defaultRightMargin,
  defaultTopMargin,
  defaultBottomMargin,
  defaultIsRTL = false,
  defaultFontSize,
  defaultFont,
}: {
  doc: jsPDF;
  defaultMargin?: number;
  defaultLeftMargin?: number;
  defaultRightMargin?: number;
  defaultTopMargin?: number;
  defaultBottomMargin?: number;
  defaultIsRTL?: boolean;
  defaultFontSize?: number;
  defaultFont?: string;
}): {
  addRichParagraph: (
    args: Omit<ParagraphProcessingParams, "doc">
  ) => Promise<number>;
  measureRichParagraph: (
    args: Omit<ParagraphProcessingParams, "doc">
  ) => Promise<ParagraphMeasurementResult>;
} {
  setupFont(doc, { fontSize: defaultFontSize, font: defaultFont });

  return {
    addRichParagraph: async (args) => {
      const {
        margin,
        leftMargin,
        rightMargin,
        topMargin,
        bottomMargin,
        isRTL,
        fontSize,
        ...rest
      } = args;
      const resolvedMargin = margin ?? defaultMargin;
      const resolvedLeftMargin =
        leftMargin ?? margin ?? defaultLeftMargin ?? defaultMargin;
      const resolvedRightMargin =
        rightMargin ?? margin ?? defaultRightMargin ?? defaultMargin;
      const resolvedTopMargin =
        topMargin ?? margin ?? defaultTopMargin ?? defaultMargin;
      const resolvedBottomMargin =
        bottomMargin ?? margin ?? defaultBottomMargin ?? defaultMargin;
      return addRichParagraphAsync({
        doc,
        margin: resolvedMargin,
        leftMargin: resolvedLeftMargin,
        rightMargin: resolvedRightMargin,
        topMargin: resolvedTopMargin,
        bottomMargin: resolvedBottomMargin,
        isRTL: isRTL ?? defaultIsRTL,
        fontSize: fontSize ?? defaultFontSize,
        defaultFont,
        defaultFontSize,
        ...rest,
      });
    },
    measureRichParagraph: async (args) => {
      const {
        margin,
        leftMargin,
        rightMargin,
        topMargin,
        bottomMargin,
        isRTL,
        fontSize,
        ...rest
      } = args;
      const resolvedMargin = margin ?? defaultMargin;
      const resolvedLeftMargin =
        leftMargin ?? margin ?? defaultLeftMargin ?? defaultMargin;
      const resolvedRightMargin =
        rightMargin ?? margin ?? defaultRightMargin ?? defaultMargin;
      const resolvedTopMargin =
        topMargin ?? margin ?? defaultTopMargin ?? defaultMargin;
      const resolvedBottomMargin =
        bottomMargin ?? margin ?? defaultBottomMargin ?? defaultMargin;
      return measureRichParagraphAsync({
        doc,
        margin: resolvedMargin,
        leftMargin: resolvedLeftMargin,
        rightMargin: resolvedRightMargin,
        topMargin: resolvedTopMargin,
        bottomMargin: resolvedBottomMargin,
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
  margin,
  leftMargin,
  rightMargin,
  topMargin,
  bottomMargin,
  align,
  showConsoleLogs = false,
  fontSize,
  defaultFontSize,
  defaultFont,
}: ParagraphProcessingParams): Promise<number> {
  // Setup font
  setupFont(doc, { fontSize });

  const fallbackMargin = margin ?? DEFAULT_MARGIN;
  const effectiveLeftMargin = leftMargin ?? fallbackMargin;
  const effectiveRightMargin = rightMargin ?? fallbackMargin;
  const effectiveTopMargin = topMargin ?? fallbackMargin;
  const effectiveBottomMargin = bottomMargin ?? fallbackMargin;

  // Calculate metrics
  const metrics = calculateLineMetrics(
    doc,
    customLineHeight,
    effectiveLeftMargin,
    effectiveRightMargin,
    effectiveTopMargin,
    effectiveBottomMargin
  );

  // Process fragments to words
  const words = await processFragmentsToWords(fragments);

  // Apply language sequence reversal
  const processedWords = reverseLanguageSequences(words, isRTL);

  // Process layout and render
  const finalY = processLineLayout(doc, processedWords, currentY, metrics, {
    isRTL,
    align,
    defaultFont,
    showConsoleLogs,
  });

  // Reset font
  resetFont(doc, defaultFont, defaultFontSize);

  return finalY;
}

async function measureRichParagraphAsync({
  doc,
  fragments,
  currentY,
  customLineHeight,
  isRTL = false,
  margin,
  leftMargin,
  rightMargin,
  topMargin,
  bottomMargin,
  fontSize,
  defaultFontSize,
  defaultFont,
}: ParagraphProcessingParams): Promise<ParagraphMeasurementResult> {
  setupFont(doc, { fontSize });

  const fallbackMargin = margin ?? DEFAULT_MARGIN;
  const effectiveLeftMargin = leftMargin ?? fallbackMargin;
  const effectiveRightMargin = rightMargin ?? fallbackMargin;
  const effectiveTopMargin = topMargin ?? fallbackMargin;
  const effectiveBottomMargin = bottomMargin ?? fallbackMargin;

  const metrics = calculateLineMetrics(
    doc,
    customLineHeight,
    effectiveLeftMargin,
    effectiveRightMargin,
    effectiveTopMargin,
    effectiveBottomMargin
  );

  const words = await processFragmentsToWords(fragments);
  const processedWords = reverseLanguageSequences(words, isRTL);
  const lines = buildRichLines(doc, processedWords, metrics);
  const lineCount = lines.length;
  const nextY = layoutLinesAcrossPages({
    lines,
    metrics,
    currentY,
  });

  resetFont(doc, defaultFont, defaultFontSize);

  return {
    lineHeight: metrics.lineHeight,
    lineCount,
    currentY: nextY,
  };
}

/**
 * Helper function to get the starting X position based on alignment
 */
interface StartingXParams {
  pageWidth: number;
  leftMargin: number;
  rightMargin: number;
  currentLineWidth: number;
  isRTL?: boolean;
  align?: Alignment;
}

function getStartingX({
  pageWidth,
  leftMargin,
  rightMargin,
  currentLineWidth,
  isRTL,
  align,
}: StartingXParams): number {
  switch (align) {
    case "left":
      return leftMargin;
    case "right":
      return pageWidth - rightMargin - currentLineWidth;
    case "center":
      const availableWidth = pageWidth - leftMargin - rightMargin;
      return leftMargin + Math.max(0, (availableWidth - currentLineWidth) / 2);
    default:
      return getStartingX({
        pageWidth,
        leftMargin,
        rightMargin,
        currentLineWidth,
        isRTL,
        align: isRTL ? "right" : "left",
      });
  }
}

interface WriteRichLineParams {
  doc: jsPDF;
  line: RichWord[];
  y: number;
  isRTL?: boolean;
  align?: Alignment;
  pageWidth: number;
  leftMargin: number;
  rightMargin: number;
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
  leftMargin,
  rightMargin,
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
  let currentX = getStartingX({
    pageWidth,
    leftMargin,
    rightMargin,
    currentLineWidth,
    isRTL,
    align,
  });

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
