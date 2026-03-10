/* ================================================================
   Tag Review Tool — app.js
   ================================================================ */

// ── State ────────────────────────────────────────────────────────
const state = {
  rawRows: [],    // original objects from the spreadsheet
  rows: [],       // enriched: { ..., categories, topics, tags } each an array of {item, inV1, inV2}
  selections: {}, // { idx: { categories: Set<string>, topics: Set<string>, tags: Set<string>, comment: "" } }
  reviewed: new Set(),
  taxonomy: null,      // null or { "Category Name": ["Topic A", "Topic B", ...] }
  tagSet: null,        // null or ["Tag A", "Tag B", ...] (flat deduplicated list)
  taxonomyAdded: {},   // { idx: { categories: Set<key>, topics: Set<key>, tags: Set<key> } }
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
        state.taxonomyAdded[idx] = { categories: new Set(), topics: new Set(), tags: new Set() };
      });
      showStep2();
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

// ── Step 2: taxonomy upload ─────────────────────────────────────
const uploadStep1      = document.getElementById('upload-step1');
const uploadStep2      = document.getElementById('upload-step2');
const step2FileInfo    = document.getElementById('step2-file-info');
const taxonomyDropZone = document.getElementById('taxonomy-drop-zone');
const taxonomyFileInput= document.getElementById('taxonomy-file-input');
const taxonomyStatus   = document.getElementById('taxonomy-status');
const taxonomyError    = document.getElementById('taxonomy-error');
const btnNextReview    = document.getElementById('btn-next-review');

function showStep2() {
  uploadStep1.style.display = 'none';
  uploadStep2.style.display = '';
  step2FileInfo.textContent = `${state.rows.length} articles ready for review.`;
}

taxonomyFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleTaxonomyFile(e.target.files[0]);
});

taxonomyDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  taxonomyDropZone.classList.add('drag-over');
});

taxonomyDropZone.addEventListener('dragleave', () => taxonomyDropZone.classList.remove('drag-over'));

taxonomyDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  taxonomyDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleTaxonomyFile(e.dataTransfer.files[0]);
});

function handleTaxonomyFile(file) {
  taxonomyError.style.display = 'none';
  taxonomyStatus.style.display = 'none';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) throw new Error('Taxonomy file is empty.');
      validateTaxonomyColumns(rows[0]);
      state.taxonomy = buildTaxonomyHierarchy(rows);

      const catCount = Object.keys(state.taxonomy).length;
      const topicCount = Object.values(state.taxonomy).reduce((s, arr) => s + arr.length, 0);
      taxonomyStatus.textContent = `✔ Taxonomy loaded: ${catCount} categories, ${topicCount} topics.`;
      taxonomyStatus.style.display = 'block';
    } catch (err) {
      taxonomyError.textContent = err.message;
      taxonomyError.style.display = 'block';
      state.taxonomy = null;
    }
  };
  reader.onerror = () => {
    taxonomyError.textContent = 'Failed to read taxonomy file.';
    taxonomyError.style.display = 'block';
  };
  reader.readAsArrayBuffer(file);
}

function validateTaxonomyColumns(row) {
  const cols = Object.keys(row).map(k => k.trim().toLowerCase());
  if (!cols.includes('category')) throw new Error('Taxonomy file must have a "category" column.');
  if (!cols.includes('topic'))    throw new Error('Taxonomy file must have a "topic" column.');
}

function buildTaxonomyHierarchy(rows) {
  const hierarchy = {};
  const seen = {};

  rows.forEach(row => {
    const cat   = String(getCol(row, 'category')).trim();
    const topic = String(getCol(row, 'topic')).trim();
    if (!cat) return;

    const catKey = normalizeKey(cat);
    if (!seen[catKey]) {
      seen[catKey] = cat;
      hierarchy[cat] = [];
    }
    const canonicalCat = seen[catKey];
    if (topic && !hierarchy[canonicalCat].some(t => normalizeKey(t) === normalizeKey(topic))) {
      hierarchy[canonicalCat].push(topic);
    }
  });

  return hierarchy;
}

btnNextReview.addEventListener('click', () => {
  showReviewScreen();
});

// ── Step 2b: tag set upload ─────────────────────────────────────
const tagsetDropZone  = document.getElementById('tagset-drop-zone');
const tagsetFileInput = document.getElementById('tagset-file-input');
const tagsetStatus    = document.getElementById('tagset-status');
const tagsetError     = document.getElementById('tagset-error');

tagsetFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleTagSetFile(e.target.files[0]);
});

tagsetDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  tagsetDropZone.classList.add('drag-over');
});

