let treeData = null;
let activeSelectionPath = [];
let currentView = 'cascade';
let collapsedFolders = new Set();

document.addEventListener("DOMContentLoaded", () => {
    fetch('arvore_temporalidade.json')
        .then(response => {
            if (!response.ok) throw new Error("Erro ao carregar o arquivo JSON.");
            return response.json();
        })
        .then(data => {
            treeData = data;
            activeSelectionPath = [treeData];
            switchView('cascade');
        })
        .catch(error => {
            console.error(error);
            document.getElementById('cascadeWrapper').innerHTML = `
                <div class="bg-red-50 border border-red-200 p-6 rounded-xl text-center text-red-700 text-sm mx-auto my-12">
                    Nao foi possivel carregar o arquivo <strong>arvore_temporalidade.json</strong>.
                </div>
            `;
        });
});

function switchView(view) {
    currentView = view;
    const btnCascade = document.getElementById('btnViewCascade');
    const btnList = document.getElementById('btnViewList');
    
    const cascadeWrapper = document.getElementById('cascadeWrapper');
    const listViewWrapper = document.getElementById('listViewWrapper');

    btnCascade.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition text-slate-300 hover:text-white";
    btnList.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition text-slate-300 hover:text-white";

    cascadeWrapper.classList.add('hidden');
    listViewWrapper.classList.add('hidden');

    if (view === 'cascade') {
        btnCascade.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition bg-emerald-600 text-white shadow-sm";
        cascadeWrapper.classList.remove('hidden');
    } else if (view === 'list') {
        btnList.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition bg-emerald-600 text-white shadow-sm";
        listViewWrapper.classList.remove('hidden');
    }
    renderApp();
}

function renderApp() {
    renderBreadcrumb();
    if (currentView === 'cascade') renderCascade();
    else if (currentView === 'list') renderListView();
}

function renderBreadcrumb() {
    const bar = document.getElementById('breadcrumbBar');
    bar.innerHTML = '';
    let html = `<span class="font-semibold text-slate-400">Trilha:</span>`;
    activeSelectionPath.forEach((node, index) => {
        const isLast = index === activeSelectionPath.length - 1;
        const name = index === 0 ? "Inicio" : `${node.cod} - ${node.descricao}`;
        if (isLast) html += `<span class="text-emerald-400 font-bold px-1">${name}</span>`;
        else html += `<button onclick="jumpToDepth(${index})" class="text-slate-300 hover:text-white hover:underline px-1">${name}</button> <span class="text-slate-500">/</span> `;
    });
    bar.innerHTML = html;
}

function jumpToDepth(depth) {
    activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
    renderApp();
}

