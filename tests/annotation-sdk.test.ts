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
