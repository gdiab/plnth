/**
 * Response header policy (SPEC §4). None of these are client-controllable
 * (SPEC §5: no client-controlled security switches).
 */

export const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads";

/** Every response the service emits, all hosts. */
export function applyBaseHeaders(headers: Headers): Headers {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

export interface ArtifactHeaderOptions {
  /**
   * The robots invariant: when true, every response from this artifact's
   * origin carries X-Robots-Tag: noindex — page, assets, gates, errors.
   */
  noindex: boolean;
  contentType?: string;
  cacheControl?: string;
  attachment?: boolean;
}

/**
 * Headers for any response served from an artifact origin. The sandbox CSP is
 * unconditional: no per-type, per-state, or per-request exceptions (SPEC §1).
 */
export function artifactHeaders(opts: ArtifactHeaderOptions): Headers {
  const headers = applyBaseHeaders(new Headers());
  headers.set("Content-Security-Policy", SANDBOX_CSP);
  if (opts.noindex) headers.set("X-Robots-Tag", "noindex");
  if (opts.contentType) headers.set("Content-Type", opts.contentType);
  if (opts.cacheControl) headers.set("Cache-Control", opts.cacheControl);
  if (opts.attachment) headers.set("Content-Disposition", "attachment");
  return headers;
}

/** Headers for portal/API responses (apex): always noindex (SPEC §4). */
export function apexHeaders(): Headers {
  const headers = applyBaseHeaders(new Headers());
  headers.set("X-Robots-Tag", "noindex");
  return headers;
}

const HEAD_OPEN_RE = /<head(\s[^>]*)?>/i;
const NOINDEX_META = '<meta name="robots" content="noindex">';

/**
 * HTML responses under noindex also carry the meta tag (SPEC §4). Injected at
 * serve time; stored bytes are untouched.
 */
export function injectNoindexMeta(html: string): string {
  const match = HEAD_OPEN_RE.exec(html);
  if (match) {
    const insertAt = match.index + match[0].length;
    return html.slice(0, insertAt) + NOINDEX_META + html.slice(insertAt);
  }
  return NOINDEX_META + html;
}

const BODY_CLOSE_RE = /<\/body>/i;

/**
 * Generate the annotation SDK JavaScript and CSS for Lavish-style page annotations.
 * Works under sandbox CSP (allow-scripts but no allow-same-origin).
 */
function generateAnnotationSDK(siteId: string, commentsEndpoint: string, existingComments: string): string {
  return `
<style id="plnth-annotation-styles">
  .plnth-annotation-pin {
    position: absolute;
    width: 26px;
    height: 26px;
    background: #2d6a4f;
    border: 2px solid white;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 13px;
    font-weight: bold;
    font-family: system-ui, sans-serif;
    transition: transform 0.15s ease-out;
  }
  .plnth-annotation-pin:hover {
    transform: scale(1.15);
  }
  .plnth-annotation-highlight {
    outline: 3px solid #2d6a4f !important;
    outline-offset: 2px;
    background: rgba(45, 106, 79, 0.15) !important;
    transition: all 0.2s ease-out;
  }
  .plnth-annotation-text-highlight {
    background: rgba(45, 106, 79, 0.25);
  }
  .plnth-annotation-card {
    position: fixed;
    background: white;
    border: 1px solid #999;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    padding: 1.25rem;
    width: min(24rem, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    z-index: 999999;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: #1a1a1a;
    box-sizing: border-box;
  }
  .plnth-annotation-card input,
  .plnth-annotation-card textarea {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid #999;
    border-radius: 4px;
    margin-bottom: 0.75rem;
    font-size: 15px;
    font-family: system-ui, sans-serif;
    line-height: 1.4;
    color: #1a1a1a;
    background: white;
    box-sizing: border-box;
  }
  .plnth-annotation-card textarea {
    resize: vertical;
    min-height: 5rem;
  }
  .plnth-annotation-card label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #333;
    margin-bottom: 0.375rem;
  }
  .plnth-annotation-excerpt {
    background: #f5f5f5;
    border-left: 3px solid #2d6a4f;
    padding: 0.875rem;
    margin-bottom: 1rem;
    font-size: 14px;
    color: #1a1a1a;
    border-radius: 4px;
    line-height: 1.6;
    max-height: 16rem;
    overflow-y: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .plnth-annotation-excerpt-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    margin-bottom: 0.375rem;
  }
  .plnth-annotation-note-text {
    color: #1a1a1a;
    margin-bottom: 0.75rem;
    white-space: pre-wrap;
    line-height: 1.6;
  }
  .plnth-annotation-author {
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #333;
  }
  .plnth-annotation-card button {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    margin-right: 0.5rem;
    font-family: system-ui, sans-serif;
  }
  .plnth-annotation-card .plnth-submit {
    background: #2d6a4f;
    color: white;
  }
  .plnth-annotation-card .plnth-submit:hover {
    background: #1e4d36;
  }
  .plnth-annotation-card .plnth-cancel {
    background: #e0e0e0;
    color: #1a1a1a;
  }
  .plnth-annotation-card .plnth-cancel:hover {
    background: #d0d0d0;
  }
  .plnth-annotation-toggle {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: rgba(255, 255, 255, 0.95);
    color: #1a1a1a;
    border: 1px solid #ccc;
    padding: 0.625rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    z-index: 999997;
    font-family: system-ui, sans-serif;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    transition: box-shadow 0.15s ease-out, border-color 0.15s ease-out;
  }
  .plnth-annotation-toggle:hover {
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    border-color: #999;
  }
  .plnth-annotation-toggle:focus {
    outline: 2px solid #2d6a4f;
    outline-offset: 2px;
  }
  .switch-track {
    position: relative;
    width: 36px;
    height: 20px;
    background: #ccc;
    border-radius: 10px;
    transition: background 0.2s ease-out;
    flex-shrink: 0;
  }
  .plnth-annotation-toggle[aria-pressed="true"] .switch-track {
    background: #2d6a4f;
  }
  .switch-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    transition: transform 0.2s ease-out;
  }
  .plnth-annotation-toggle[aria-pressed="true"] .switch-knob {
    transform: translateX(16px);
  }
  .plnth-annotating * {
    cursor: crosshair !important;
  }
  .plnth-annotation-card,
  .plnth-annotation-card * {
    cursor: auto !important;
  }
  .plnth-annotation-card input,
  .plnth-annotation-card textarea {
    cursor: text !important;
  }
  .plnth-annotation-card button {
    cursor: pointer !important;
  }
  .plnth-annotation-toggle {
    cursor: pointer !important;
  }
  .plnth-annotation-pin {
    cursor: pointer !important;
  }
  .plnth-annotation-success {
    background: #4fd88f;
    color: white;
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.75rem;
    font-weight: 500;
  }
</style>
<script id="plnth-annotation-sdk">
(function() {
  'use strict';
  
  const SITE_ID = ${JSON.stringify(siteId)};
  const COMMENTS_ENDPOINT = ${JSON.stringify(commentsEndpoint)};
  const EXISTING_COMMENTS = ${existingComments};
  
  let annotationMode = false;
  let currentCard = null;
  let currentHighlight = null;
  let pointerDownX = 0;
  let pointerDownY = 0;
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function getStableSelector(el) {
    const path = [];
    let current = el;
    
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.nodeName.toLowerCase();
      
      if (current.id) {
        selector += '#' + current.id;
        path.unshift(selector);
        break;
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/).filter(c => !c.startsWith('plnth-'));
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }
      
      // Add nth-of-type for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          child => child.nodeName === current.nodeName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += \`:nth-of-type(\${index})\`;
        }
      }
      
      path.unshift(selector);
      current = parent;
      
      if (path.length > 6) break;
    }
    
    return path.length > 0 ? path.join(' > ') : 'body';
  }
  
  function getExcerpt(el, maxLen = 200) {
    if (!el) return '';
    let text = el.textContent || '';
    text = text.replace(/\\s+/g, ' ').trim();
    if (text.length > maxLen) {
      text = text.slice(0, maxLen) + '...';
    }
    return text;
  }
  
  function clearHighlight() {
    // Clear single element highlight
    if (currentHighlight) {
      currentHighlight.classList.remove('plnth-annotation-highlight');
      currentHighlight = null;
    }
    // Clear all multi-block highlights
    document.querySelectorAll('.plnth-annotation-highlight').forEach(el => {
      el.classList.remove('plnth-annotation-highlight');
    });
  }
  
  function normalizeText(text) {
    return text.replace(/\\s+/g, ' ').trim();
  }
  
  function isContentBlock(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const tagName = element.nodeName;
    // Only specific content blocks including lists, not wrapper DIV/SECTION
    return /^(P|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE)$/i.test(tagName);
  }
  
  /**
   * Reconstruct multi-block highlight when endSelector is missing.
   * Walks forward from startEl through block siblings, accumulating text
   * until it matches the expected selectedText (or best prefix match).
   * Returns array of block elements to highlight, or null if reconstruction fails.
   */
  function reconstructMultiBlockHighlight(startEl, selectedText) {
    if (!startEl || !selectedText) return null;
    
    const targetText = normalizeText(selectedText);
    if (targetText.length === 0) return null;
    
    const blocks = [startEl];
    let accumulatedText = normalizeText(startEl.textContent || '');
    
    // If start element already contains all the text exactly, it's single-block
    if (accumulatedText === targetText) {
      return [startEl];
    }
    
    // Walk forward through siblings to find blocks that complete the text
    let current = startEl.nextElementSibling;
    let maxBlocks = 10; // Safety limit to prevent runaway
    
    while (current && blocks.length < maxBlocks) {
      // Only consider content block elements
      if (isContentBlock(current)) {
        const blockText = normalizeText(current.textContent || '');
        const testAccumulated = normalizeText(accumulatedText + ' ' + blockText);
        
        // Check if adding this block would make us no longer match the target prefix
        if (!targetText.startsWith(testAccumulated.slice(0, targetText.length)) && 
            !testAccumulated.includes(targetText)) {
          // Adding this block breaks the match
          // If we have a valid multi-block prefix so far, return it
          if (blocks.length >= 2 && targetText.startsWith(accumulatedText)) {
            return blocks;
          }
          // Otherwise stop here
          break;
        }
        
        accumulatedText = testAccumulated;
        blocks.push(current);
        
        // Check if we've matched the target exactly or accumulated it
        if (accumulatedText === targetText || accumulatedText.includes(targetText)) {
          // Trim from the end: remove blocks while accumulated without them still covers target
          while (blocks.length > 1) {
            const testWithoutLast = blocks.slice(0, -1)
              .map(b => normalizeText(b.textContent || ''))
              .join(' ');
            const normalized = normalizeText(testWithoutLast);
            if (normalized.includes(targetText) || normalized === targetText) {
              blocks.pop();
            } else {
              break;
            }
          }
          return blocks;
        }
        
        // Stop if we've exceeded reasonable bounds without matching
        if (accumulatedText.length > targetText.length * 1.5) {
          break;
        }
      }
      current = current.nextElementSibling;
    }
    
    // If loop ended with a valid multi-block prefix, return it
    if (blocks.length >= 2 && targetText.startsWith(accumulatedText)) {
      return blocks;
    }
    
    // Only return null - we don't have a valid multi-block prefix
    return null;
  }
  
  function highlightElement(selector, endSelector, selectedText) {
    clearHighlight();
    try {
      const startEl = document.querySelector(selector);
      if (!startEl) return null;
      
      // Single element or no end selector: check if we can reconstruct multi-block
      if (!endSelector) {
        // If selectedText/excerpt is provided and spans multiple blocks, try to reconstruct
        if (selectedText && selectedText.length > 0) {
          const reconstructed = reconstructMultiBlockHighlight(startEl, selectedText);
          if (reconstructed && reconstructed.length > 1) {
            // Successfully reconstructed multi-block range
            reconstructed.forEach(block => {
              block.classList.add('plnth-annotation-highlight');
            });
            currentHighlight = startEl;
            startEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return startEl;
          }
        }
        // Fallback to single element highlight
        currentHighlight = startEl;
        startEl.classList.add('plnth-annotation-highlight');
        startEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return startEl;
      }
      
      // Multi-block: highlight all block elements from start through end
      const endEl = document.querySelector(endSelector);
      if (!endEl || endEl === startEl) {
        // Fallback to single element
        currentHighlight = startEl;
        startEl.classList.add('plnth-annotation-highlight');
        startEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return startEl;
      }
      
      // Collect blocks from startEl through endEl inclusive under common parent chain
      const blocks = [];
      
      // Check if endEl is a descendant of startEl or vice versa
      if (startEl.contains(endEl)) {
        blocks.push(startEl);
      } else if (endEl.contains(startEl)) {
        blocks.push(endEl);
      } else {
        // Siblings or different branches: walk from start to end
        let current = startEl;
        blocks.push(current);
        
        // Walk siblings from start toward end
        while (current && current !== endEl) {
          current = current.nextElementSibling;
          if (!current) break;
          
          // Only include content blocks
          if (isContentBlock(current)) {
            blocks.push(current);
          }
          
          // Stop if we've reached endEl
          if (current === endEl) break;
        }
        
        // If we didn't reach endEl via siblings, fall back to TreeWalker with strict bounds
        if (current !== endEl) {
          blocks.length = 0;
          const range = document.createRange();
          range.setStartBefore(startEl);
          range.setEndAfter(endEl);
          
          const walker = document.createTreeWalker(
            range.commonAncestorContainer,
            NodeFilter.SHOW_ELEMENT,
            {
              acceptNode: (node) => {
                // Must be within range and not after endEl
                if (!range.intersectsNode(node)) return NodeFilter.FILTER_SKIP;
                
                // Strict check: node must come at or before endEl in document order
                const position = endEl.compareDocumentPosition(node);
                if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                  // endEl comes before node, so node is after endEl - skip it
                  return NodeFilter.FILTER_SKIP;
                }
                
                // Only accept content blocks or start/end elements
                if (node.nodeName.match(/^(P|H[1-6]|LI|BLOCKQUOTE|PRE)$/)) {
                  return NodeFilter.FILTER_ACCEPT;
                }
                if (node === startEl || node === endEl) {
                  return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
              }
            }
          );
          
          let node;
          while (node = walker.nextNode()) {
            blocks.push(node);
          }
        }
      }
      
      // Highlight all blocks in range
      blocks.forEach(block => {
        block.classList.add('plnth-annotation-highlight');
      });
      
      // Store first block as current highlight for single-element fallback
      currentHighlight = startEl;
      
      // Scroll to show the range
      startEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      return startEl;
    } catch (err) {
      console.warn('Failed to highlight selector:', selector, err);
      // Fallback: try highlighting just the start element
      try {
        const el = document.querySelector(selector);
        if (el) {
          currentHighlight = el;
          el.classList.add('plnth-annotation-highlight');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return el;
        }
      } catch (fallbackErr) {
        console.warn('Fallback highlight also failed:', fallbackErr);
      }
    }
    return null;
  }
  
  function positionCard(card, targetX, targetY, targetRect) {
    // Ensure card is appended first so we can measure it
    if (!card.parentElement) {
      document.body.appendChild(card);
    }
    
    // Reset any previously set width to get natural dimensions
    card.style.width = '';
    card.style.maxWidth = '';
    card.style.left = '0px';
    card.style.top = '0px';
    card.offsetHeight; // trigger reflow
    
    const cardRect = card.getBoundingClientRect();
    const margin = 12;
    const gap = 16;
    const minGutterWidth = 240;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left, top;
    
    // If targetRect provided (for pin opens), use gutter-aware side placement
    if (targetRect) {
      // Calculate available gutter space
      const rightGutter = viewportWidth - targetRect.right - margin;
      const leftGutter = targetRect.left - margin;
      
      // Try to dock in a side gutter (prefer larger gutter if both fit)
      let dockedInGutter = false;
      
      if (rightGutter >= minGutterWidth || leftGutter >= minGutterWidth) {
        // Pick the larger gutter if both are viable
        const useRightGutter = rightGutter >= leftGutter && rightGutter >= minGutterWidth;
        const useLeftGutter = !useRightGutter && leftGutter >= minGutterWidth;
        
        if (useRightGutter) {
          // Dock in right gutter
          const availableWidth = rightGutter - gap;
          card.style.width = 'min(24rem, ' + availableWidth + 'px)';
          card.offsetHeight; // trigger reflow to measure new width
          const newCardRect = card.getBoundingClientRect();
          
          left = targetRect.right + gap;
          top = targetRect.top;
          
          // Clamp vertically to keep card fully visible
          top = Math.max(margin, Math.min(top, viewportHeight - newCardRect.height - margin));
          dockedInGutter = true;
        } else if (useLeftGutter) {
          // Dock in left gutter
          const availableWidth = leftGutter - gap;
          card.style.width = 'min(24rem, ' + availableWidth + 'px)';
          card.offsetHeight; // trigger reflow to measure new width
          const newCardRect = card.getBoundingClientRect();
          
          left = targetRect.left - gap - newCardRect.width;
          top = targetRect.top;
          
          // Clamp vertically to keep card fully visible
          top = Math.max(margin, Math.min(top, viewportHeight - newCardRect.height - margin));
          dockedInGutter = true;
        }
      }
      
      // If we couldn't dock in a gutter, fall back to below/above
      if (!dockedInGutter) {
        // Reset width to default for below/above placement
        card.style.width = '';
        card.offsetHeight;
        const resetCardRect = card.getBoundingClientRect();
        
        // Try below
        if (targetRect.bottom + gap + resetCardRect.height + margin <= viewportHeight) {
          left = targetRect.left;
          top = targetRect.bottom + gap;
        }
        // Try above
        else if (targetRect.top - gap - resetCardRect.height >= margin) {
          left = targetRect.left;
          top = targetRect.top - gap - resetCardRect.height;
        }
        // Last resort: center over target
        else {
          left = targetRect.left;
          top = targetRect.top;
        }
        
        // Clamp horizontally for below/above placement
        left = Math.max(margin, Math.min(left, viewportWidth - resetCardRect.width - margin));
        top = Math.max(margin, Math.min(top, viewportHeight - resetCardRect.height - margin));
      }
    } else {
      // Original behavior for click-based positioning: try right, then adjust
      left = targetX + 10;
      top = targetY + 10;
      
      // Flip horizontally if would overflow right
      if (left + cardRect.width + margin > viewportWidth) {
        left = targetX - cardRect.width - 10;
        // If still overflows left, clamp to left edge
        if (left < margin) {
          left = margin;
        }
      }
      
      // Flip vertically if would overflow bottom
      if (top + cardRect.height + margin > viewportHeight) {
        top = targetY - cardRect.height - 10;
        // If still overflows top, clamp to top edge
        if (top < margin) {
          top = margin;
        }
      }
      
      // Final clamp to ensure card is fully visible
      left = Math.max(margin, Math.min(left, viewportWidth - cardRect.width - margin));
      top = Math.max(margin, Math.min(top, viewportHeight - cardRect.height - margin));
    }
    
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }
  
  function createCard(clientX, clientY, targeting, existingComment, targetRect) {
    if (currentCard) {
      currentCard.style.width = '';
      currentCard.style.maxWidth = '';
      currentCard.remove();
      currentCard = null;
    }
    
    const card = document.createElement('div');
    card.className = 'plnth-annotation-card';
    
    if (existingComment) {
      const excerpt = existingComment.targeting?.excerpt || 
                     existingComment.targeting?.selectedText || 
                     '';
      
      const excerptDiv = document.createElement('div');
      if (excerpt) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'plnth-annotation-excerpt-label';
        labelDiv.textContent = 'Annotated:';
        excerptDiv.appendChild(labelDiv);
        
        const quoteDiv = document.createElement('div');
        quoteDiv.className = 'plnth-annotation-excerpt';
        quoteDiv.textContent = excerpt;
        excerptDiv.appendChild(quoteDiv);
      }
      
      const authorDiv = document.createElement('div');
      authorDiv.className = 'plnth-annotation-author';
      authorDiv.textContent = existingComment.name || 'Anonymous';
      
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'plnth-annotation-note-text';
      bodyDiv.textContent = existingComment.body;
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'plnth-cancel';
      closeBtn.textContent = 'Close';
      closeBtn.onclick = () => {
        card.style.width = '';
        card.style.maxWidth = '';
        card.remove();
        currentCard = null;
        clearHighlight();
      };
      
      card.appendChild(excerptDiv);
      card.appendChild(authorDiv);
      card.appendChild(bodyDiv);
      card.appendChild(closeBtn);
    } else {
      const successDiv = document.createElement('div');
      successDiv.id = 'plnth-card-success';
      successDiv.style.display = 'none';
      successDiv.className = 'plnth-annotation-success';
      successDiv.textContent = '✓ Annotation saved';
      card.appendChild(successDiv);
      
      if (targeting?.excerpt) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'plnth-annotation-excerpt-label';
        labelDiv.textContent = 'Annotating:';
        card.appendChild(labelDiv);
        
        const excerptDiv = document.createElement('div');
        excerptDiv.className = 'plnth-annotation-excerpt';
        excerptDiv.textContent = targeting.excerpt;
        card.appendChild(excerptDiv);
      }
      
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Your name (optional)';
      card.appendChild(nameLabel);
      
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.id = 'plnth-name';
      nameInput.placeholder = 'Name';
      nameInput.maxLength = 200;
      card.appendChild(nameInput);
      
      const bodyLabel = document.createElement('label');
      bodyLabel.textContent = 'Your note';
      card.appendChild(bodyLabel);
      
      const bodyInput = document.createElement('textarea');
      bodyInput.id = 'plnth-body';
      bodyInput.placeholder = 'Add your note here...';
      bodyInput.required = true;
      bodyInput.maxLength = 10000;
      bodyInput.rows = 4;
      card.appendChild(bodyInput);
      
      const buttonDiv = document.createElement('div');
      
      const submitBtn = document.createElement('button');
      submitBtn.className = 'plnth-submit';
      submitBtn.textContent = 'Submit';
      submitBtn.onclick = async () => {
        const body = bodyInput.value.trim();
        if (!body) {
          alert('Please enter a note');
          return;
        }
        
        const payload = {
          body,
          targeting
        };
        if (nameInput.value.trim()) {
          payload.name = nameInput.value.trim();
        }
        
        try {
          const response = await fetch(COMMENTS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
            let errorMessage = 'Failed to save annotation';
            try {
              const data = await response.json();
              if (data.detail) {
                errorMessage = data.detail;
                // For rate limiting, include retry information
                if (response.status === 429) {
                  const retryAfter = response.headers.get('Retry-After');
                  if (retryAfter) {
                    errorMessage += ' (retry after ' + retryAfter + ' seconds)';
                  }
                }
              }
            } catch (parseErr) {
              // If JSON parsing fails, use the generic message
            }
            alert('Error: ' + errorMessage);
            return;
          }
          
          const result = await response.json();
          
          // Show success message briefly
          successDiv.style.display = 'block';
          nameInput.disabled = true;
          bodyInput.disabled = true;
          submitBtn.disabled = true;
          
          setTimeout(() => {
            // Close card
            card.style.width = '';
            card.style.maxWidth = '';
            card.remove();
            currentCard = null;
            clearHighlight();
            
            // Render new pin client-side
            const newComment = {
              commentId: result.commentId || 'temp-' + Date.now(),
              name: payload.name || '',
              body: payload.body,
              targeting: payload.targeting,
              createdAt: new Date().toISOString()
            };
            
            // Add to existing comments and re-render all pins in document order
            EXISTING_COMMENTS.push(newComment);
            renderExistingAnnotations();
            
            // Keep annotation mode on (don't toggle off)
          }, 1000);
        } catch (err) {
          alert('Network error: Failed to reach server. Please check your connection and try again.');
        }
      };
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'plnth-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => {
        card.style.width = '';
        card.style.maxWidth = '';
        card.remove();
        currentCard = null;
        clearHighlight();
      };
      
      buttonDiv.appendChild(submitBtn);
      buttonDiv.appendChild(cancelBtn);
      card.appendChild(buttonDiv);
      
      document.body.appendChild(card);
      positionCard(card, clientX, clientY, targetRect);
      bodyInput.focus();
    }
    
    currentCard = card;
    
    if (existingComment) {
      document.body.appendChild(card);
      positionCard(card, clientX, clientY, targetRect);
    }
  }
  
  function handleElementClick(e) {
    if (!annotationMode) return;
    if (e.target.closest('.plnth-annotation-toggle, .plnth-annotation-card, .plnth-annotation-pin')) {
      return;
    }
    
    // If there's a non-collapsed selection, don't open an element annotation
    // (text selection handler will take precedence)
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const selector = getStableSelector(e.target);
    const excerpt = getExcerpt(e.target);
    
    const targeting = {
      kind: 'element',
      selector,
      excerpt
    };
    
    const targetRect = e.target.getBoundingClientRect();
    createCard(e.clientX, e.clientY, targeting, null, targetRect);
  }
  
  function handlePointerDown(e) {
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
  }
  
  function handleTextSelection(e) {
    if (!annotationMode) return;
    
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        // Check for scroll gesture (mostly vertical movement >10px)
        const deltaX = Math.abs(e.clientX - pointerDownX);
        const deltaY = Math.abs(e.clientY - pointerDownY);
        if (deltaY > 10 && deltaY > deltaX * 1.5) {
          // Likely a scroll gesture, don't open card
          return;
        }
        return;
      }
      
      const range = selection.getRangeAt(0);
      
      // Get the start container's element for a more specific selector
      let startElement = range.startContainer;
      if (startElement.nodeType === Node.TEXT_NODE) {
        startElement = startElement.parentElement;
      }
      
      // Don't annotate if selection is within the card or toggle
      if (startElement.closest('.plnth-annotation-toggle, .plnth-annotation-card')) {
        return;
      }
      
      const selectedText = selection.toString().trim();
      if (!selectedText) return;
      
      const rect = range.getBoundingClientRect();
      
      // Use the full selectedText as the excerpt (cap at 2000 chars for display/storage)
      const excerpt = selectedText.length > 2000 ? selectedText.slice(0, 2000) + '...' : selectedText;
      
      // Get the end container's element for multi-block selections
      let endElement = range.endContainer;
      if (endElement.nodeType === Node.TEXT_NODE) {
        endElement = endElement.parentElement;
      }
      
      // Find the nearest block-level ancestors for proper multi-block detection
      function findBlockAncestor(el) {
        let current = el;
        while (current && current !== document.body) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const tag = current.nodeName;
            if (/^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV|SECTION|ARTICLE)$/i.test(tag)) {
              return current;
            }
          }
          current = current.parentElement;
        }
        return el; // fallback to original element
      }
      
      const startBlock = findBlockAncestor(startElement);
      const endBlock = findBlockAncestor(endElement);
      
      const targeting = {
        kind: 'text',
        selector: getStableSelector(startBlock),
        selectedText: selectedText,
        excerpt: excerpt,
        startOffset: range.startOffset,
        endOffset: range.endOffset
      };
      
      // Always set endSelector for multi-block selections (when blocks differ)
      if (endBlock && endBlock !== startBlock) {
        targeting.endSelector = getStableSelector(endBlock);
      }
      
      createCard(rect.left, rect.bottom, targeting, null, rect);
      selection.removeAllRanges();
    }, 10);
  }
  
  function setAnnotationMode(enabled) {
    if (annotationMode === enabled) return;
    
    annotationMode = enabled;
    const toggle = document.querySelector('.plnth-annotation-toggle');
    
    if (annotationMode) {
      document.body.classList.add('plnth-annotating');
      toggle.setAttribute('aria-pressed', 'true');
      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('click', handleElementClick, true);
      document.addEventListener('mouseup', handleTextSelection);
      // Persist mode in URL hash (CSP sandbox without allow-same-origin)
      if (!window.location.hash.includes('plnth-annotate')) {
        history.replaceState(null, '', window.location.pathname + window.location.search + '#plnth-annotate');
      }
    } else {
      document.body.classList.remove('plnth-annotating');
      toggle.setAttribute('aria-pressed', 'false');
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('click', handleElementClick, true);
      document.removeEventListener('mouseup', handleTextSelection);
      if (currentCard) {
        currentCard.style.width = '';
        currentCard.style.maxWidth = '';
        currentCard.remove();
        currentCard = null;
      }
      clearHighlight();
      // Remove hash when disabling
      if (window.location.hash.includes('plnth-annotate')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }
  
  function handleEscape(e) {
    if (e.key === 'Escape' && currentCard) {
      currentCard.style.width = '';
      currentCard.style.maxWidth = '';
      currentCard.remove();
      currentCard = null;
      clearHighlight();
    }
  }
  
  function handleToggleHotkey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      setAnnotationMode(!annotationMode);
    }
  }
  
  function handleClickOutside(e) {
    if (currentCard && !currentCard.contains(e.target) && 
        !e.target.closest('.plnth-annotation-pin, .plnth-annotation-toggle')) {
      currentCard.style.width = '';
      currentCard.style.maxWidth = '';
      currentCard.remove();
      currentCard = null;
      clearHighlight();
    }
  }
  
  function getElementPosition(selector) {
    try {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return window.scrollY + rect.top;
    } catch (err) {
      return null;
    }
  }
  
  function sortCommentsByDocumentOrder(comments) {
    const commentsWithPositions = comments
      .map(comment => ({
        comment,
        position: comment.targeting ? getElementPosition(comment.targeting.selector) : null
      }))
      .filter(item => item.position !== null)
      .sort((a, b) => a.position - b.position);
    
    return commentsWithPositions.map(item => item.comment);
  }
  
  function renderPin(comment, index) {
    if (!comment.targeting) return;
    
    try {
      const el = document.querySelector(comment.targeting.selector);
      if (!el) return;
      
      const rect = el.getBoundingClientRect();
      
      const pin = document.createElement('div');
      pin.className = 'plnth-annotation-pin';
      pin.textContent = String(index);
      pin.style.left = (window.scrollX + rect.left - 13) + 'px';
      pin.style.top = (window.scrollY + rect.top - 13) + 'px';
      
      const excerpt = comment.targeting.excerpt || comment.targeting.selectedText || '';
      pin.title = (comment.name ? comment.name + ': ' : '') + excerpt.slice(0, 80);
      
      pin.onclick = (e) => {
        e.stopPropagation();
        const selectedText = comment.targeting.selectedText || comment.targeting.excerpt || '';
        highlightElement(comment.targeting.selector, comment.targeting.endSelector, selectedText);
        
        // For multi-block annotations, compute the bounding union of highlights
        let targetRect = null;
        if (comment.targeting.endSelector) {
          const highlights = document.querySelectorAll('.plnth-annotation-highlight');
          if (highlights.length > 0) {
            let minTop = Infinity, minLeft = Infinity, maxBottom = -Infinity, maxRight = -Infinity;
            highlights.forEach(el => {
              const r = el.getBoundingClientRect();
              minTop = Math.min(minTop, r.top);
              minLeft = Math.min(minLeft, r.left);
              maxBottom = Math.max(maxBottom, r.bottom);
              maxRight = Math.max(maxRight, r.right);
            });
            targetRect = {
              top: minTop,
              left: minLeft,
              right: maxRight,
              bottom: maxBottom,
              width: maxRight - minLeft,
              height: maxBottom - minTop
            };
          }
        } else {
          // Single element: use its rect
          try {
            const el = document.querySelector(comment.targeting.selector);
            if (el) {
              targetRect = el.getBoundingClientRect();
            }
          } catch (err) {
            // Fall back to click position
          }
        }
        
        createCard(e.clientX, e.clientY, null, comment, targetRect);
      };
      
      document.body.appendChild(pin);
      
      if (comment.targeting.kind === 'text' && comment.targeting.selectedText) {
        el.classList.add('plnth-annotation-text-highlight');
      }
    } catch (err) {
      console.warn('Failed to render annotation:', err);
    }
  }
  
  function clearAllPins() {
    document.querySelectorAll('.plnth-annotation-pin').forEach(pin => pin.remove());
  }
  
  function renderExistingAnnotations() {
    clearAllPins();
    const sortedComments = sortCommentsByDocumentOrder(EXISTING_COMMENTS);
    sortedComments.forEach((comment, index) => {
      renderPin(comment, index + 1);
    });
  }
  
  function init() {
    const toggle = document.createElement('button');
    toggle.className = 'plnth-annotation-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.title = 'Toggle annotate/explore mode (Cmd/Ctrl+I)';
    
    const track = document.createElement('span');
    track.className = 'switch-track';
    track.setAttribute('aria-hidden', 'true');
    
    const knob = document.createElement('span');
    knob.className = 'switch-knob';
    track.appendChild(knob);
    
    const label = document.createElement('span');
    label.textContent = 'Annotate';
    
    toggle.appendChild(track);
    toggle.appendChild(label);
    toggle.onclick = () => setAnnotationMode(!annotationMode);
    
    document.body.appendChild(toggle);
    
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleToggleHotkey);
    document.addEventListener('click', handleClickOutside);
    
    renderExistingAnnotations();
    
    // Restore annotation mode from hash (persists across reload)
    if (window.location.hash.includes('plnth-annotate')) {
      setAnnotationMode(true);
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
`;
}

/**
 * Inject annotation SDK when comments are enabled. Works under sandbox CSP
 * (allow-scripts but no allow-same-origin). Inserted before </body> or at
 * the end if no closing body tag exists.
 */
export function injectAnnotationSDK(html: string, siteId: string, commentsEndpoint: string, existingComments: string): string {
  const sdk = generateAnnotationSDK(siteId, commentsEndpoint, existingComments);
  const match = BODY_CLOSE_RE.exec(html);
  if (match) {
    return html.slice(0, match.index) + sdk + html.slice(match.index);
  }
  return html + sdk;
}
