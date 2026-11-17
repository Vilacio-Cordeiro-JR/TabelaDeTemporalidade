'use strict';

/* ==========================================================================
   Tabela de Temporalidade e Destinação de Documentos
   ========================================================================== */

const LABELS = {
    vigencia: 'Prazo de vigência',
    arquivo: 'Prazo no arquivo',
    permanente: 'Guarda permanente',
    eliminacao: 'Eliminação',
    obs: 'Observações'
};

const PRIORITY_KEYWORDS = ['Dossiê', 'Processo', 'Contrato', 'Projeto', 'Relatório', 'Ofício', 'Memorando'];

const SYNONYMS_MAP = {
    'processo': ['expediente', 'autos', 'requerimento', 'dossie', 'procedimento', 'protocolo'],
    'contrato': ['termo', 'convenio', 'acordo', 'ajuste'],
    'relatorio': ['parecer', 'laudo', 'balanco', 'resumo'],
    'oficio': ['carta', 'memorando', 'comunicado', 'notificacao'],
    'dossie': ['prontuario', 'documentacao', 'colecao']
};

const PRIORITY_GROUPS = [
    { key: 'processo', weight: 4, label: 'Documentos do tipo Processo (Alta Prioridade)' },
    { key: 'both',     weight: 3, label: 'Palavra-chave no título e na observação' },
    { key: 'title',    weight: 2, label: 'Palavra-chave no título' },
    { key: 'obs',      weight: 1, label: 'Palavra-chave na observação' },
    { key: 'none',     weight: 0, label: 'Demais resultados' }
];

const MOBILE_QUERY = window.matchMedia('(max-width: 899px)');

let treeData = null;
let activeSelectionPath = [];
let currentView = 'cascade';
let searchTerms = [];
let searchResults = [];
let viewBeforeSearch = null;
let favoriteDocs = new Set(JSON.parse(localStorage.getItem('fav_docs') || '[]'));
let showingFavoritesOnly = false;

const allDocs = [];
const folderState = new Map();

const $ = (id) => document.getElementById(id);

/* ---------- Utilidades e Algoritmos de Busca ---------- */

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function normalize(text) {
    return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[a.length][b.length];
}

function isFuzzyMatch(targetWord, queryTerm) {
    if (targetWord.includes(queryTerm)) return true;
    if (queryTerm.length < 4) return false;
    const maxDistance = queryTerm.length > 7 ? 2 : 1;
    return levenshteinDistance(targetWord, queryTerm) <= maxDistance;
}