tagsetDropZone.addEventListener('dragleave', () => tagsetDropZone.classList.remove('drag-over'));

tagsetDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  tagsetDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleTagSetFile(e.dataTransfer.files[0]);
});

function handleTagSetFile(file) {
  tagsetError.style.display = 'none';
  tagsetStatus.style.display = 'none';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) throw new Error('Tag set file is empty.');
      validateTagSetColumns(rows[0]);
      state.tagSet = buildTagSet(rows);

      tagsetStatus.textContent = `✔ Tag set loaded: ${state.tagSet.length} tags.`;
      tagsetStatus.style.display = 'block';
    } catch (err) {
      tagsetError.textContent = err.message;
      tagsetError.style.display = 'block';
      state.tagSet = null;
    }
  };
  reader.onerror = () => {
    tagsetError.textContent = 'Failed to read tag set file.';
    tagsetError.style.display = 'block';
  };
  reader.readAsArrayBuffer(file);
}

function validateTagSetColumns(row) {
  const cols = Object.keys(row).map(k => k.trim().toLowerCase());
  if (!cols.includes('tag')) throw new Error('Tag set file must have a "tag" column.');
}

function buildTagSet(rows) {
  const seen = new Set();
  const tags = [];
  rows.forEach(row => {
    const tag = String(getCol(row, 'tag')).trim();
    if (!tag) return;
    const key = normalizeKey(tag);
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  });
  return tags;
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

  // Show the taxonomy hint only when taxonomy is loaded
  const hint = card.querySelector('.chip-section-hint');
  if (hint) hint.style.display = state.taxonomy ? '' : 'none';

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
  chipsRow.innerHTML = '';
  renderChipSectionContent(chipsRow, field, items, idx);
}

function hasAddSupport(field) {
  if (field === 'topics' && state.taxonomy) return true;
  if (field === 'tags' && state.tagSet) return true;
  return false;
}

function renderChipSectionContent(chipsRow, field, items, idx) {
  if (!items.length && !hasAddSupport(field)) {
    chipsRow.innerHTML = '<span class="chip-empty">None</span>';
    return;
  }

  items.forEach(({ item, fromTaxonomy }) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    if (fromTaxonomy) btn.classList.add('chip-taxonomy');
    btn.textContent = item;
    btn.type = 'button';

    // Restore selection state
    const key = normalizeKey(item);
    if (state.selections[idx][field].has(key)) {
      btn.classList.add('selected');
    }

    btn.addEventListener('click', () => {
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

  // "+ Add" button for topics when taxonomy is loaded (topics auto-add parent category)
  if (state.taxonomy && field === 'topics') {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-taxonomy-add';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaxonomyDropdown(addBtn, field, idx);
    });
    chipsRow.appendChild(addBtn);
  }

  // "+ Add" button for tags when tag set is loaded
  if (state.tagSet && field === 'tags') {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-taxonomy-add';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagDropdown(addBtn, idx);
    });
    chipsRow.appendChild(addBtn);
  }
}

// ── Taxonomy dropdown ───────────────────────────────────────────
let activeTaxDropdown = null;

function closeTaxonomyDropdown() {
  if (activeTaxDropdown) {
    activeTaxDropdown.remove();
    activeTaxDropdown = null;
  }
  document.removeEventListener('click', onDocClickCloseTax);
}

function onDocClickCloseTax(e) {
  if (activeTaxDropdown && !activeTaxDropdown.contains(e.target)) {
    closeTaxonomyDropdown();
  }
}

