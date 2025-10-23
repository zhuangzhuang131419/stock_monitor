// --- 全局常量与变量 ---
const WORKFLOW_FILE_NAME = 'main.yml';
const CONFIG_FILE_PATH = 'config.ini';
let fileSha = null;
let token = '';
let originalIniLines = [];
let pendingTabSwitch = null; // 用于记录用户想要切换到的 Tab

// --- DOM 元素获取 ---
const tabButtons = {
    summary: document.getElementById('tab-summary'),
    positions: document.getElementById('tab-positions'),
    settings: document.getElementById('tab-settings'),
};
const panels = {
    summary: document.getElementById('summary-panel'),
    positions: document.getElementById('positions-panel'),
    settings: document.getElementById('settings-panel'),
};
const editors = {
    positions: document.getElementById('positions-editor'),
    settings: document.getElementById('settings-editor'),
};
const statusMessages = {
    positions: document.getElementById('status-msg-positions'),
    settings: document.getElementById('status-msg-settings'),
    modal: document.getElementById('modal-status-msg'),
};
const modal = {
    backdrop: document.getElementById('modal-backdrop'),
    container: document.getElementById('token-modal'),
    input: document.getElementById('modal-token-input'),
    confirmBtn: document.getElementById('modal-confirm-btn'),
    cancelBtn: document.getElementById('modal-cancel-btn'),
};

// --- 初始化与事件监听 ---
document.addEventListener('DOMContentLoaded', () => {
    loadInitialSummary();
    setupEventListeners();
});

function setupEventListeners() {
    // Tab 切换
    tabButtons.summary.addEventListener('click', () => switchTab('summary'));
    tabButtons.positions.addEventListener('click', () => requestTabSwitch('positions'));
    tabButtons.settings.addEventListener('click', () => requestTabSwitch('settings'));

    // 弹窗按钮
    modal.confirmBtn.addEventListener('click', handleTokenConfirm);
    modal.cancelBtn.addEventListener('click', hideTokenModal);

    // 操作按钮
    document.getElementById('run-workflow-btn-summary').addEventListener('click', requestRunWorkflow);
    document.getElementById('save-btn-positions').addEventListener('click', savePortfolio);
    document.getElementById('save-btn-settings').addEventListener('click', savePortfolio);
}

// --- Tab 与弹窗管理 ---
function switchTab(tabKey) {
    Object.values(tabButtons).forEach(btn => btn.classList.remove('active'));
    Object.values(panels).forEach(panel => panel.classList.remove('active'));
    tabButtons[tabKey].classList.add('active');
    panels[tabKey].classList.add('active');
}

function requestTabSwitch(tabKey) {
    if (token) {
        switchTab(tabKey);
    } else {
        pendingTabSwitch = tabKey;
        showTokenModal();
    }
}

function showTokenModal(message = '', isError = false) {
    updateStatus(message, isError, 'modal');
    modal.backdrop.classList.remove('hidden');
    modal.container.classList.remove('hidden');
    modal.input.focus();
}

function hideTokenModal() {
    modal.backdrop.classList.add('hidden');
    modal.container.classList.add('hidden');
    modal.input.value = '';
    pendingTabSwitch = null;
}

// --- 核心逻辑：授权、加载、保存、运行 ---
const { owner, repo } = getRepoInfoFromURL();

async function handleTokenConfirm() {
    const inputToken = modal.input.value.trim();
    if (!inputToken) {
        showTokenModal('Token 不能为空。', true);
        return;
    }
    updateStatus('正在验证 Token 并加载数据...', false, 'modal');

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            headers: { 'Authorization': `token ${inputToken}` }
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('Token 无效或权限不足。');
            if (response.status === 404) throw new Error('在仓库中未找到 config.ini 文件。');
            throw new Error(`GitHub API 错误: ${response.statusText}`);
        }

        token = inputToken; // 验证成功，保存 Token
        const data = await response.json();
        fileSha = data.sha;
        const content = decodeURIComponent(escape(atob(data.content)));
        originalIniLines = content.split('\n');

        displayPortfolio(originalIniLines);

        hideTokenModal();
        if (pendingTabSwitch) {
            switchTab(pendingTabSwitch);
        }
    } catch (error) {
        console.error(error);
        showTokenModal(`验证失败: ${error.message}`, true);
    }
}