const PRIORITY_RE = new RegExp(
    '\\b(?:' + PRIORITY_KEYWORDS.map((k) => normalize(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
);

function weightOf(key) {
    return PRIORITY_GROUPS.find((g) => g.key === key).weight;
}

function priorityWeight(node) {
    const titleNorm = normalize(node.descricao);
    const obsNorm = normalize(node.documento.obs);

    if (titleNorm.includes('processo')) return weightOf('processo');

    const inTitle = PRIORITY_RE.test(titleNorm);
    const inObs = PRIORITY_RE.test(obsNorm);
    if (inTitle && inObs) return weightOf('both');
    if (inTitle) return weightOf('title');
    if (inObs) return weightOf('obs');
    return weightOf('none');
}

const hasDoc = (node) => node.documento !== null && node.documento !== undefined;
const hasKids = (node) => Array.isArray(node.filhos) && node.filhos.length > 0;
const hasNumericCode = (cod) => /\d/.test(cod || '');

function nodeLabel(node) {
    return hasNumericCode(node.cod) ? `${node.cod} – ${node.descricao}` : node.descricao;
}

function formatPrazo(value) {
    const t = String(value ?? '').trim();
    if (!t || t === '-') return '—';
    if (/^\d+$/.test(t)) return `${t} ${t === '1' ? 'ano' : 'anos'}`;
    return t;
}

function plural(n, one, many) {
    return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

function toggleFavorite(code) {
    if (favoriteDocs.has(code)) {
        favoriteDocs.delete(code);
    } else {
        favoriteDocs.add(code);
    }
    localStorage.setItem('fav_docs', JSON.stringify(Array.from(favoriteDocs)));
    renderApp();
}

function indexTree(node, parent = null) {
    node._parent = parent;
    node._id = String(indexTree.counter++);
    if (hasDoc(node)) {
        node._search = normalize(`${node.cod} ${node.descricao} ${node.documento.obs || ''}`);
        node._weight = priorityWeight(node);
        allDocs.push(node);
    }
    node._docs = hasDoc(node) ? 1 : 0;
    (node.filhos || []).forEach((child) => {
        indexTree(child, node);
        node._docs += child._docs;
    });
}
indexTree.counter = 0;

function pathTo(node) {
    const path = [];
    for (let n = node; n; n = n._parent) path.unshift(n);
    return path;
}

function currentNode() {
    return activeSelectionPath[activeSelectionPath.length - 1];
}

/* ---------- Inicialização ---------- */

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    $('cascadeWrapper').innerHTML = '<div class="notice"><p>Carregando tabela…</p></div>';

    fetch('arvore_temporalidade.json')
        .then((response) => {
            if (!response.ok) throw new Error('Erro ao carregar dados da árvore.');
            return response.json();
        })
        .then((data) => {
            treeData = data;
            indexTree(treeData);
            activeSelectionPath = [treeData];
            switchView('cascade');
        })
        .catch((error) => {
            console.error(error);
            $('breadcrumbBar').innerHTML = '';
            $('cascadeWrapper').innerHTML = `
                <div class="notice">
                    <p><strong>Erro ao carregar a tabela.</strong></p>
                    <p>Certifique-se de que o arquivo <em>arvore_temporalidade.json</em> esteja presente na mesma pasta.</p>
                </div>`;
        });
});

/* ---------- Eventos ---------- */

function bindEvents() {
    $('btnViewCascade').addEventListener('click', () => {
        showingFavoritesOnly = false;
        switchView('cascade');
    });

    $('btnViewList').addEventListener('click', () => {
        showingFavoritesOnly = false;
        switchView('list');
    });

    $('btnViewFav').addEventListener('click', () => {
        showingFavoritesOnly = true;
        switchView('list');
    });

    let timer = null;
    $('searchInput').addEventListener('input', (e) => {
        clearTimeout(timer);
        const value = e.target.value;
        timer = setTimeout(() => handleSearch(value), 200);
    });

    $('breadcrumbBar').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-depth]');
        if (btn) jumpToDepth(Number(btn.dataset.depth));
    });

    document.addEventListener('click', (e) => {
        const favBtn = e.target.closest('[data-fav]');
        if (favBtn) {
            e.stopPropagation();
            toggleFavorite(favBtn.dataset.fav);
        }
    });

    $('cascadeWrapper').addEventListener('click', (e) => {
        const block = e.target.closest('[data-idx]');
        if (!block) return;
        const depth = Number(block.dataset.depth);
        const child = activeSelectionPath[depth].filhos[Number(block.dataset.idx)];
        const wasOpen = activeSelectionPath[depth + 1] === child;

        activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
        if (!wasOpen && hasKids(child)) activeSelectionPath.push(child);
        renderApp();
    });

    $('listViewWrapper').addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-toggle]');
        if (toggle) {
            const id = toggle.dataset.toggle;
            folderState.set(id, toggle.getAttribute('aria-expanded') !== 'true');
            return renderListView();
        }
        const action = e.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'clear-search') return clearSearch();
        setAllFolders(currentNode(), action.dataset.action === 'expand');
        renderListView();
    });

    const onBreakpoint = () => { if (treeData) renderApp(); };
    if (MOBILE_QUERY.addEventListener) MOBILE_QUERY.addEventListener('change', onBreakpoint);
    else MOBILE_QUERY.addListener(onBreakpoint);
}

/* ---------- Renderização & Navegação ---------- */

function switchView(view) {
    currentView = view;
    const isCascade = view === 'cascade' && !showingFavoritesOnly;

    $('btnViewCascade').classList.toggle('is-active', isCascade);
    $('btnViewCascade').setAttribute('aria-pressed', String(isCascade));
    
    $('btnViewList').classList.toggle('is-active', view === 'list' && !showingFavoritesOnly);
    $('btnViewList').setAttribute('aria-pressed', String(view === 'list' && !showingFavoritesOnly));

    $('btnViewFav').classList.toggle('is-active', showingFavoritesOnly);
    $('btnViewFav').setAttribute('aria-pressed', String(showingFavoritesOnly));

    $('cascadeWrapper').hidden = !isCascade;
    $('listViewWrapper').hidden = isCascade;

    renderApp();
}