function openTaxonomyDropdown(anchorBtn, field, idx) {
  closeTaxonomyDropdown();

  const dropdown = document.createElement('div');
  dropdown.className = 'taxonomy-dropdown';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'taxonomy-search';
  searchInput.placeholder = field === 'categories'
    ? 'Search categories...'
    : 'Search topics or categories...';
  dropdown.appendChild(searchInput);

  const listEl = document.createElement('div');
  listEl.className = 'taxonomy-list';
  dropdown.appendChild(listEl);

  function renderList(query) {
    listEl.innerHTML = '';
    const q = (query || '').trim().toLowerCase();

    Object.entries(state.taxonomy).forEach(([cat, topics]) => {
      const catMatch = !q || normalizeKey(cat).includes(q);
      const matchingTopics = topics.filter(t => normalizeKey(t).includes(q));

      if (!catMatch && matchingTopics.length === 0) return;

      // Category header (non-clickable group label)
      const catRow = document.createElement('div');
      catRow.className = 'taxonomy-category-header';
      catRow.textContent = cat;
      listEl.appendChild(catRow);

      // Topic rows
      const topicsToShow = catMatch ? topics : matchingTopics;
      topicsToShow.forEach(topic => {
        const topicRow = document.createElement('div');
        topicRow.className = 'taxonomy-item taxonomy-topic';
        topicRow.textContent = topic;

        const topicKey = normalizeKey(topic);
        const alreadyHasTopic = state.rows[idx].topics
          .some(t => normalizeKey(t.item) === topicKey);
        if (alreadyHasTopic) topicRow.classList.add('taxonomy-item-exists');

        topicRow.addEventListener('click', () => {
          addTaxonomyTopic(idx, topic, cat);
          closeTaxonomyDropdown();
        });
        listEl.appendChild(topicRow);
      });
    });

    if (!listEl.children.length) {
      const empty = document.createElement('div');
      empty.className = 'taxonomy-empty';
      empty.textContent = 'No matches found.';
      listEl.appendChild(empty);
    }
  }

  renderList('');
  searchInput.addEventListener('input', () => renderList(searchInput.value));

  // Position in chip-section
  const section = anchorBtn.closest('.chip-section');
  section.style.position = 'relative';
  section.appendChild(dropdown);

  activeTaxDropdown = dropdown;
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('click', onDocClickCloseTax);
  }, 0);
}

// ── Taxonomy add helpers ────────────────────────────────────────
function addTaxonomyCategory(idx, categoryName) {
  const catKey = normalizeKey(categoryName);
  const row = state.rows[idx];

  const alreadyExists = row.categories.some(c => normalizeKey(c.item) === catKey);
  if (!alreadyExists) {
    row.categories.push({ item: categoryName, inV1: false, inV2: false, fromTaxonomy: true });
    state.taxonomyAdded[idx].categories.add(catKey);
  }

  state.selections[idx].categories.add(catKey);
  rerenderCardChips(idx);
}

function addTaxonomyTopic(idx, topicName, parentCategory) {
  addTaxonomyCategory(idx, parentCategory);

  const topicKey = normalizeKey(topicName);
  const row = state.rows[idx];

  const alreadyExists = row.topics.some(t => normalizeKey(t.item) === topicKey);
  if (!alreadyExists) {
    row.topics.push({ item: topicName, inV1: false, inV2: false, fromTaxonomy: true });
    state.taxonomyAdded[idx].topics.add(topicKey);
  }

  state.selections[idx].topics.add(topicKey);
  rerenderCardChips(idx);
}

// ── Tag set dropdown + add helper ───────────────────────────────
function openTagDropdown(anchorBtn, idx) {
  closeTaxonomyDropdown();

  const dropdown = document.createElement('div');
  dropdown.className = 'taxonomy-dropdown';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'taxonomy-search';
  searchInput.placeholder = 'Search tags...';
  dropdown.appendChild(searchInput);

  const listEl = document.createElement('div');
  listEl.className = 'taxonomy-list';
  dropdown.appendChild(listEl);

  function renderList(query) {
    listEl.innerHTML = '';
    const q = (query || '').trim().toLowerCase();

    const filtered = state.tagSet.filter(tag => !q || normalizeKey(tag).includes(q));

    filtered.forEach(tag => {
      const row = document.createElement('div');
      row.className = 'taxonomy-item';
      row.textContent = tag;

      const tagKey = normalizeKey(tag);
      const alreadyHas = state.rows[idx].tags
        .some(t => normalizeKey(t.item) === tagKey);
      if (alreadyHas) row.classList.add('taxonomy-item-exists');

      row.addEventListener('click', () => {
        addTagFromSet(idx, tag);
        closeTaxonomyDropdown();
      });
      listEl.appendChild(row);
    });

    if (!listEl.children.length) {
      const empty = document.createElement('div');
      empty.className = 'taxonomy-empty';
      empty.textContent = 'No matches found.';
      listEl.appendChild(empty);
    }
  }

  renderList('');
  searchInput.addEventListener('input', () => renderList(searchInput.value));

  const section = anchorBtn.closest('.chip-section');
  section.style.position = 'relative';
  section.appendChild(dropdown);

  activeTaxDropdown = dropdown;
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('click', onDocClickCloseTax);
  }, 0);
}

function addTagFromSet(idx, tagName) {
  const tagKey = normalizeKey(tagName);
  const row = state.rows[idx];

  const alreadyExists = row.tags.some(t => normalizeKey(t.item) === tagKey);
  if (!alreadyExists) {
    row.tags.push({ item: tagName, inV1: false, inV2: false, fromTaxonomy: true });
    state.taxonomyAdded[idx].tags.add(tagKey);
  }

  state.selections[idx].tags.add(tagKey);
  rerenderCardChips(idx);
}

