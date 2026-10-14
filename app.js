'use strict';

/* ==========================================================================
   Tabela de Temporalidade e Destinação de Documentos
   ========================================================================== */

// Textos exibidos nos registros. Ajuste aqui se precisar renomear algum campo.
const LABELS = {
    vigencia: 'Prazo de vigência',   // campo: documento.prazo_vigencia
    arquivo: 'Prazo no arquivo',     // campo: documento.unidade_atribuicao_arquivistica
    permanente: 'Guarda permanente',
    eliminacao: 'Eliminação',
    obs: 'Observações'
};

// Ordenação dos resultados da busca.
// Palavras-chave de maior interesse: um documento que contém alguma delas (no início de uma palavra,
// então plurais também contam) sobe na lista. Acentos e maiúsculas são ignorados.
const PRIORITY_KEYWORDS = ['Dossiê', 'Processo', 'Contrato', 'Projeto', 'Relatório', 'Ofício', 'Memorando'];

// Faixas de peso, da mais para a menos relevante. O peso maior aparece primeiro.
const PRIORITY_GROUPS = [
    { key: 'both',  weight: 3, label: 'Palavra-chave no título e na observação' },
    { key: 'title', weight: 2, label: 'Palavra-chave no título' },
    { key: 'obs',   weight: 1, label: 'Palavra-chave na observação' },
    { key: 'none',  weight: 0, label: 'Demais resultados' }
];

// Mesmo valor do breakpoint em style.css (900px)
const MOBILE_QUERY = window.matchMedia('(max-width: 899px)');

let treeData = null;
let activeSelectionPath = [];
let currentView = 'cascade';
let searchTerms = [];          // termos da busca (normalizados); vazio = sem busca
let searchResults = [];        // documentos que contêm todos os termos
let viewBeforeSearch = null;   // visão em que o usuário estava antes da busca

const allDocs = [];            // todos os documentos, na ordem da árvore (usado na busca)
const folderState = new Map(); // modo lista: id da pasta -> aberta (true) ou fechada (false)

const $ = (id) => document.getElementById(id);