async function savePortfolio() {
    if (!token || !fileSha) {
        alert('错误: 授权信息丢失，请刷新页面重试。');
        return;
    }

    const activePanelKey = panels.positions.classList.contains('active') ? 'positions' : 'settings';
    updateStatus('正在验证并保存...', false, activePanelKey);

    // ... (验证逻辑基本不变)
    let isValid = true;
    const errorMessages = [];
    document.querySelectorAll('input.invalid, select.invalid').forEach(el => el.classList.remove('invalid'));
    const sections = document.querySelectorAll(`#${activePanelKey}-panel .portfolio-section`);
    // ... (后续验证逻辑与之前版本相同)

    const newContent = buildIniStringFromUI();
    const newContentBase64 = btoa(unescape(encodeURIComponent(newContent)));

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ message: `Update ${CONFIG_FILE_PATH} via web editor`, content: newContentBase64, sha: fileSha })
        });
        if (!response.ok) throw new Error(`GitHub API 错误: ${response.statusText}`);
        const data = await response.json();
        fileSha = data.content.sha;
        originalIniLines = newContent.split('\n');
        updateStatus('保存成功！', false, activePanelKey);
    } catch (error) {
        console.error(error);
        updateStatus(`保存失败: ${error.message}`, true, activePanelKey);
    }
}

async function requestRunWorkflow() {
    if (!token) {
        showTokenModal('需要授权才能启动云端分析。');
        pendingTabSwitch = 'summary'; // 留在当前页
        return;
    }
    runWorkflow();
}

async function runWorkflow() {
    alert('即将触发云端分析，请在 GitHub Actions 页面查看进度。');
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ ref: 'main' })
        });
        if (response.status !== 204) throw new Error(`GitHub API 错误: ${response.statusText}`);
    } catch (error) {
        console.error(error);
        alert(`触发失败: ${error.message}`);
    }
}

// --- UI 渲染与数据处理 ---
function displayPortfolio(lines) {
    editors.positions.innerHTML = '';
    editors.settings.innerHTML = '';
    let currentSection = null;

    lines.forEach((line, index) => {
        const processedLine = line.split('#')[0].trim();
        if (processedLine.startsWith('[') && processedLine.endsWith(']')) {
            currentSection = processedLine.substring(1, processedLine.length - 1);
            if (currentSection === 'Proxy') return;

            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'portfolio-section';
            sectionDiv.innerHTML = `<h3>${currentSection}</h3>`;

            let targetEditor = editors.settings;
            if (['Portfolio', 'OptionsPortfolio'].includes(currentSection)) {
                targetEditor = editors.positions;
                const addBtn = document.createElement('button');
                addBtn.textContent = '＋ 新增一行';
                addBtn.className = 'add-btn';
                addBtn.onclick = function() { addNewRow(this.parentElement); };
                sectionDiv.appendChild(addBtn);
            }
            targetEditor.appendChild(sectionDiv);
        } else if (currentSection && processedLine.includes('=')) {
            const parentEditor = ['Portfolio', 'OptionsPortfolio'].includes(currentSection) ? editors.positions : editors.settings;
            const sectionDiv = Array.from(parentEditor.querySelectorAll('.portfolio-section h3')).find(h3 => h3.textContent === currentSection)?.parentElement;
            if (!sectionDiv) return;

            // --- 此处开始的渲染逻辑与之前版本完全相同 ---
            const [key, value] = processedLine.split('=').map(s => s.trim());
            if (!key || typeof value === 'undefined') return;
            let itemDiv;
            if (key === 'data_source') {
                const commentLine = (index > 0) ? lines[index - 1].trim() : '';
                const options = commentLine.match(/\d+\s*:\s*.*?(?=\s+\d+:|$)/g);
                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item-static';
                const label = document.createElement('label');
                label.textContent = key;
                if (options) {
                    const select = document.createElement('select');
                    select.className = 'data-source-select';
                    options.forEach(opt => {
                        const firstColonIndex = opt.indexOf(':');
                        const num = opt.substring(0, firstColonIndex).trim();
                        const desc = opt.substring(firstColonIndex + 1).trim();
                        const optionEl = document.createElement('option');
                        optionEl.value = num;
                        optionEl.textContent = desc;
                        if (num === value) optionEl.selected = true;
                        select.appendChild(optionEl);
                    });
                    itemDiv.append(label, select);
                } else {
                    const input = document.createElement('input');
                    input.type = 'text'; input.value = value;
                    itemDiv.append(label, input);
                }
            } else if (currentSection === 'OptionsPortfolio') {
                const parts = key.split('_');
                if (parts.length === 4) itemDiv = createOptionRowUI(parts[0], parts[1], parts[2], parts[3], value);
            } else if (currentSection === 'Portfolio') {
                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item';
                const keyInput = document.createElement('input');
                keyInput.type = 'text'; keyInput.value = key; keyInput.className = 'key-input'; keyInput.placeholder = '代码/名称';
                const valueInput = document.createElement('input');
                valueInput.type = 'text'; valueInput.value = value; valueInput.className = 'value-input'; valueInput.placeholder = '数量/值';
                const removeBtn = document.createElement('button');
                removeBtn.textContent = '删除'; removeBtn.className = 'remove-btn'; removeBtn.onclick = () => itemDiv.remove();
                itemDiv.append(keyInput, valueInput, removeBtn);
            } else {
                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item-static';
                const label = document.createElement('label');
                label.textContent = key;
                const input = document.createElement('input');
                input.type = 'text'; input.value = value;
                itemDiv.append(label, input);
            }
            if (itemDiv) sectionDiv.insertBefore(itemDiv, sectionDiv.querySelector('.add-btn') || null);
        }
    });
}