function rerenderCardChips(idx) {
  const card = document.querySelector(`.article-card[data-idx="${idx}"]`);
  if (!card) return;

  const row = state.rows[idx];
  ['categories', 'topics', 'tags'].forEach(field => {
    const section = card.querySelector(`.chip-section[data-field="${field}"]`);
    const chipsRow = section.querySelector('.chips-row');
    chipsRow.innerHTML = '';
    renderChipSectionContent(chipsRow, field, row[field], idx);
  });

  autoMarkReviewed(idx, card);
  updateProgress();
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
  const detailHeaders = ['post_id', 'title', 'field', 'chosen_count', 'v1_only_chosen', 'v2_only_chosen', 'both_chosen', 'taxonomy_added_chosen', 'skipped'];
  const lines = [detailHeaders.map(csvEscape).join(',')];

  let totalV1 = 0, totalV2 = 0, totalBoth = 0, totalTaxAdded = 0;
  let totalCatAdded = 0, totalTopicAdded = 0, totalTagAdded = 0;

  state.rows.forEach((row, idx) => {
    const sel = state.selections[idx];

    ['categories', 'topics', 'tags'].forEach(field => {
      const items = row[field];
      const selectedSet = sel[field];
      let v1Only = 0, v2Only = 0, both = 0, taxAdded = 0, skipped = 0, chosen = 0;

      items.forEach(({ item, inV1, inV2, fromTaxonomy }) => {
        const isChosen = selectedSet.has(normalizeKey(item));
        if (isChosen) {
          chosen++;
          if (fromTaxonomy)       taxAdded++;
          else if (inV1 && inV2)  both++;
          else if (inV1)          v1Only++;
          else                    v2Only++;
        } else {
          skipped++;
        }
      });

      totalV1       += v1Only;
      totalV2       += v2Only;
      totalBoth     += both;
      totalTaxAdded += taxAdded;
      if (field === 'categories') totalCatAdded += taxAdded;
      if (field === 'topics')     totalTopicAdded += taxAdded;
      if (field === 'tags')       totalTagAdded += taxAdded;

      lines.push([row.post_id, row.title, field, chosen, v1Only, v2Only, both, taxAdded, skipped].map(csvEscape).join(','));
    });
  });

  // Summary section
  const pad = ['', '', '', '', '', '', '', '', ''];
  lines.push('');
  lines.push(['SUMMARY', ...pad.slice(1)].map(csvEscape).join(','));
  lines.push(['Metric', 'Value', ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['V1-only items chosen', totalV1, ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['V2-only items chosen', totalV2, ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['Shared (both) items chosen', totalBoth, ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['Taxonomy categories added', totalCatAdded, ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['Taxonomy topics added', totalTopicAdded, ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['Tag set tags added', totalTagAdded, ...pad.slice(2)].map(csvEscape).join(','));

  const total = totalV1 + totalV2;
  const v1Pct = total ? ((totalV1 / total) * 100).toFixed(1) : '—';
  const v2Pct = total ? ((totalV2 / total) * 100).toFixed(1) : '—';
  lines.push(['V1 preference score (%)', total ? v1Pct + '%' : '—', ...pad.slice(2)].map(csvEscape).join(','));
  lines.push(['V2 preference score (%)', total ? v2Pct + '%' : '—', ...pad.slice(2)].map(csvEscape).join(','));

  let verdict = '—';
  if (total > 0) {
    if (totalV1 > totalV2) verdict = 'Version 1 is preferred';
    else if (totalV2 > totalV1) verdict = 'Version 2 is preferred';
    else verdict = 'Tie — both versions equally preferred';
  }
  lines.push(['Verdict', verdict, ...pad.slice(2)].map(csvEscape).join(','));

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
  uploadStep1.style.display = '';
  uploadStep2.style.display = 'none';
  fileInput.value = '';
  taxonomyFileInput.value = '';
  tagsetFileInput.value = '';
  cardsContainer.innerHTML = '';
  uploadError.style.display = 'none';
  taxonomyStatus.style.display = 'none';
  taxonomyError.style.display = 'none';
  tagsetStatus.style.display = 'none';
  tagsetError.style.display = 'none';
  closeTaxonomyDropdown();
  Object.assign(state, { rawRows: [], rows: [], selections: {}, reviewed: new Set(), taxonomy: null, tagSet: null, taxonomyAdded: {} });
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