function renderApp() {
    renderBreadcrumb();
    if (showingFavoritesOnly) {
        renderFavoritesView();
    } else if (currentView === 'cascade') {
        renderCascade();
    } else {
        renderListView();
    }
}

function jumpToDepth(depth) {
    activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
    renderApp();
}

function renderBreadcrumb() {
    const bar = $('breadcrumbBar');
    const last = activeSelectionPath.length - 1;

    bar.innerHTML = activeSelectionPath.map((node, i) => {
        const name = i === 0 ? 'Início' : nodeLabel(node);
        if (i === last) {
            return `<span class="crumb crumb--current" title="${esc(name)}" aria-current="page">${esc(name)}</span>`;
        }
        return `<button type="button" class="crumb" data-depth="${i}" title="${esc(name)}">${esc(name)}</button>` +
               '<span class="crumb-sep" aria-hidden="true">/</span>';
    }).join('');

    bar.scrollLeft = bar.scrollWidth;
}

/* ---------- Componentes da Interface ---------- */

function highlight(text, terms) {
    const s = String(text ?? '');
    if (!terms || !terms.length) return esc(s);

    let norm = '';
    const map = [];
    for (let i = 0; i < s.length; i++) {
        const n = normalize(s[i]);
        for (let k = 0; k < n.length; k++) { norm += n[k]; map.push(i); }
    }

    const ranges = [];
    terms.forEach((t) => {
        let from = 0;
        let idx;
        while ((idx = norm.indexOf(t, from)) !== -1) {
            ranges.push([map[idx], map[idx + t.length - 1] + 1]);
            from = idx + t.length;
        }
    });
    ranges.sort((a, b) => a[0] - b[0]);

    let out = '';
    let last = 0;
    for (const [a, b] of ranges) {
        if (b <= last) continue;
        const start = Math.max(a, last);
        out += esc(s.slice(last, start)) + '<mark>' + esc(s.slice(start, b)) + '</mark>';
        last = b;
    }
    return out + esc(s.slice(last));
}

function docHtml(node, terms = []) {
    const d = node.documento;
    const perm = !d.eliminacao;
    const isFav = favoriteDocs.has(node.cod);

    return `
        <article class="doc${perm ? '' : ' doc--elim'}">
            <div class="doc__top">
                <span class="doc__cod">${highlight(node.cod, terms)}</span>
                <div>
                    <button type="button" class="btn-fav ${isFav ? 'is-fav' : ''}" data-fav="${esc(node.cod)}" title="${isFav ? 'Remover dos Favoritos' : 'Favoritar Tipologia'}">
                        ${isFav ? '★' : '☆'}
                    </button>
                    <span class="badge ${perm ? 'badge--perm' : 'badge--elim'}">${perm ? LABELS.permanente : LABELS.eliminacao}</span>
                </div>
            </div>
            <h3 class="doc__title">${highlight(node.descricao, terms)}</h3>
            <dl class="doc__fields">
                <div><dt>${LABELS.vigencia}</dt><dd>${esc(formatPrazo(d.prazo_vigencia))}</dd></div>
                <div><dt>${LABELS.arquivo}</dt><dd>${esc(formatPrazo(d.unidade_atribuicao_arquivistica))}</dd></div>
            </dl>
            ${d.obs ? `<p class="doc__obs"><strong>${LABELS.obs}:</strong> ${highlight(d.obs, terms)}</p>` : ''}
        </article>`;
}

/* ---------- Visão em Cascata (Miller Columns com Ícones de Pasta) ---------- */

