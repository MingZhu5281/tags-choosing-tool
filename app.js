/* ================================================================
   Tag Review Tool — app.js
   ================================================================ */

// ── State ────────────────────────────────────────────────────────
const state = {
  rawRows: [],    // original objects from the spreadsheet
  rows: [],       // enriched: { ..., categories, topics, tags } each an array of {item, inV1, inV2}
  selections: {}, // { idx: { categories: Set<string>, topics: Set<string>, tags: Set<string>, comment: "" } }
  reviewed: new Set(),
};

// ── DOM refs ─────────────────────────────────────────────────────
const uploadScreen   = document.getElementById('upload-screen');
const reviewScreen   = document.getElementById('review-screen');
const downloadScreen = document.getElementById('download-screen');
const progressBar    = document.getElementById('progress-bar');
const progressLabel  = document.getElementById('progress-label');
const progressFill   = document.getElementById('progress-fill');
const btnSubmitTop   = document.getElementById('btn-submit-top');
const cardsContainer = document.getElementById('cards-container');
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const uploadError    = document.getElementById('upload-error');
const cardTemplate   = document.getElementById('card-template');

// ── File upload ──────────────────────────────────────────────────
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  uploadError.style.display = 'none';
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rawRows.length) throw new Error('The spreadsheet appears to be empty.');
      validateColumns(rawRows[0]);
      state.rawRows = rawRows;
      state.rows = rawRows.map(parseRow);
      state.selections = {};
      state.reviewed = new Set();
      state.rows.forEach((_, idx) => {
        state.selections[idx] = {
          categories: new Set(),
          topics: new Set(),
          tags: new Set(),
          comment: '',
        };
      });
      showReviewScreen();
    } catch (err) {
      showUploadError(err.message);
    }
  };
  reader.onerror = () => showUploadError('Failed to read the file.');
  reader.readAsArrayBuffer(file);
}

const REQUIRED_COLS = ['post_id', 'title', 'summary', 'categories1', 'categories2', 'topics1', 'topics2', 'tags1', 'tags2'];

function validateColumns(row) {
  const cols = Object.keys(row).map(k => k.trim().toLowerCase());
  const missing = REQUIRED_COLS.filter(c => !cols.includes(c));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);
}

function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.style.display = 'block';
}

// ── Row parsing ──────────────────────────────────────────────────
function splitField(val) {
  if (!val) return [];
  return String(val).split('|').map(s => s.trim()).filter(Boolean);
}

function normalizeKey(s) {
  return s.trim().toLowerCase();
}

// Returns array of { item, inV1, inV2 } preserving original casing from V1 (or V2 if only in V2)
function unionWithOrigin(v1Str, v2Str) {
  const v1 = splitField(v1Str);
  const v2 = splitField(v2Str);
  const v1Map = new Map(v1.map(i => [normalizeKey(i), i]));
  const v2Map = new Map(v2.map(i => [normalizeKey(i), i]));
  const allKeys = new Set([...v1Map.keys(), ...v2Map.keys()]);
  const result = [];
  allKeys.forEach(key => {
    result.push({
      item: v1Map.get(key) || v2Map.get(key),
      inV1: v1Map.has(key),
      inV2: v2Map.has(key),
    });
  });
  return result;
}

function getCol(row, name) {
  // case-insensitive column lookup
  const key = Object.keys(row).find(k => k.trim().toLowerCase() === name);
  return key !== undefined ? row[key] : '';
}

function parseRow(row) {
  return {
    post_id:    String(getCol(row, 'post_id')),
    title:      String(getCol(row, 'title')),
    clean_url:  String(getCol(row, 'clean_url')),
    summary:    String(getCol(row, 'summary')),
    categories: unionWithOrigin(getCol(row, 'categories1'), getCol(row, 'categories2')),
    topics:     unionWithOrigin(getCol(row, 'topics1'),     getCol(row, 'topics2')),
    tags:       unionWithOrigin(getCol(row, 'tags1'),       getCol(row, 'tags2')),
    // keep originals for output
    _raw: row,
  };
}

// ── Render ───────────────────────────────────────────────────────
function showReviewScreen() {
  uploadScreen.style.display = 'none';
  progressBar.classList.add('visible');
  reviewScreen.classList.add('visible');
  renderAllCards();
  updateProgress();
}

function renderAllCards() {
  cardsContainer.innerHTML = '';
  state.rows.forEach((row, idx) => {
    const card = renderCard(row, idx);
    cardsContainer.appendChild(card);
  });
}

