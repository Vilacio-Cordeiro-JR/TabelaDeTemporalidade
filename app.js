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

// Mesmo valor do breakpoint em style.css (900px)
const MOBILE_QUERY = window.matchMedia('(max-width: 899px)');

let treeData = null;
let activeSelectionPath = [];
let currentView = 'cascade';
let hitNode = null;            // documento encontrado pela busca (destacado)
let pendingCenter = false;     // centraliza o resultado da busca na próxima renderização
let lastRenderedDepth = -1;

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
        const close = e.target.closest('[data-close]');
        if (close) return closeColumn(Number(close.dataset.close));

        const item = e.target.closest('[data-idx]');
        if (!item) return;
        const depth = Number(item.dataset.depth);
        const child = activeSelectionPath[depth].filhos[Number(item.dataset.idx)];
        activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
        if (hasKids(child)) activeSelectionPath.push(child);
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
    pendingCenter = false;
}

function jumpToDepth(depth) {
    activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
    renderApp();
}

function closeColumn(depth) {
    activeSelectionPath = activeSelectionPath.slice(0, depth);
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

function docHtml(node) {
    const d = node.documento;
    const perm = !d.eliminacao;
    const classes = `doc${perm ? '' : ' doc--elim'}${node === hitNode ? ' is-hit' : ''}`;

    return `
        <article class="${classes}">
            <div class="doc__top">
                <span class="doc__cod">${esc(node.cod)}</span>
                <span class="badge ${perm ? 'badge--perm' : 'badge--elim'}">${perm ? LABELS.permanente : LABELS.eliminacao}</span>
            </div>
            <h3 class="doc__title">${esc(node.descricao)}</h3>
            <dl class="doc__fields">
                <div><dt>${LABELS.vigencia}</dt><dd>${esc(formatPrazo(d.prazo_vigencia))}</dd></div>
                <div><dt>${LABELS.arquivo}</dt><dd>${esc(formatPrazo(d.unidade_atribuicao_arquivistica))}</dd></div>
            </dl>
            ${d.obs ? `<p class="doc__obs"><strong>${LABELS.obs}:</strong> ${esc(d.obs)}</p>` : ''}
        </article>`;
}

/* ---------- Visão em cascata ---------- */

function itemHtml(child, index, depth, selected) {
    const navigable = hasKids(child);
    const tag = navigable ? 'button' : 'div';
    const attrs = navigable ? ` type="button" data-depth="${depth}" data-idx="${index}"` : '';
    const cod = depth > 0 && hasNumericCode(child.cod)
        ? `<span class="item__cod">${esc(child.cod)}</span>` : '';

    return `
        <${tag} class="item${selected ? ' is-selected' : ''}"${attrs}${selected ? ' aria-current="true"' : ''}>
            <span class="item__main">${cod}<span class="item__desc">${esc(child.descricao)}</span></span>
            ${navigable ? '<span class="item__chev" aria-hidden="true">›</span>' : ''}
        </${tag}>`;
}

function columnHtml(parent, depth, mobile) {
    const children = parent.filhos || [];
    const isDocLevel = children.some(hasDoc);
    const next = activeSelectionPath[depth + 1];
    const title = depth === 0 ? 'Áreas' : parent.descricao;

    let back = '';
    let close = '';
    if (depth > 0) {
        if (mobile) back = `<button type="button" class="col__back" data-close="${depth}">‹ Voltar</button>`;
        else close = `<button type="button" class="col__close" data-close="${depth}" aria-label="Fechar esta coluna" title="Fechar">&times;</button>`;
    }

    const body = children.map((child, i) => (
        hasDoc(child) ? docHtml(child) : itemHtml(child, i, depth, child === next)
    )).join('');

    return `
        <section class="col${isDocLevel ? ' col--docs' : ''}" data-key="${parent._id}">
            <div class="col__head">
                ${back}
                <h2 class="col__title">${esc(title)}</h2>
                <span class="col__count">${plural(children.length, 'item', 'itens')}</span>
                ${close}
            </div>
            <div class="col__body${isDocLevel ? ' col__body--docs' : ''}">${body}</div>
        </section>`;
}

function centerIn(container, el) {
    container.scrollTop = el.offsetTop - (container.clientHeight - el.offsetHeight) / 2;
}

function renderCascade() {
    const wrap = $('cascadeWrapper');
    const mobile = MOBILE_QUERY.matches;
    const lastDepth = activeSelectionPath.length - 1;

    // Guarda a rolagem de cada coluna para não "pular" ao clicar
    const savedScroll = new Map();
    wrap.querySelectorAll('.col').forEach((col) => {
        savedScroll.set(col.dataset.key, col.querySelector('.col__body').scrollTop);
    });

    let html = '';
    activeSelectionPath.forEach((parent, depth) => {
        if (mobile && depth !== lastDepth) return;   // celular: só a coluna atual
        if (!hasKids(parent) && depth > 0) return;
        html += columnHtml(parent, depth, mobile);
    });
    wrap.innerHTML = html;

    if (mobile) {
        const hit = wrap.querySelector('.is-hit');
        if (pendingCenter && hit) {
            hit.scrollIntoView({ block: 'center' });
        } else if (lastRenderedDepth !== lastDepth) {
            const top = wrap.getBoundingClientRect().top + window.scrollY - 8;
            if (window.scrollY > top) window.scrollTo(0, Math.max(top, 0));
        }
    } else {
        wrap.querySelectorAll('.col').forEach((col) => {
            const body = col.querySelector('.col__body');
            const target = body.querySelector('.is-hit') || body.querySelector('.is-selected');
            if (pendingCenter && target) centerIn(body, target);
            else body.scrollTop = savedScroll.get(col.dataset.key) || 0;
        });
        wrap.scrollLeft = wrap.scrollWidth;
    }

    lastRenderedDepth = lastDepth;
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

    if (pendingCenter) {
        const hit = container.querySelector('.is-hit');
        if (hit) hit.scrollIntoView({ block: 'center' });
    }
}

/* ---------- Busca ---------- */

function handleSearch(query) {
    if (!treeData) return;
    const status = $('searchStatus');
    const q = normalize(query.trim());

    if (!q) {
        status.textContent = '';
        if (hitNode) { hitNode = null; renderApp(); }
        return;
    }

    const results = allDocs.filter((doc) => doc._search.includes(q));
    if (!results.length) {
        status.textContent = 'Nenhum documento encontrado.';
        return;
    }

    const first = results[0];
    const path = pathTo(first);
    status.textContent = results.length === 1
        ? '1 resultado.'
        : `${results.length.toLocaleString('pt-BR')} resultados. Exibindo o primeiro.`;

    hitNode = first;
    activeSelectionPath = path.slice(0, -1);               // termina na pasta que contém o documento
    path.slice(1, -1).forEach((n) => folderState.set(n._id, true)); // abre as pastas no modo lista
    pendingCenter = true;
    renderApp();
}