function blockHtml(child, index, depth, selected) {
    const navigable = hasKids(child);
    const tag = navigable ? 'button' : 'div';
    const attrs = navigable 
        ? ` type="button" data-depth="${depth}" data-idx="${index}" aria-expanded="${selected}" title="${esc(nodeLabel(child))}"` 
        : ` title="${esc(nodeLabel(child))}"`;
    
    const cod = hasNumericCode(child.cod) ? `<span class="nodeblk__cod">${esc(child.cod)}</span>` : '';
    const icon = selected ? '📂' : '📁';
    
    const count = navigable 
        ? `<span class="nodeblk__n" title="${plural(child.filhos.length, 'item', 'itens')}">${child.filhos.length}</span>` 
        : '';
    const arrow = navigable ? `<span class="nodeblk__arrow">›</span>` : '';

    return `
        <${tag} class="nodeblk${selected ? ' is-selected' : ''}"${attrs}>
            <span class="nodeblk__main">
                <span class="nodeblk__icon" aria-hidden="true">${icon}</span>
                ${cod}
                <span class="nodeblk__desc">${esc(child.descricao)}</span>
            </span>
            <span class="nodeblk__right">
                ${count}
                ${arrow}
            </span>
        </${tag}>`;
}

function cascadeColumnHtml(parent, depth) {
    const kids = parent.filhos || [];
    const selectedChild = activeSelectionPath[depth + 1];
    const isDocColumn = kids.some(hasDoc);

    const items = kids.map((child, index) => {
        if (hasDoc(child)) {
            return `<li class="tn tn--doc">${docHtml(child)}</li>`;
        }
        const isSelected = child === selectedChild;
        return `<li class="tn">${blockHtml(child, index, depth, isSelected)}</li>`;
    });

    return `<ul class="tg tg--depth-${depth}${isDocColumn ? ' tg--docs' : ''}">${items.join('')}</ul>`;
}

function renderCascade() {
    const wrap = $('cascadeWrapper');
    if (!activeSelectionPath.length) return;

    const columnsHtml = activeSelectionPath.map((node, depth) => {
        if (hasKids(node)) {
            return cascadeColumnHtml(node, depth);
        }
        return '';
    }).join('');

    wrap.innerHTML = columnsHtml;

    if (MOBILE_QUERY.matches) return;

    requestAnimationFrame(() => {
        wrap.scrollLeft = wrap.scrollWidth;
    });
}

/* ---------- Visão em Lista / Árvore Expandível ---------- */

function isOpen(node, level) {
    return folderState.has(node._id) ? folderState.get(node._id) : level === 1;
}

function setAllFolders(node, open) {
    (node.filhos || []).forEach((child) => {
        if (hasKids(child) && !hasDoc(child)) folderState.set(child._id, open);
        setAllFolders(child, open);
    });
}

function listNodeHtml(node, level) {
    if (hasDoc(node)) return docHtml(node);
    if (!hasKids(node)) return '';

    const open = isOpen(node, level);
    const cod = hasNumericCode(node.cod) ? `<span class="folder__cod">${esc(node.cod)}</span>` : '';
    const icon = open ? '📂' : '📁';

    return `
        <section class="folder folder--l${Math.min(level, 3)}">
            <button type="button" class="folder__head" data-toggle="${node._id}" aria-expanded="${open}">
                <span class="folder__main">
                    <span class="folder__icon" aria-hidden="true">${icon}</span>
                    ${cod}
                    <span class="folder__name">${esc(node.descricao)}</span>
                </span>
                <span class="folder__count">${plural(node.filhos.length, 'item', 'itens')}</span>
                <span class="folder__toggle" aria-hidden="true">${open ? '−' : '+'}</span>
            </button>
            ${open ? `<div class="folder__children">${node.filhos.map((c) => listNodeHtml(c, level + 1)).join('')}</div>` : ''}
        </section>`;
}

function renderListView() {
    if (searchTerms.length) return renderSearchResults();

    const container = $('listViewWrapper');
    const node = currentNode();
    const title = node === treeData ? 'Todas as áreas' : node.descricao;

    container.innerHTML = `
        <div class="list-inner">
            <div class="list-head">
                <div>
                    <h2 class="list-head__title">${esc(title)}</h2>
                    <p class="list-head__hint">${plural(node._docs, 'documento', 'documentos')}. Use as pastas para abrir ou fechar cada grupo.</p>
                </div>
                <div class="list-actions">
                    <button type="button" class="btn" data-action="expand">Expandir tudo</button>
                    <button type="button" class="btn" data-action="collapse">Recolher tudo</button>
                </div>
            </div>
            <div class="tree">${(node.filhos || []).map((c) => listNodeHtml(c, 1)).join('')}</div>
        </div>`;
}