function updateStatus(message, isError = false, panelKey) {
    const target = statusMessages[panelKey];
    if (!target) return;
    target.innerHTML = message;
    target.className = `status-msg ${isError ? 'status-error' : 'status-success'}`;
    target.style.display = message ? 'block' : 'none';
}

// --- 辅助函数 (大部分与之前版本相同) ---
function getRepoInfoFromURL() {
    const hostname = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (hostname.includes('github.io') && pathParts.length > 0) {
        return { owner: hostname.split('.')[0], repo: pathParts[0] };
    }
    return { owner: 'YOUR_USERNAME', repo: 'YOUR_REPONAME' };
}

async function loadInitialSummary() {
    const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_details_history.csv`;
    const valueChartUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_value_chart.png`;
    const pieChartUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_pie_chart.png`;

    const totalValueDisplay = document.getElementById('total-value-display');
    const valueChartImg = document.getElementById('value-chart-img');
    const pieChartImg = document.getElementById('pie-chart-img');
    const lastUpdatedTime = document.getElementById('last-updated-time');

    valueChartImg.style.display = 'none';
    pieChartImg.style.display = 'none';
    valueChartImg.onload = () => { valueChartImg.style.display = 'block'; };
    pieChartImg.onload = () => { pieChartImg.style.display = 'block'; };

    const timestamp = new Date().getTime();
    valueChartImg.src = `${valueChartUrl}?t=${timestamp}`;
    pieChartImg.src = `${pieChartUrl}?t=${timestamp}`;

    try {
        const response = await fetch(`${csvUrl}?t=${timestamp}`);
        if (!response.ok) throw new Error(`无法加载 CSV: ${response.statusText}`);

        const csvText = await response.text();
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) throw new Error('CSV 文件内容不正确。');

        const headers = lines[0].split(',');
        const lastDataLine = lines[lines.length - 1].split(',');
        const totalValueIndex = headers.indexOf('total_value');
        const dateIndex = headers.indexOf('date');

        if (totalValueIndex === -1) throw new Error('CSV 中未找到 "total_value" 列。');

        const latestTotalValue = parseFloat(lastDataLine[totalValueIndex]);
        if (isNaN(latestTotalValue)) throw new Error('最新的 "total_value" 无效。');

        totalValueDisplay.textContent = `总资产：$${latestTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if(dateIndex !== -1) {
            lastUpdatedTime.textContent = lastDataLine[dateIndex];
        }

    } catch (error) {
        console.error('加载资产概览失败:', error);
        totalValueDisplay.textContent = '总资产：加载失败';
        totalValueDisplay.style.color = 'red';
    }
}

// --- createOptionRowUI, addNewRow, buildIniStringFromUI 函数与之前版本完全相同，此处省略以节省篇幅 ---
// --- 您可以将上一版本中的这些函数直接复制到这里 ---
function createOptionRowUI(ticker = '', date = '', strike = '', type = 'CALL', quantity = '') {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'option-item-row';
    const tickerInput = document.createElement('input');
    tickerInput.type = 'text'; tickerInput.placeholder = 'Ticker'; tickerInput.className = 'option-ticker-input'; tickerInput.value = ticker;
    const dateInput = document.createElement('input');
    dateInput.type = 'date'; dateInput.className = 'option-date-select'; dateInput.value = date;
    const strikeInput = document.createElement('input');
    strikeInput.type = 'number'; strikeInput.placeholder = 'Strike'; strikeInput.className = 'option-strike-input'; strikeInput.value = strike;
    const typeSelect = document.createElement('select');
    typeSelect.className = 'option-type-select';
    ['CALL', 'PUT'].forEach(t => {
        const option = document.createElement('option');
        option.value = t; option.textContent = t;
        if (t.toUpperCase() === type.toUpperCase()) option.selected = true;
        typeSelect.appendChild(option);
    });
    const valueInput = document.createElement('input');
    valueInput.type = 'text'; valueInput.placeholder = '数量'; valueInput.className = 'value-input'; valueInput.value = quantity;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '删除'; removeBtn.className = 'remove-btn'; removeBtn.onclick = () => itemDiv.remove();
    itemDiv.append(tickerInput, dateInput, strikeInput, typeSelect, valueInput, removeBtn);
    return itemDiv;
}

