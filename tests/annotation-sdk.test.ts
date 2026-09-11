import { describe, expect, it } from "vitest";
import { injectAnnotationSDK } from "@/lib/headers";

describe("annotation SDK injection", () => {
  it("includes CSS cursor overrides for card, inputs, buttons, toggle, and pins", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that crosshair cursor is applied to all elements in annotation mode
    expect(result).toContain(".plnth-annotating * {");
    expect(result).toContain("cursor: crosshair !important;");
    
    // Check that card and its children override to auto
    expect(result).toContain(".plnth-annotation-card,");
    expect(result).toContain(".plnth-annotation-card * {");
    expect(result).toContain("cursor: auto !important;");
    
    // Check that inputs and textareas override to text cursor
    expect(result).toContain(".plnth-annotation-card input,");
    expect(result).toContain(".plnth-annotation-card textarea {");
    expect(result).toContain("cursor: text !important;");
    
    // Check that buttons override to pointer
    expect(result).toContain(".plnth-annotation-card button {");
    expect(result).toContain("cursor: pointer !important;");
    
    // Check that toggle has pointer cursor
    expect(result).toContain(".plnth-annotation-toggle {");
    expect(result).toContain("cursor: pointer !important;");
    
    // Check that pins have pointer cursor
    expect(result).toContain(".plnth-annotation-pin {");
    expect(result).toContain("cursor: pointer !important;");
  });

  it("includes logic to skip element click when selection exists", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that handleElementClick checks for non-collapsed selection
    expect(result).toContain("function handleElementClick(e) {");
    expect(result).toContain("const selection = window.getSelection();");
    expect(result).toContain("if (selection && !selection.isCollapsed) {");
    expect(result).toContain("return;");
  });

  it("uses selected text as excerpt for text annotations", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that handleTextSelection gets start element for selector
    expect(result).toContain("function handleTextSelection(e) {");
    expect(result).toContain("let startElement = range.startContainer;");
    expect(result).toContain("if (startElement.nodeType === Node.TEXT_NODE) {");
    expect(result).toContain("startElement = startElement.parentElement;");
    
    // Check that excerpt uses selectedText with 2000 char limit
    expect(result).toContain("const excerpt = selectedText.length > 2000 ? selectedText.slice(0, 2000) + '...' : selectedText;");
    
    // Check that targeting stores both selectedText and excerpt
    expect(result).toContain("selectedText: selectedText,");
    expect(result).toContain("excerpt: excerpt,");
  });

  it("increases excerpt display max-height to 16rem", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    expect(result).toContain(".plnth-annotation-excerpt {");
    expect(result).toContain("max-height: 16rem;");
    expect(result).toContain("overflow-y: auto;");
  });
});

describe("text selection excerpt handling", () => {
  it("stores full selectedText for short selections", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // The SDK should use the full selectedText when it's under 2000 chars
    expect(result).toContain("const excerpt = selectedText.length > 2000 ? selectedText.slice(0, 2000) + '...' : selectedText;");
  });

  it("truncates selectedText at 2000 chars for long selections", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // The SDK should truncate at 2000 chars with ellipsis
    expect(result).toContain("selectedText.slice(0, 2000) + '...'");
  });
});

describe("multi-block text annotation reconstruction", () => {
  it("includes reconstructMultiBlockHighlight function", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that the reconstruction function exists
    expect(result).toContain("function reconstructMultiBlockHighlight(startEl, selectedText) {");
    expect(result).toContain("function normalizeText(text) {");
    expect(result).toContain("function isContentBlock(element) {");
  });

  it("highlightElement accepts selectedText parameter", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that highlightElement signature includes selectedText
    expect(result).toContain("function highlightElement(selector, endSelector, selectedText) {");
  });

  it("calls reconstructMultiBlockHighlight when endSelector is missing but selectedText exists", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that the reconstruction logic is called
    expect(result).toContain("if (selectedText && selectedText.length > 0) {");
    expect(result).toContain("const reconstructed = reconstructMultiBlockHighlight(startEl, selectedText);");
    expect(result).toContain("if (reconstructed && reconstructed.length > 1) {");
  });

  it("pin click passes selectedText to highlightElement", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that pin.onclick extracts and passes selectedText
    expect(result).toContain("const selectedText = comment.targeting.selectedText || comment.targeting.excerpt || '';");
    expect(result).toContain("highlightElement(comment.targeting.selector, comment.targeting.endSelector, selectedText);");
  });

  it("handleTextSelection finds block ancestors for start and end", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that block ancestor finding logic exists
    expect(result).toContain("function findBlockAncestor(el) {");
    expect(result).toContain("const startBlock = findBlockAncestor(startElement);");
    expect(result).toContain("const endBlock = findBlockAncestor(endElement);");
  });

  it("handleTextSelection uses block ancestors for selector and endSelector", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that selectors use block ancestors
    expect(result).toContain("selector: getStableSelector(startBlock),");
    expect(result).toContain("if (endBlock && endBlock !== startBlock) {");
    expect(result).toContain("targeting.endSelector = getStableSelector(endBlock);");
  });
});

describe("reconstructMultiBlockHighlight precision", () => {
  it("restricts isContentBlock to P|H1-6|LI|BLOCKQUOTE|PRE only", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that isContentBlock uses specific content blocks only
    expect(result).toContain("function isContentBlock(element) {");
    expect(result).toContain("/^(P|H[1-6]|LI|BLOCKQUOTE|PRE)$/i.test(tagName);");
    // Verify the comment explains the restriction
    expect(result).toContain("// Only specific content blocks, not wrapper DIV/SECTION");
  });

  it("stops walking when adding next block would break prefix match", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that reconstruction stops when prefix match breaks
    expect(result).toContain("const testAccumulated = normalizeText(accumulatedText + ' ' + blockText);");
    expect(result).toContain("if (!targetText.startsWith(testAccumulated.slice(0, targetText.length))");
    expect(result).toContain("break;");
  });

  it("trims blocks from end while accumulated still covers target", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that trimming logic exists
    expect(result).toContain("while (blocks.length > 1) {");
    expect(result).toContain("const testWithoutLast = blocks.slice(0, -1)");
    expect(result).toContain("if (normalized.includes(targetText) || normalized === targetText) {");
    expect(result).toContain("blocks.pop();");
  });

  it("returns valid multi-block prefix when next block would break match", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that we return blocks when we have a valid prefix and >= 2 blocks
    expect(result).toContain("if (blocks.length >= 2 && targetText.startsWith(accumulatedText)) {");
    expect(result).toContain("return blocks;");
  });

  it("endSelector TreeWalker checks node position relative to endEl", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that TreeWalker filter checks document position
    expect(result).toContain("const position = endEl.compareDocumentPosition(node);");
    expect(result).toContain("if (position & Node.DOCUMENT_POSITION_PRECEDING) {");
    expect(result).toContain("return NodeFilter.FILTER_SKIP;");
  });

  it("removes includes check on single start element", () => {
    const html = "<html><body>Test</body></html>";
    const result = injectAnnotationSDK(html, "test-site-id", "https://example.com/comments", "[]");
    
    // Check that the single-block check uses exact equality, not includes
    expect(result).toContain("if (accumulatedText === targetText) {");
  });
});