function renderCard(row, idx) {
  const frag = cardTemplate.content.cloneNode(true);
  const card = frag.querySelector('.article-card');
  card.dataset.idx = idx;

  card.querySelector('.post-id').textContent = `ID: ${row.post_id}`;

  const titleEl = card.querySelector('.article-title');
  if (row.clean_url) {
    const link = document.createElement('a');
    link.href = row.clean_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = row.title;
    titleEl.textContent = '';
    titleEl.appendChild(link);
  } else {
    titleEl.textContent = row.title;
  }

  card.querySelector('.article-summary').textContent = row.summary;

  renderChipSection(card, 'categories', row.categories, idx);
  renderChipSection(card, 'topics',     row.topics,     idx);
  renderChipSection(card, 'tags',       row.tags,       idx);

  // Comment textarea
  const textarea = card.querySelector('.comment-textarea');
  textarea.addEventListener('input', () => {
    state.selections[idx].comment = textarea.value;
    autoMarkReviewed(idx, card);
  });

  // Mark / unmark buttons
  const btnMark = card.querySelector('.btn-mark');
  const badge   = card.querySelector('.reviewed-badge');

  btnMark.addEventListener('click', () => {
    if (state.reviewed.has(idx)) {
      // Unmark
      state.reviewed.delete(idx);
      card.classList.remove('reviewed');
      badge.classList.remove('visible');
      btnMark.textContent = 'Mark as reviewed';
      btnMark.className = 'btn-mark';
    } else {
      markReviewed(idx, card);
    }
    updateProgress();
  });

  return frag;
}

function renderChipSection(card, field, items, idx) {
  const section  = card.querySelector(`.chip-section[data-field="${field}"]`);
  const chipsRow = section.querySelector('.chips-row');

  if (!items.length) {
    chipsRow.innerHTML = '<span class="chip-empty">None</span>';
    return;
  }

  items.forEach(({ item }) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = item;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const key = normalizeKey(item);
      const sel = state.selections[idx][field];
      if (sel.has(key)) {
        sel.delete(key);
        btn.classList.remove('selected');
      } else {
        sel.add(key);
        btn.classList.add('selected');
      }
      const cardEl = document.querySelector(`.article-card[data-idx="${idx}"]`);
      autoMarkReviewed(idx, cardEl);
      updateProgress();
    });
    chipsRow.appendChild(btn);
  });
}

function autoMarkReviewed(idx, cardEl) {
  if (!state.reviewed.has(idx)) {
    markReviewed(idx, cardEl);
    updateProgress();
  }
}

function markReviewed(idx, cardEl) {
  state.reviewed.add(idx);
  cardEl.classList.add('reviewed');
  const badge = cardEl.querySelector('.reviewed-badge');
  badge.classList.add('visible');
  const btnMark = cardEl.querySelector('.btn-mark');
  btnMark.textContent = 'Undo review';
  btnMark.className = 'btn-unmark';
}

// ── Progress ─────────────────────────────────────────────────────
function updateProgress() {
  const total    = state.rows.length;
  const done     = state.reviewed.size;
  const pct      = total ? Math.round((done / total) * 100) : 0;

  progressLabel.textContent = `${done} / ${total} reviewed`;
  progressFill.style.width  = `${pct}%`;

  if (done === total && total > 0) {
    btnSubmitTop.classList.add('active');
  } else {
    btnSubmitTop.classList.remove('active');
  }
}

// ── Submit ────────────────────────────────────────────────────────
btnSubmitTop.addEventListener('click', () => {
  if (!btnSubmitTop.classList.contains('active')) return;
  reviewScreen.classList.remove('visible');
  progressBar.classList.remove('visible');
  downloadScreen.classList.add('visible');
});

// ── Download: labeled table ───────────────────────────────────────
document.getElementById('btn-download-table').addEventListener('click', () => {
  const csv = buildLabeledCSV();
  downloadBlob(csv, 'labeled_table.csv', 'text/csv');
});

function buildLabeledCSV() {
  const headers = [...REQUIRED_COLS, 'categories_chosen', 'topics_chosen', 'tags_chosen', 'comment'];
  const lines = [headers.map(csvEscape).join(',')];

  state.rows.forEach((row, idx) => {
    const sel = state.selections[idx];

    const chosenCategories = resolveSelected(row.categories, sel.categories);
    const chosenTopics     = resolveSelected(row.topics,     sel.topics);
    const chosenTags       = resolveSelected(row.tags,       sel.tags);

    const line = [
      getCol(row._raw, 'post_id'),
      getCol(row._raw, 'title'),
      getCol(row._raw, 'summary'),
      getCol(row._raw, 'categories1'),
      getCol(row._raw, 'categories2'),
      getCol(row._raw, 'topics1'),
      getCol(row._raw, 'topics2'),
      getCol(row._raw, 'tags1'),
      getCol(row._raw, 'tags2'),
      chosenCategories.join('|'),
      chosenTopics.join('|'),
      chosenTags.join('|'),
      sel.comment,
    ].map(csvEscape).join(',');

    lines.push(line);
  });

  return lines.join('\r\n');
}

