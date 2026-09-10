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
    if (currentHighlight) {
      currentHighlight.classList.remove('plnth-annotation-highlight');
      currentHighlight = null;
    }
  }
  
  function highlightElement(selector) {
    clearHighlight();
    try {
      const el = document.querySelector(selector);
      if (el) {
        currentHighlight = el;
        el.classList.add('plnth-annotation-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return el;
      }
    } catch (err) {
      console.warn('Failed to highlight selector:', selector, err);
    }
    return null;
  }
  
  function positionCard(card, targetX, targetY) {
    // Ensure card is appended first so we can measure it
    if (!card.parentElement) {
      document.body.appendChild(card);
    }
    
    const rect = card.getBoundingClientRect();
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left = targetX + 10;
    let top = targetY + 10;
    
    // Flip horizontally if would overflow right
    if (left + rect.width + margin > viewportWidth) {
      left = Math.max(margin, targetX - rect.width - 10);
    }
    
    // Clamp horizontally
    left = Math.max(margin, Math.min(left, viewportWidth - rect.width - margin));
    
    // Flip vertically if would overflow bottom
    if (top + rect.height + margin > viewportHeight) {
      top = Math.max(margin, targetY - rect.height - 10);
    }
    
    // Clamp vertically
    top = Math.max(margin, Math.min(top, viewportHeight - rect.height - margin));
    
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }
  
  function createCard(clientX, clientY, targeting, existingComment) {
    if (currentCard) {
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
            const data = await response.json();
            alert('Error: ' + (data.detail || 'Failed to save annotation'));
            return;
          }
          
          successDiv.style.display = 'block';
          nameInput.disabled = true;
          bodyInput.disabled = true;
          submitBtn.disabled = true;
          
          setTimeout(() => {
            card.remove();
            currentCard = null;
            location.reload();
          }, 1500);
        } catch (err) {
          alert('Error saving annotation: ' + err.message);
        }
      };
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'plnth-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => {
        card.remove();
        currentCard = null;
        clearHighlight();
      };
      
      buttonDiv.appendChild(submitBtn);
      buttonDiv.appendChild(cancelBtn);
      card.appendChild(buttonDiv);
      
      document.body.appendChild(card);
      positionCard(card, clientX, clientY);
      bodyInput.focus();
    }
    
    currentCard = card;
    
    if (existingComment) {
      document.body.appendChild(card);
      positionCard(card, clientX, clientY);
    }
  }
  
  function handleElementClick(e) {
    if (!annotationMode) return;
    if (e.target.closest('.plnth-annotation-toggle, .plnth-annotation-card, .plnth-annotation-pin')) {
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
    
    createCard(e.clientX, e.clientY, targeting);
  }
  
  function handleTextSelection(e) {
    if (!annotationMode) return;
    
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;
      
      if (container.closest('.plnth-annotation-toggle, .plnth-annotation-card')) {
        return;
      }
      
      const selectedText = selection.toString().trim();
      if (!selectedText) return;
      
      const rect = range.getBoundingClientRect();
      const targeting = {
        kind: 'text',
        selector: getStableSelector(container),
        selectedText: selectedText,
        excerpt: selectedText.length > 200 ? selectedText.slice(0, 200) + '...' : selectedText,
        startOffset: range.startOffset,
        endOffset: range.endOffset
      };
      
      createCard(rect.left, rect.bottom, targeting);
      selection.removeAllRanges();
    }, 10);
  }
  
  function toggleAnnotationMode() {
    annotationMode = !annotationMode;
    const toggle = document.querySelector('.plnth-annotation-toggle');
    
    if (annotationMode) {
      document.body.classList.add('plnth-annotating');
      toggle.setAttribute('aria-pressed', 'true');
      document.addEventListener('click', handleElementClick, true);
      document.addEventListener('mouseup', handleTextSelection);
    } else {
      document.body.classList.remove('plnth-annotating');
      toggle.setAttribute('aria-pressed', 'false');
      document.removeEventListener('click', handleElementClick, true);
      document.removeEventListener('mouseup', handleTextSelection);
      if (currentCard) {
        currentCard.remove();
        currentCard = null;
      }
      clearHighlight();
    }
  }
  
  function handleEscape(e) {
    if (e.key === 'Escape' && currentCard) {
      currentCard.remove();
      currentCard = null;
      clearHighlight();
    }
  }
  
  function handleToggleHotkey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      toggleAnnotationMode();
    }
  }
  
  function handleClickOutside(e) {
    if (currentCard && !currentCard.contains(e.target) && 
        !e.target.closest('.plnth-annotation-pin, .plnth-annotation-toggle')) {
      currentCard.remove();
      currentCard = null;
      clearHighlight();
    }
  }
  
  function renderExistingAnnotations() {
    EXISTING_COMMENTS.forEach((comment, index) => {
      if (!comment.targeting) return;
      
      try {
        const el = document.querySelector(comment.targeting.selector);
        if (!el) return;
        
        const rect = el.getBoundingClientRect();
        
        const pin = document.createElement('div');
        pin.className = 'plnth-annotation-pin';
        pin.textContent = String(index + 1);
        pin.style.left = (window.scrollX + rect.left - 13) + 'px';
        pin.style.top = (window.scrollY + rect.top - 13) + 'px';
        
        const excerpt = comment.targeting.excerpt || comment.targeting.selectedText || '';
        pin.title = (comment.name ? comment.name + ': ' : '') + excerpt.slice(0, 80);
        
        pin.onclick = (e) => {
          e.stopPropagation();
          highlightElement(comment.targeting.selector);
          createCard(e.clientX, e.clientY, null, comment);
        };
        
        document.body.appendChild(pin);
        
        if (comment.targeting.kind === 'text' && comment.targeting.selectedText) {
          el.classList.add('plnth-annotation-text-highlight');
        }
      } catch (err) {
        console.warn('Failed to render annotation:', err);
      }
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
    toggle.onclick = toggleAnnotationMode;
    
    document.body.appendChild(toggle);
    
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleToggleHotkey);
    document.addEventListener('click', handleClickOutside);
    
    renderExistingAnnotations();
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
