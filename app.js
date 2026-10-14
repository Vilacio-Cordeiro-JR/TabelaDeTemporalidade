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

    const hit = wrap.querySelector('.is-hit');

    if (MOBILE_QUERY.matches) {
        if (pendingCenter && hit) hit.scrollIntoView({ block: 'center' });
        return;
    }

    const box = wrap.getBoundingClientRect();

    // resultado da busca: centraliza na vertical
    if (pendingCenter && hit) {
        const h = hit.getBoundingClientRect();
        wrap.scrollTop += (h.top - box.top) - (wrap.clientHeight - h.height) / 2;
    }

    // garante que o ramo mais fundo apareça por inteiro na horizontal
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