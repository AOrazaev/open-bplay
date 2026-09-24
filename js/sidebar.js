// Plays sidebar chrome: collapse/expand it entirely, and let the user
// drag its right edge to resize it. Both preferences are persisted to
// their own localStorage key, independent of the plays library and the
// court autosave, since this is pure layout/view state.

const SIDEBAR_STATE_KEY = 'play-drawing-sidebar-state-v1';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 240;

const sidebarEl = document.querySelector('#playsSidebar');
const sidebarToggleBtn = document.querySelector('#sidebarToggle');
const sidebarResizeHandle = document.querySelector('#sidebarResizeHandle');

const SIDEBAR_TABS = ['plays', 'frames'];
const playsTabBtn = document.querySelector('#playsTabBtn');
const framesTabBtn = document.querySelector('#framesTabBtn');
const playsTabPanel = document.querySelector('#playsTabPanel');
const framesTabPanel = document.querySelector('#framesTabPanel');

function clampSidebarWidth(width) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function loadSidebarState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY));
    if (saved && typeof saved === 'object') {
      return {
        collapsed: !!saved.collapsed,
        width: clampSidebarWidth(Number(saved.width) || SIDEBAR_DEFAULT_WIDTH),
        activeTab: SIDEBAR_TABS.includes(saved.activeTab) ? saved.activeTab : 'plays',
      };
    }
  } catch (_) {}
  return { collapsed: false, width: SIDEBAR_DEFAULT_WIDTH, activeTab: 'plays' };
}

function persistSidebarState() {
  localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify({
    collapsed: sidebarCollapsed,
    width: sidebarWidth,
    activeTab: sidebarActiveTab,
  }));
}

const initialSidebarState = loadSidebarState();
let sidebarCollapsed = initialSidebarState.collapsed;
let sidebarWidth = initialSidebarState.width;
let sidebarActiveTab = initialSidebarState.activeTab;

// Shows the selected tab's panel and hides the other, without touching
// either panel's contents/scroll position (same `hidden`-class approach
// as the sidebar's own collapse). Switching to Frames also refreshes its
// thumbnails via frames-ui.js's renderFramesPanel, since it may be stale
// if the court changed while that tab wasn't visible.
function applySidebarTab() {
  const isFrames = sidebarActiveTab === 'frames';
  playsTabBtn.classList.toggle('active', !isFrames);
  playsTabBtn.setAttribute('aria-selected', String(!isFrames));
  framesTabBtn.classList.toggle('active', isFrames);
  framesTabBtn.setAttribute('aria-selected', String(isFrames));
  playsTabPanel.classList.toggle('hidden', isFrames);
  framesTabPanel.classList.toggle('hidden', !isFrames);
}

applySidebarTab();

function selectSidebarTab(tab) {
  if (sidebarActiveTab === tab) return;
  sidebarActiveTab = tab;
  applySidebarTab();
  persistSidebarState();
  if (tab === 'frames' && typeof renderFramesPanel === 'function') renderFramesPanel();
}

playsTabBtn.addEventListener('click', () => selectSidebarTab('plays'));
framesTabBtn.addEventListener('click', () => selectSidebarTab('frames'));

function applySidebarState() {
  sidebarEl.classList.toggle('collapsed', sidebarCollapsed);
  sidebarEl.style.width = `${sidebarWidth}px`;
  sidebarResizeHandle.classList.toggle('hidden', sidebarCollapsed);
  sidebarToggleBtn.textContent = sidebarCollapsed ? '›' : '‹';
  sidebarToggleBtn.setAttribute('aria-label', sidebarCollapsed ? 'Show plays sidebar' : 'Hide plays sidebar');
  sidebarToggleBtn.title = sidebarCollapsed ? 'Show plays sidebar' : 'Hide plays sidebar';
}

applySidebarState();

sidebarToggleBtn.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  applySidebarState();
  persistSidebarState();
});

let sidebarResizeDrag = null; // { pointerId, startX, startWidth }

sidebarResizeHandle.addEventListener('pointerdown', (e) => {
  if (sidebarCollapsed) return;
  sidebarResizeDrag = { pointerId: e.pointerId, startX: e.clientX, startWidth: sidebarWidth };
  sidebarResizeHandle.setPointerCapture(e.pointerId);
  sidebarResizeHandle.classList.add('dragging');
  sidebarEl.classList.add('resizing');
});

sidebarResizeHandle.addEventListener('pointermove', (e) => {
  if (!sidebarResizeDrag || sidebarResizeDrag.pointerId !== e.pointerId) return;
  const delta = e.clientX - sidebarResizeDrag.startX;
  sidebarWidth = clampSidebarWidth(sidebarResizeDrag.startWidth + delta);
  sidebarEl.style.width = `${sidebarWidth}px`;
});

function endSidebarResizeDrag(e) {
  if (!sidebarResizeDrag || sidebarResizeDrag.pointerId !== e.pointerId) return;
  if (sidebarResizeHandle.hasPointerCapture(e.pointerId)) sidebarResizeHandle.releasePointerCapture(e.pointerId);
  sidebarResizeDrag = null;
  sidebarResizeHandle.classList.remove('dragging');
  sidebarEl.classList.remove('resizing');
  persistSidebarState();
}

sidebarResizeHandle.addEventListener('pointerup', endSidebarResizeDrag);
sidebarResizeHandle.addEventListener('pointercancel', endSidebarResizeDrag);
