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
    width: 24px;
    height: 24px;
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
    font-size: 12px;
    font-weight: bold;
    font-family: system-ui, sans-serif;
  }
  .plnth-annotation-pin:hover {
    transform: scale(1.1);
  }
  .plnth-annotation-highlight {
    background: rgba(45, 106, 79, 0.2);
    cursor: pointer;
  }
  .plnth-annotation-card {
    position: absolute;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    padding: 1rem;
    width: 320px;
    z-index: 999999;
    font-family: system-ui, sans-serif;
    font-size: 14px;
  }
  .plnth-annotation-card input,
  .plnth-annotation-card textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    font-size: 14px;
  }
  .plnth-annotation-card button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    margin-right: 0.5rem;
  }
  .plnth-annotation-card .plnth-submit {
    background: #2d6a4f;
    color: white;
  }
  .plnth-annotation-card .plnth-cancel {
    background: #f0f0f0;
    color: #333;
  }
  .plnth-annotation-toggle {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: #2d6a4f;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 999997;
    font-family: system-ui, sans-serif;
  }
  .plnth-annotation-toggle:hover {
    background: #1e4d36;
  }
  .plnth-annotation-toggle.active {
    background: #ef7b6d;
  }
  .plnth-annotating * {
    cursor: crosshair !important;
  }
  .plnth-annotation-success {
    background: #4fd88f;
    color: white;
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
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
  
  function getElementSelector(el) {
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        path.unshift(selector);
        break;
      }
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\\s+/).filter(c => !c.startsWith('plnth-'));
        if (classes.length > 0) {
          selector += '.' + classes.join('.');
        }
      }
      path.unshift(selector);
      el = el.parentElement;
      if (path.length > 5) break;
    }
    return path.join(' > ');
  }
  
  function createCard(x, y, targeting) {
    if (currentCard) currentCard.remove();
    
    const card = document.createElement('div');
    card.className = 'plnth-annotation-card';
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.innerHTML = \`
      <div id="plnth-card-success" style="display:none" class="plnth-annotation-success">✓ Annotation saved</div>
      <input type="text" id="plnth-name" placeholder="Your name (optional)" maxlength="200">
      <textarea id="plnth-body" placeholder="Your note" required maxlength="10000" rows="3"></textarea>
      <div>
        <button class="plnth-submit">Submit</button>
        <button class="plnth-cancel">Cancel</button>
      </div>
    \`;
    
    document.body.appendChild(card);
    currentCard = card;
    
    const nameInput = card.querySelector('#plnth-name');
    const bodyInput = card.querySelector('#plnth-body');
    const successDiv = card.querySelector('#plnth-card-success');
    
    card.querySelector('.plnth-submit').onclick = async () => {
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
        card.querySelector('.plnth-submit').disabled = true;
        
        setTimeout(() => {
          card.remove();
          currentCard = null;
          location.reload();
        }, 1500);
      } catch (err) {
        alert('Error saving annotation: ' + err.message);
      }
    };
    
    card.querySelector('.plnth-cancel').onclick = () => {
      card.remove();
      currentCard = null;
    };
    
    bodyInput.focus();
  }
  
  function handleElementClick(e) {
    if (!annotationMode) return;
    if (e.target.closest('.plnth-annotation-toggle, .plnth-annotation-card, .plnth-annotation-pin')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const targeting = {
      kind: 'element',
      selector: getElementSelector(e.target)
    };
    
    createCard(e.pageX + 10, e.pageY + 10, targeting);
  }
  
  function handleTextSelection() {
    if (!annotationMode) return;
    
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
      selector: getElementSelector(container),
      selectedText: selectedText,
      startOffset: range.startOffset,
      endOffset: range.endOffset
    };
    
    createCard(window.scrollX + rect.left + 10, window.scrollY + rect.bottom + 10, targeting);
    selection.removeAllRanges();
  }
  
  function toggleAnnotationMode() {
    annotationMode = !annotationMode;
    const toggle = document.querySelector('.plnth-annotation-toggle');
    
    if (annotationMode) {
      document.body.classList.add('plnth-annotating');
      toggle.classList.add('active');
      toggle.textContent = '✓ Annotating';
      document.addEventListener('click', handleElementClick, true);
      document.addEventListener('mouseup', handleTextSelection);
    } else {
      document.body.classList.remove('plnth-annotating');
      toggle.classList.remove('active');
      toggle.textContent = '💬 Annotate';
      document.removeEventListener('click', handleElementClick, true);
      document.removeEventListener('mouseup', handleTextSelection);
      if (currentCard) {
        currentCard.remove();
        currentCard = null;
      }
    }
  }
  
  function renderExistingAnnotations() {
    EXISTING_COMMENTS.forEach((comment, index) => {
      if (!comment.targeting) return;
      
      try {
        const elements = document.querySelectorAll(comment.targeting.selector);
        if (elements.length === 0) return;
        
        const el = elements[0];
        const rect = el.getBoundingClientRect();
        
        const pin = document.createElement('div');
        pin.className = 'plnth-annotation-pin';
        pin.textContent = String(index + 1);
        pin.style.left = (window.scrollX + rect.left - 12) + 'px';
        pin.style.top = (window.scrollY + rect.top - 12) + 'px';
        pin.title = (comment.name ? comment.name + ': ' : '') + comment.body;
        
        pin.onclick = (e) => {
          e.stopPropagation();
          const card = document.createElement('div');
          card.className = 'plnth-annotation-card';
          card.style.left = (e.pageX + 10) + 'px';
          card.style.top = (e.pageY + 10) + 'px';
          card.innerHTML = \`
            <div style="font-weight:500;margin-bottom:0.5rem">\${comment.name || 'Anonymous'}</div>
            <div style="color:#666;margin-bottom:0.5rem;white-space:pre-wrap">\${comment.body}</div>
            <button class="plnth-cancel" onclick="this.closest('.plnth-annotation-card').remove()">Close</button>
          \`;
          document.body.appendChild(card);
        };
        
        document.body.appendChild(pin);
        
        if (comment.targeting.kind === 'text' && comment.targeting.selectedText) {
          el.classList.add('plnth-annotation-highlight');
        }
      } catch (err) {
        console.warn('Failed to render annotation:', err);
      }
    });
  }
  
  function init() {
    const toggle = document.createElement('button');
    toggle.className = 'plnth-annotation-toggle';
    toggle.textContent = '💬 Annotate';
    toggle.onclick = toggleAnnotationMode;
    document.body.appendChild(toggle);
    
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