// Returns original-cased items whose normalizeKey is in selectedSet
function resolveSelected(items, selectedSet) {
  return items
    .filter(({ item }) => selectedSet.has(normalizeKey(item)))
    .map(({ item }) => item);
}

// ── Download: report ─────────────────────────────────────────────
document.getElementById('btn-download-report').addEventListener('click', () => {
  const csv = buildReport();
  downloadBlob(csv, 'version_report.csv', 'text/csv');
});

function buildReport() {
  // Per-article breakdown + totals
  const detailHeaders = ['post_id', 'title', 'field', 'chosen_count', 'v1_only_chosen', 'v2_only_chosen', 'both_chosen', 'skipped'];
  const lines = [detailHeaders.map(csvEscape).join(',')];

  let totalV1 = 0, totalV2 = 0, totalBoth = 0;

  state.rows.forEach((row, idx) => {
    const sel = state.selections[idx];

    ['categories', 'topics', 'tags'].forEach(field => {
      const items = row[field];
      const selectedSet = sel[field];
      let v1Only = 0, v2Only = 0, both = 0, skipped = 0, chosen = 0;

      items.forEach(({ item, inV1, inV2 }) => {
        const isChosen = selectedSet.has(normalizeKey(item));
        if (isChosen) {
          chosen++;
          if (inV1 && inV2) both++;
          else if (inV1)    v1Only++;
          else              v2Only++;
        } else {
          skipped++;
        }
      });

      totalV1   += v1Only;
      totalV2   += v2Only;
      totalBoth += both;

      lines.push([row.post_id, row.title, field, chosen, v1Only, v2Only, both, skipped].map(csvEscape).join(','));
    });
  });

  // Summary section
  lines.push('');
  lines.push(['SUMMARY', '', '', '', '', '', '', ''].map(csvEscape).join(','));
  lines.push(['Metric', 'Value', '', '', '', '', '', ''].map(csvEscape).join(','));
  lines.push(['V1-only items chosen', totalV1, '', '', '', '', '', ''].map(csvEscape).join(','));
  lines.push(['V2-only items chosen', totalV2, '', '', '', '', '', ''].map(csvEscape).join(','));
  lines.push(['Shared (both) items chosen', totalBoth, '', '', '', '', '', ''].map(csvEscape).join(','));

  const total = totalV1 + totalV2;
  const v1Pct = total ? ((totalV1 / total) * 100).toFixed(1) : '—';
  const v2Pct = total ? ((totalV2 / total) * 100).toFixed(1) : '—';
  lines.push(['V1 preference score (%)', total ? v1Pct + '%' : '—', '', '', '', '', '', ''].map(csvEscape).join(','));
  lines.push(['V2 preference score (%)', total ? v2Pct + '%' : '—', '', '', '', '', '', ''].map(csvEscape).join(','));

  let verdict = '—';
  if (total > 0) {
    if (totalV1 > totalV2) verdict = 'Version 1 is preferred';
    else if (totalV2 > totalV1) verdict = 'Version 2 is preferred';
    else verdict = 'Tie — both versions equally preferred';
  }
  lines.push(['Verdict', verdict, '', '', '', '', '', ''].map(csvEscape).join(','));

  return lines.join('\r\n');
}

// ── Back to review ────────────────────────────────────────────────
document.getElementById('btn-back-review').addEventListener('click', () => {
  downloadScreen.classList.remove('visible');
  progressBar.classList.add('visible');
  reviewScreen.classList.add('visible');
});

// ── Restart ───────────────────────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', () => {
  downloadScreen.classList.remove('visible');
  reviewScreen.classList.remove('visible');
  progressBar.classList.remove('visible');
  uploadScreen.style.display = '';
  fileInput.value = '';
  cardsContainer.innerHTML = '';
  uploadError.style.display = 'none';
  Object.assign(state, { rawRows: [], rows: [], selections: {}, reviewed: new Set() });
});

// ── Utilities ─────────────────────────────────────────────────────
function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob(['\uFEFF' + content], { type: mime + ';charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