function renderFavoritesView() {
    const container = $('listViewWrapper');
    const favs = allDocs.filter((d) => favoriteDocs.has(d.cod));

    const body = favs.length
        ? `<div class="results">${favs.map(resultHtml).join('')}</div>`
        : `<div class="notice">
               <p>Nenhuma tipologia favoritada ainda.</p>
               <p>Clique na estrela (☆) ao lado de qualquer folha/documento para adicioná-la aqui.</p>
           </div>`;

    container.innerHTML = `
        <div class="list-inner">
            <div class="list-head">
                <div>
                    <h2 class="list-head__title">Tipologias Favoritas</h2>
                    <p class="list-head__hint">${plural(favs.length, 'documento favoritado', 'documentos favoritados')}.</p>
                </div>
            </div>
            ${body}
        </div>`;
}

/* ---------- Mecanismo de Pesquisa ---------- */

function resultHtml(doc) {
    const folders = pathTo(doc).slice(1, -1).map((n) => esc(nodeLabel(n))).join(' › ');
    return `
        <div class="result">
            <p class="result__path">${folders}</p>
            ${docHtml(doc, searchTerms)}
        </div>`;
}

function resultsHtml() {
    if (!searchResults.some((d) => d._weight > 0)) {
        return `<div class="results">${searchResults.map(resultHtml).join('')}</div>`;
    }

    return PRIORITY_GROUPS.map((group) => {
        const docs = searchResults.filter((d) => d._weight === group.weight);
        if (!docs.length) return '';
        return `
            <section class="result-group result-group--${group.key}">
                <h3 class="result-group__title">
                    <span>${esc(group.label)}</span>
                    <span class="result-group__count">${plural(docs.length, 'documento', 'documentos')}</span>
                </h3>
                <div class="results">${docs.map(resultHtml).join('')}</div>
            </section>`;
    }).join('');
}

function renderSearchResults() {
    const container = $('listViewWrapper');
    const total = searchResults.length;
    const typed = $('searchInput').value.trim();

    const body = total
        ? resultsHtml()
        : `<div class="notice">
               <p>Nenhum documento encontrado para <strong>“${esc(typed)}”</strong>.</p>
               <p>Tente outro termo, sinônimo ou código.</p>
           </div>`;

    container.innerHTML = `
        <div class="list-inner">
            <div class="list-head">
                <div>
                    <h2 class="list-head__title">Resultados da busca</h2>
                    <p class="list-head__hint">${plural(total, 'documento encontrado', 'documentos encontrados')} para “${esc(typed)}”.</p>
                </div>
                <div class="list-actions">
                    <button type="button" class="btn" data-action="clear-search">Limpar busca</button>
                </div>
            </div>
            ${body}
        </div>`;

    container.scrollTop = 0;
}

function clearSearch() {
    $('searchInput').value = '';
    handleSearch('');
}

function handleSearch(query) {
    if (!treeData) return;
    const status = $('searchStatus');
    const rawTerms = normalize(query).split(/\s+/).filter(Boolean);
    
    let expandedTerms = [...rawTerms];
    rawTerms.forEach(t => {
        if (SYNONYMS_MAP[t]) {
            expandedTerms.push(...SYNONYMS_MAP[t]);
        }
    });

    searchTerms = rawTerms;

    if (!rawTerms.length) {
        searchResults = [];
        status.textContent = '';
        if (viewBeforeSearch) {
            const previous = viewBeforeSearch;
            viewBeforeSearch = null;
            switchView(previous);
        } else {
            renderApp();
        }
        return;
    }

    searchResults = allDocs.filter((doc) => {
        const textWords = doc._search.split(/\s+/);
        
        return rawTerms.every((queryTerm) => {
            const related = [queryTerm, ...(SYNONYMS_MAP[queryTerm] || [])];
            const hasExactOrSynonym = related.some(term => doc._search.includes(term));
            if (hasExactOrSynonym) return true;

            return textWords.some(word => isFuzzyMatch(word, queryTerm));
        });
    });

    searchResults.sort((a, b) => b._weight - a._weight);

    status.textContent = searchResults.length
        ? plural(searchResults.length, 'resultado', 'resultados') + '.'
        : 'Nenhum documento encontrado.';

    if (currentView !== 'list' && !showingFavoritesOnly) {
        viewBeforeSearch = currentView;
        switchView('list');
    } else {
        renderApp();
    }
}