// 1. MODO CASCATA (Consolidado)
function renderCascade() {
    const wrapper = document.getElementById('cascadeWrapper');
    wrapper.innerHTML = '';
    const lastNode = activeSelectionPath[activeSelectionPath.length - 1];
    const isTerminalDocLevel = lastNode && lastNode.filhos && lastNode.filhos.length > 0 && lastNode.filhos.every(c => c.documento !== null && c.documento !== undefined);

    const isMobile = window.innerWidth <= 768;
    if (isTerminalDocLevel && !isMobile) {
        const ghostSpacer = document.createElement('div');
        ghostSpacer.className = "flex-shrink-0";
        let previousColumnsWidth = (activeSelectionPath.length - 1) * 344;
        ghostSpacer.style.width = `calc(50vw - 360px - ${previousColumnsWidth / 2}px)`;
        wrapper.appendChild(ghostSpacer);
    }

    activeSelectionPath.forEach((parentNode, depth) => {
        const children = parentNode.filhos || [];
        if (children.length === 0 && depth > 0) return;
        const isDocLevel = children.some(c => c.documento !== null && c.documento !== undefined);
        const column = document.createElement('div');
        
        if (isDocLevel) {
            column.className = "flex-shrink-0 w-[720px] bg-white rounded-2xl shadow-2xl border-2 border-emerald-500 flex flex-col transition-all relative my-auto";
        } else {
            column.className = "flex-shrink-0 w-80 bg-white rounded-2xl shadow-md border border-slate-200 flex flex-col transition-all relative";
            if (!isMobile) column.style.marginTop = `${depth * 40}px`;
        }

        const headerTitle = depth === 0 ? "Selecione a Area" : `Nivel ${depth} (${parentNode.cod})`;
        let closeButtonHtml = depth > 0 ? `<button onclick="closeColumn(${depth})" class="text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded transition hover:bg-slate-700">&times;</button>` : '';

        column.innerHTML = `
            <div class="${isDocLevel ? 'bg-emerald-700' : 'bg-slate-800'} text-white px-4 py-3 flex justify-between items-center rounded-t-2xl">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold uppercase tracking-wider">${headerTitle}</span>
                    <span class="text-[10px] bg-black/20 text-white px-2 py-0.5 rounded-full">${children.length} itens</span>
                </div>
                ${closeButtonHtml}
            </div>
            <div class="p-4 space-y-4">
        `;

        const listContainer = column.querySelector('.space-y-4');
        children.forEach(child => {
            const isDoc = child.documento !== null && child.documento !== undefined;
            const isSelected = activeSelectionPath[depth + 1] && activeSelectionPath[depth + 1].cod === child.cod;
            const card = document.createElement('div');
            
            if (isDoc) {
                const docInfo = child.documento;
                const isPerm = !docInfo.eliminacao;
                const cardBgClass = isPerm ? "bg-blue-50/70 border-blue-200" : "bg-red-50/70 border-red-200";
                const badgeDestClass = isPerm ? "bg-blue-600 text-white" : "bg-red-600 text-white";
                card.className = `p-4 rounded-xl border ${cardBgClass} shadow-sm space-y-3 text-xs`;
                card.innerHTML = `
                    <div class="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span class="font-mono text-xs px-2.5 py-0.5 rounded font-bold bg-slate-800 text-white">${child.cod}</span>
                        <span class="text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-200 text-slate-700">Documento</span>
                    </div>
                    <h4 class="font-extrabold text-slate-900 text-sm md:text-base">${child.descricao}</h4>
                    <div class="grid grid-cols-12 gap-3 items-center pt-2 border-t border-slate-200">
                        <div class="col-span-4 flex flex-col justify-center px-1">
                            <span class="text-slate-500 uppercase font-bold text-[9px]">Produtora</span>
                            <span class="font-bold text-slate-900 text-sm">${docInfo.prazo_vigencia || 'N/A'}</span>
                        </div>
                        <div class="col-span-4 flex flex-col justify-center px-2 border-l border-slate-200">
                            <span class="text-slate-500 uppercase font-bold text-[9px]">Arquivo</span>
                            <span class="font-bold text-slate-900 text-sm">${docInfo.unidade_atribuicao_arquivistica || 'N/A'}</span>
                        </div>
                        <div class="col-span-4 flex flex-col justify-end items-end px-1 border-l border-slate-200">
                            <span class="text-slate-500 uppercase font-bold text-[9px] mb-1">Destinacao</span>
                            <span class="px-2.5 py-1 rounded-lg font-extrabold text-xs uppercase tracking-wider ${badgeDestClass}">${isPerm ? 'permanente' : 'eliminacao'}</span>
                        </div>
                    </div>
                `;
            } else {
                card.className = `p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${isSelected ? 'bg-slate-200 border-slate-500 font-semibold' : 'bg-slate-50 border-slate-200 hover:border-emerald-400 hover:bg-white'}`;
                card.innerHTML = `
                    <div class="flex items-center justify-between mb-1">
                        <span class="font-mono text-xs px-2 py-0.5 rounded font-bold ${isSelected ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'}">${child.cod}</span>
                        <span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-slate-200 text-slate-600">Pasta</span>
                    </div>
                    <h4 class="font-semibold text-slate-800 text-xs">${child.descricao}</h4>
                `;
                card.onclick = () => {
                    activeSelectionPath = activeSelectionPath.slice(0, depth + 1);
                    if (child.filhos && child.filhos.length > 0) activeSelectionPath.push(child);
                    renderApp();
                };
            }
            listContainer.appendChild(card);
        });
        wrapper.appendChild(column);
    });

    if (!isMobile) {
        setTimeout(() => {
            const lastChild = wrapper.lastElementChild;
            if (lastChild) lastChild.scrollIntoView({ behavior: 'smooth', inline: isTerminalDocLevel ? 'center' : 'end', block: 'nearest' });
        }, 80);
    }
}