function addNewRow(sectionDiv) {
    const sectionTitle = sectionDiv.querySelector('h3').textContent;
    const addBtn = sectionDiv.querySelector('.add-btn');
    let itemDiv;
    if (sectionTitle === 'OptionsPortfolio') {
        itemDiv = createOptionRowUI();
    } else if (sectionTitle === 'Portfolio') {
        itemDiv = document.createElement('div');
        itemDiv.className = 'portfolio-item';
        const keyInput = document.createElement('input');
        keyInput.type = 'text'; keyInput.placeholder = '股票代码 (例如: AAPL)'; keyInput.className = 'key-input';
        const valueInput = document.createElement('input');
        valueInput.type = 'text'; valueInput.placeholder = '数量/值'; valueInput.className = 'value-input';
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '删除'; removeBtn.className = 'remove-btn'; removeBtn.onclick = () => itemDiv.remove();
        itemDiv.append(keyInput, valueInput, removeBtn);
    }
    if (itemDiv) {
        sectionDiv.insertBefore(itemDiv, addBtn);
    }
}

function buildIniStringFromUI() {
    const uiState = {};
    document.querySelectorAll('.portfolio-section').forEach(section => {
        const title = section.querySelector('h3').textContent;
        uiState[title] = {};
        section.querySelectorAll('.portfolio-item-static').forEach(item => {
            const key = item.querySelector('label').textContent;
            const input = item.querySelector('input, select');
            if (key && input) uiState[title][key] = input.value;
        });
        section.querySelectorAll('.portfolio-item').forEach(item => {
            const key = item.querySelector('.key-input')?.value.trim();
            const value = item.querySelector('.value-input')?.value.trim();
            if (key && value) uiState[title][key] = value;
        });
        section.querySelectorAll('.option-item-row').forEach(item => {
            const ticker = item.querySelector('.option-ticker-input').value.trim().toUpperCase();
            const date = item.querySelector('.option-date-select').value;
            const strike = item.querySelector('.option-strike-input').value.trim();
            const type = item.querySelector('.option-type-select').value;
            const value = item.querySelector('.value-input').value.trim();
            if (ticker && date && strike && value) {
                const key = `${ticker}_${date}_${strike}_${type}`;
                uiState[title][key] = value;
            }
        });
    });

    const tempLines = [];
    const processedKeys = new Set();
    let currentSection = '';
    originalIniLines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
            currentSection = trimmedLine.substring(1, trimmedLine.length - 1);
            tempLines.push(line);
            return;
        }
        if (!currentSection || !trimmedLine.includes('=') || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
            tempLines.push(line);
            return;
        }
        const key = trimmedLine.split('=')[0].trim();
        const sectionState = uiState[currentSection];
        if (sectionState && sectionState.hasOwnProperty(key)) {
            const newValue = sectionState[key];
            const commentPart = line.includes('#') ? ' #' + line.split('#').slice(1).join('#') : '';
            tempLines.push(`${key} = ${newValue}${commentPart}`);
            processedKeys.add(`${currentSection}.${key}`);
        }
    });

    for (const sectionName in uiState) {
        if (!uiState.hasOwnProperty(sectionName)) continue;
        const newItemsForSection = [];
        for (const key in uiState[sectionName]) {
            if (!processedKeys.has(`${sectionName}.${key}`)) {
                const value = uiState[sectionName][key];
                newItemsForSection.push(`${key} = ${value}`);
            }
        }
        if (newItemsForSection.length > 0) {
            let sectionHeaderIndex = -1, nextSectionHeaderIndex = -1;
            for (let i = 0; i < tempLines.length; i++) {
                if (tempLines[i].trim() === `[${sectionName}]`) sectionHeaderIndex = i;
                else if (sectionHeaderIndex !== -1 && tempLines[i].trim().startsWith('[')) {
                    nextSectionHeaderIndex = i;
                    break;
                }
            }
            if (sectionHeaderIndex !== -1) {
                const insertChunkEnd = (nextSectionHeaderIndex === -1) ? tempLines.length : nextSectionHeaderIndex;
                let insertionIndex = insertChunkEnd;
                while (insertionIndex > sectionHeaderIndex + 1 && tempLines[insertionIndex - 1].trim() === '') {
                    insertionIndex--;
                }
                tempLines.splice(insertionIndex, 0, ...newItemsForSection);
            }
        }
    }
    return tempLines.join('\n');
}