/* ---------- Utilidades ---------- */

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function normalize(text) {
    return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const PRIORITY_RE = new RegExp(
    '\\b(?:' + PRIORITY_KEYWORDS.map((k) => normalize(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
);

function weightOf(key) {
    return PRIORITY_GROUPS.find((g) => g.key === key).weight;
}

// Peso do documento: palavra-chave no título e na observação > só no título > só na observação > nenhuma.
function priorityWeight(node) {
    const inTitle = PRIORITY_RE.test(normalize(node.descricao));
    const inObs = PRIORITY_RE.test(normalize(node.documento.obs));
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

// Dá um id a cada nó, guarda o pai e prepara o texto de busca.
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

/* ---------- Carga dos dados ---------- */

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    $('cascadeWrapper').innerHTML = '<div class="notice notice--info"><p>Carregando tabela…</p></div>';

    fetch('arvore_temporalidade.json')
        .then((response) => {
            if (!response.ok) throw new Error('Erro ao carregar o arquivo JSON.');
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
                    <p><strong>Não foi possível carregar a tabela.</strong></p>
                    <p>Verifique se o arquivo <em>arvore_temporalidade.json</em> está na mesma pasta do site e abra a página por um servidor (por exemplo, <em>python -m http.server</em>), não direto pelo arquivo.</p>
                </div>`;
        });
});

/* ---------- Eventos ---------- */

function bindEvents() {
    $('btnViewCascade').addEventListener('click', () => switchView('cascade'));
    $('btnViewList').addEventListener('click', () => switchView('list'));

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

    $('cascadeWrapper').addEventListener('click', (e) => {
        const block = e.target.closest('[data-idx]');
        if (!block) return;
        const depth = Number(block.dataset.depth);
        const child = activeSelectionPath[depth].filhos[Number(block.dataset.idx)];
        const wasOpen = activeSelectionPath[depth + 1] === child;

        activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
        if (!wasOpen && hasKids(child)) activeSelectionPath.push(child);   // clicar de novo fecha o ramo
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

/* ---------- Navegação ---------- */

function switchView(view) {
    currentView = view;
    const isCascade = view === 'cascade';

    $('btnViewCascade').classList.toggle('is-active', isCascade);
    $('btnViewCascade').setAttribute('aria-pressed', String(isCascade));
    $('btnViewList').classList.toggle('is-active', !isCascade);
    $('btnViewList').setAttribute('aria-pressed', String(!isCascade));

    $('cascadeWrapper').hidden = !isCascade;
    $('listViewWrapper').hidden = isCascade;

    renderApp();
}

function renderApp() {
    renderBreadcrumb();
    if (currentView === 'cascade') renderCascade();
    else renderListView();
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

/* ---------- Registro de documento (usado nas duas visões) ---------- */

// Escapa o texto e marca os termos buscados (ignorando acentos e maiúsculas).
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
    const classes = `doc${perm ? '' : ' doc--elim'}`;

    return `
        <article class="${classes}">
            <div class="doc__top">
                <span class="doc__cod">${highlight(node.cod, terms)}</span>
                <span class="badge ${perm ? 'badge--perm' : 'badge--elim'}">${perm ? LABELS.permanente : LABELS.eliminacao}</span>
            </div>
            <h3 class="doc__title">${highlight(node.descricao, terms)}</h3>
            <dl class="doc__fields">
                <div><dt>${LABELS.vigencia}</dt><dd>${esc(formatPrazo(d.prazo_vigencia))}</dd></div>
                <div><dt>${LABELS.arquivo}</dt><dd>${esc(formatPrazo(d.unidade_atribuicao_arquivistica))}</dd></div>
            </dl>
            ${d.obs ? `<p class="doc__obs"><strong>${LABELS.obs}:</strong> ${highlight(d.obs, terms)}</p>` : ''}
        </article>`;
}

/* ---------- Visão em cascata (árvore de ramos) ---------- */

function blockHtml(child, index, depth, selected) {
    const navigable = hasKids(child);
    const tag = navigable ? 'button' : 'div';
    const attrs = navigable ? ` type="button" data-depth="${depth}" data-idx="${index}" aria-expanded="${selected}"` : '';
    const cod = hasNumericCode(child.cod) ? `<span class="nodeblk__cod">${esc(child.cod)}</span>` : '';
    const count = navigable
        ? `<span class="nodeblk__n" title="${plural(child.filhos.length, 'item', 'itens')}">${child.filhos.length}</span>` : '';

    return `<${tag} class="nodeblk${selected ? ' is-selected' : ''}"${attrs}>` +
           `<span class="nodeblk__main">${cod}<span class="nodeblk__desc">${esc(child.descricao)}</span></span>${count}</${tag}>`;
}

// Filhos de "parent" como um grupo de blocos; o filho aberto traz o próprio ramo dentro dele.
function groupHtml(parent, depth) {
    const kids = parent.filhos || [];
    const next = activeSelectionPath[depth + 1];
    const classes = `tg ${depth === 0 ? 'tg--root' : 'tg--child'}${kids.some(hasDoc) ? ' tg--docs' : ''}`;

    const items = kids.map((child, i) => {
        if (hasDoc(child)) return `<li class="tn tn--doc">${docHtml(child)}</li>`;
        const open = child === next;
        return `<li class="tn${open ? ' is-open' : ''}">${blockHtml(child, i, depth, open)}${open ? groupHtml(child, depth + 1) : ''}</li>`;
    });

    return `<ul class="${classes}">${items.join('')}</ul>`;
}

function renderCascade() {
    const wrap = $('cascadeWrapper');
    wrap.innerHTML = groupHtml(activeSelectionPath[0], 0);

    if (MOBILE_QUERY.matches) return;

    // garante que o ramo mais fundo apareça por inteiro na horizontal
    const box = wrap.getBoundingClientRect();
    const groups = wrap.querySelectorAll('.tg--child');
    const deepest = groups[groups.length - 1];
    if (deepest) {
        const right = deepest.getBoundingClientRect().right - box.left + wrap.scrollLeft + 24;
        if (right > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = right - wrap.clientWidth;
    }
}

/* ---------- Visão em lista ---------- */

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

    return `
        <section class="folder folder--l${Math.min(level, 3)}">
            <button type="button" class="folder__head" data-toggle="${node._id}" aria-expanded="${open}">
                <span class="folder__main">${cod}<span class="folder__name">${esc(node.descricao)}</span></span>
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

/* ---------- Busca: resultados aparecem na visão em lista ---------- */

function resultHtml(doc) {
    const folders = pathTo(doc).slice(1, -1).map((n) => esc(nodeLabel(n))).join(' › ');
    return `
        <div class="result">
            <p class="result__path">${folders}</p>
            ${docHtml(doc, searchTerms)}
        </div>`;
}

// Resultados em faixas de peso. Sem nenhuma palavra-chave entre os resultados, a lista segue plana.
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
        : `<div class="notice notice--info">
               <p>Nenhum documento encontrado para <strong>“${esc(typed)}”</strong>.</p>
               <p>Tente outro termo ou apenas parte do código.</p>
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
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    searchTerms = terms;

    if (!terms.length) {
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

    searchResults = allDocs.filter((doc) => terms.every((t) => doc._search.includes(t)));
    searchResults.sort((a, b) => b._weight - a._weight);
    status.textContent = searchResults.length
        ? plural(searchResults.length, 'resultado', 'resultados') + '.'
        : 'Nenhum documento encontrado.';

    if (currentView !== 'list') {
        viewBeforeSearch = currentView;
        switchView('list');
    } else {
        renderApp();
    }
                                         }