// 2. MODO LISTA (Consolidado)
function renderListView() {
    const container = document.getElementById('listViewWrapper');
    container.innerHTML = '';
    const currentNode = activeSelectionPath[activeSelectionPath.length - 1];

    const headerBox = document.createElement('div');
    headerBox.className = "bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4";
    headerBox.innerHTML = `
        <div>
            <span class="text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md">Modo Lista - Filtro Suave</span>
            <h2 class="text-lg font-extrabold text-slate-900 mt-2">${currentNode.descricao}</h2>
            <p class="text-xs text-slate-500 mt-0.5">Clique em "Recolher / Expandir" nas pastas abaixo para filtrar a visualizacao.</p>
        </div>
        <div class="flex gap-2">
            <button id="btnExpandAll" class="px-3 py-1.5 text-xs font-bold bg-slate-200 hover:bg-slate-300 rounded-lg text-slate-700">Expandir Tudo</button>
            <button id="btnCollapseAll" class="px-3 py-1.5 text-xs font-bold bg-slate-200 hover:bg-slate-300 rounded-lg text-slate-700">Recolher Tudo</button>
        </div>
    `;
    container.appendChild(headerBox);

    document.getElementById('btnExpandAll').onclick = () => expandAllFolders();
    document.getElementById('btnCollapseAll').onclick = () => collapseAllFolders(currentNode);

    const treeContainer = document.createElement('div');
    treeContainer.className = "space-y-3";
    container.appendChild(treeContainer);

    function buildAccordionNode(node, level = 0) {
        const wrapperDiv = document.createElement('div');
        wrapperDiv.className = "space-y-2";
        const hasChildren = node.filhos && node.filhos.length > 0;
        const isCollapsed = collapsedFolders.has(node.cod);

        if (node.documento) {
            const docInfo = node.documento;
            const isPerm = !docInfo.eliminacao;
            const cardBgClass = isPerm ? "bg-blue-50/70 border-blue-200" : "bg-red-50/70 border-red-200";
            const badgeDestClass = isPerm ? "bg-blue-600 text-white" : "bg-red-600 text-white";

            const card = document.createElement('div');
            card.className = `p-4 rounded-xl border ${cardBgClass} shadow-sm space-y-3 text-xs ml-${Math.min(level * 4, 12)}`;
            card.innerHTML = `
                <div class="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span class="font-mono text-xs px-2.5 py-0.5 rounded font-bold bg-slate-800 text-white">${node.cod}</span>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-200 text-slate-700">Documento</span>
                </div>
                <h4 class="font-extrabold text-slate-900 text-sm">${node.descricao}</h4>
                <div class="grid grid-cols-12 gap-3 items-center pt-2 border-t border-slate-200">
                    <div class="col-span-4 flex flex-col justify-center px-1">
                        <span class="text-slate-500 uppercase font-bold text-[9px]">Produtora</span>
                        <span class="font-bold text-slate-900 text-sm">${docInfo.prazo_vigencia || 'N/A'}</span>
                    </div>
                    <div class="col-span-4 flex flex-col justify-center px-2 border-l border-slate-200">
                        <span class="text-slate-500 uppercase font-bold text-[9px]">Arquivo</span>
                        <span class="font-bold text-slate-900 text-sm">${docInfo.unidade_atribuicao_arquivistica || 'N/A'}</span>
                    </div>
                    <div class="col-span-4 flex flex-col justify-end items-end px-1 border-l border-slate-200">
                        <span class="text-slate-500 uppercase font-bold text-[9px] mb-1">Destinacao</span>
                        <span class="px-2.5 py-1 rounded-lg font-extrabold text-xs uppercase tracking-wider ${badgeDestClass}">${isPerm ? 'permanente' : 'eliminacao'}</span>
                    </div>
                </div>
            `;
            wrapperDiv.appendChild(card);
        } else if (hasChildren && level > 0) {
            const folderHeader = document.createElement('div');
            folderHeader.className = "bg-slate-800 text-white p-3 rounded-xl flex justify-between items-center cursor-pointer shadow-sm hover:bg-slate-700";
            folderHeader.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="font-mono text-xs px-2 py-0.5 rounded font-bold bg-slate-700 text-slate-200">${node.cod}</span>
                    <h3 class="font-bold text-xs uppercase tracking-wider">${node.descricao}</h3>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">${node.filhos.length} itens</span>
                    <span class="text-xs font-bold px-2 py-0.5 rounded bg-slate-700 text-slate-300">${isCollapsed ? '+' : '-'}</span>
                </div>
            `;
            folderHeader.onclick = () => {
                if (collapsedFolders.has(node.cod)) collapsedFolders.delete(node.cod);
                else collapsedFolders.add(node.cod);
                renderListView();
            };
            wrapperDiv.appendChild(folderHeader);

            if (!isCollapsed) {
                const childrenWrapper = document.createElement('div');
                childrenWrapper.className = "pl-4 space-y-2 border-l-2 border-slate-300 ml-2 pt-2";
                node.filhos.forEach(child => childrenWrapper.appendChild(buildAccordionNode(child, level + 1)));
                wrapperDiv.appendChild(childrenWrapper);
            }
        } else if (hasChildren && level === 0) {
            node.filhos.forEach(child => wrapperDiv.appendChild(buildAccordionNode(child, level + 1)));
        }
        return wrapperDiv;
    }

    if (currentNode.filhos) currentNode.filhos.forEach(child => treeContainer.appendChild(buildAccordionNode(child, 1)));
}

function expandAllFolders() { collapsedFolders.clear(); renderListView(); }
function collapseAllFolders(node) {
    function addAll(n) { if (n.cod) collapsedFolders.add(n.cod); if (n.filhos) n.filhos.forEach(addAll); }
    addAll(node); renderListView();
}

function closeColumn(depth) {
    activeSelectionPath = activeSelectionPath.slice(0, depth);
    renderApp();
}

function handleSearch(query) {
    if (!query.trim() || !treeData) return;
    let q = query.toLowerCase();
    function findPath(node, targetQuery, currentPath = []) {
        const fullPath = [...currentPath, node];
        let matchText = (node.cod + ' ' + node.descricao + ' ' + (node.documento?.obs || '')).toLowerCase();
        if (matchText.includes(targetQuery) && node.documento) return fullPath;
        if (node.filhos) {
            for (let child of node.filhos) {
                let found = findPath(child, targetQuery, fullPath);
                if (found) return found;
            }
        }
        return null;
    }
    let matchedPath = findPath(treeData, q);
    if (matchedPath) {
        activeSelectionPath = matchedPath;
        renderApp();
    }
}