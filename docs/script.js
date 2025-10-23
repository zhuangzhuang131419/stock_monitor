// --- 全局常量与变量 ---
const WORKFLOW_FILE_NAME = 'run_script.yml';
const CONFIG_FILE_PATH = 'config.ini';
const TOKEN_STORAGE_KEY = 'github_pat';
let fileSha = null;
let token = '';
let originalIniLines = [];
let pendingTabSwitch = null;

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
const logoutButtons = document.querySelectorAll('.logout-btn');

const historyModal = {
    backdrop: document.getElementById('history-modal-backdrop'),
    container: document.getElementById('history-modal-container'),
    content: document.getElementById('history-table-content')
};
const totalValueDisplay = document.getElementById('total-value-display');
const returnsDisplayContainer = document.getElementById('returns-display'); // <-- 新增

// --- 初始化与事件监听 ---
document.addEventListener('DOMContentLoaded', () => {
    loadInitialSummary();
    setupEventListeners();
    initializeAuth();
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
    document.getElementById('force-refresh-btn').addEventListener('click', forceRefreshPage);
    logoutButtons.forEach(btn => btn.addEventListener('click', handleLogout));

    // 历史表格弹窗的事件监听
    totalValueDisplay.addEventListener('click', showHistoryTable);
    historyModal.backdrop.addEventListener('click', hideHistoryTable);
}


async function showHistoryTable() {
    document.body.classList.add('modal-open');
    historyModal.backdrop.classList.remove('hidden');
    historyModal.container.classList.remove('hidden');

    requestAnimationFrame(() => {
        historyModal.backdrop.classList.add('is-active');
        historyModal.container.classList.add('is-active');
    });

    historyModal.content.innerHTML = '<p style="text-align:center; padding: 20px;">正在加载历史数据...</p>';
    try {
        const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_details_history.csv`;
        const timestamp = new Date().getTime();
        const response = await fetch(`${csvUrl}?t=${timestamp}`);

        if (!response.ok) {
            throw new Error(`无法加载 CSV 文件 (状态: ${response.status})`);
        }

        const csvText = await response.text();
        const tableHtml = parseCsvToHtmlTable(csvText);
        historyModal.content.innerHTML = tableHtml;

    } catch (error) {
        console.error('加载历史数据失败:', error);
        historyModal.content.innerHTML = `<div class="status-error" style="display:block; margin: 20px;">加载失败: ${error.message}</div>`;
    }
}

function hideHistoryTable() {
    document.body.classList.remove('modal-open');
    historyModal.container.addEventListener('transitionend', () => {
        historyModal.backdrop.classList.add('hidden');
        historyModal.container.classList.add('hidden');
    }, { once: true });
    historyModal.backdrop.classList.remove('is-active');
    historyModal.container.classList.remove('is-active');
}

function parseCsvToHtmlTable(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return '<p>没有历史数据。</p>';

    let html = '<table class="history-table">';
    const headers = lines[0].split(',');
    html += '<thead><tr>';
    headers.forEach(header => {
        html += `<th>${header.trim().replace(/_/g, ' ')}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cells = lines[i].split(',');
        html += '<tr>';
        cells.forEach(cell => {
            const trimmedCell = cell.trim();
            const num = Number(trimmedCell);
            if (!isNaN(num) && trimmedCell.includes('.')) {
                html += `<td>${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`;
            } else {
                html += `<td>${trimmedCell}</td>`;
            }
        });
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function initializeAuth() {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) {
        console.log("检测到已保存的 Token，正在尝试自动登录...");
        loadDataWithToken(storedToken, true);
    } else {
        console.log("未找到已保存的 Token。");
    }
}

function handleLogout() {
    if (confirm('您确定要清除授权并退出登录吗？这会移除保存在本浏览器的 Token。')) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        token = '';
        fileSha = null;
        window.location.reload();
    }
}

function setLoggedInUI(isLoggedIn) {
    if (isLoggedIn) {
        logoutButtons.forEach(btn => btn.classList.remove('hidden'));
    } else {
        logoutButtons.forEach(btn => btn.classList.add('hidden'));
    }
}

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

const { owner, repo } = getRepoInfoFromURL();

async function handleTokenConfirm() {
    const inputToken = modal.input.value.trim();
    if (!inputToken) {
        showTokenModal('Token 不能为空。', true);
        return;
    }
    updateStatus('正在验证 Token 并加载数据...', false, 'modal');
    loadDataWithToken(inputToken);
}

async function loadDataWithToken(tokenToValidate, isAutoAuth = false) {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            headers: { 'Authorization': `token ${tokenToValidate}` }
        });

        if (!response.ok) {
            if (isAutoAuth) {
                localStorage.removeItem(TOKEN_STORAGE_KEY);
                console.error('自动登录失败: 已保存的 Token 无效或已过期，已自动清除。');
                setLoggedInUI(false);
                return;
            }
            if (response.status === 401) throw new Error('Token 无效或权限不足。');
            if (response.status === 404) throw new Error('在仓库中未找到 config.ini 文件。');
            throw new Error(`GitHub API 错误: ${response.statusText}`);
        }

        token = tokenToValidate;
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        setLoggedInUI(true);

        const data = await response.json();
        fileSha = data.sha;
        const content = decodeURIComponent(escape(atob(data.content)));
        originalIniLines = content.split('\n');

        displayPortfolio(originalIniLines);

        if (!isAutoAuth) {
            const tabToSwitch = pendingTabSwitch;
            hideTokenModal();
            if (tabToSwitch) {
                switchTab(tabToSwitch);
            }
        }
        console.log("授权成功，数据已加载。");

    } catch (error) {
        console.error(error);
        if (!isAutoAuth) {
            showTokenModal(`验证失败: ${error.message}`, true);
        }
        setLoggedInUI(false);
    }
}


async function savePortfolio() {
    if (!token || !fileSha) {
        alert('错误: 授权信息丢失，请刷新页面重试。');
        return;
    }

    const activePanelKey = panels.positions.classList.contains('active') ? 'positions' : 'settings';
    updateStatus('正在验证并保存...', false, activePanelKey);

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
        pendingTabSwitch = 'summary';
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

            const positionSections = ['Portfolio', 'OptionsPortfolio', 'Cash'];
            const targetEditor = positionSections.includes(currentSection) ? editors.positions : editors.settings;

            if (['Portfolio', 'OptionsPortfolio'].includes(currentSection)) {
                const addBtn = document.createElement('button');
                addBtn.textContent = '＋ 新增一行';
                addBtn.className = 'add-btn';
                addBtn.onclick = function() { addNewRow(this.parentElement); };
                sectionDiv.appendChild(addBtn);
            }
            targetEditor.appendChild(sectionDiv);

        } else if (currentSection && processedLine.includes('=')) {
            const positionSections = ['Portfolio', 'OptionsPortfolio', 'Cash'];
            const parentEditor = positionSections.includes(currentSection) ? editors.positions : editors.settings;
            const sectionDiv = Array.from(parentEditor.querySelectorAll('.portfolio-section h3')).find(h3 => h3.textContent === currentSection)?.parentElement;
            if (!sectionDiv) return;

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

function getRepoInfoFromURL() {
    const hostname = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (hostname.includes('github.io') && pathParts.length > 0) {
        return { owner: hostname.split('.')[0], repo: pathParts[0] };
    }
    return { owner: 'YOUR_USERNAME', repo: 'YOUR_REPONAME' };
}

// ========== 主要修改: 拆分出加载收益率的函数 ==========

/**
 * 异步获取并展示投资回报率、盈利和增值数据
 */
async function loadReturnsData() {
    const returnsUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_return.json`;
    const timestamp = new Date().getTime();

    returnsDisplayContainer.innerHTML = '<p style="font-size: 14px; color: #6a737d;">正在加载收益率...</p>';

    try {
        const response = await fetch(`${returnsUrl}?t=${timestamp}`);
        if (!response.ok) {
            throw new Error(`无法加载收益率文件 (状态: ${response.status})`);
        }
        const returnsData = await response.json();

        if (!Array.isArray(returnsData) || returnsData.length === 0) {
            returnsDisplayContainer.innerHTML = '<p style="font-size: 14px; color: #6a737d;">暂无收益率数据。</p>';
            return;
        }

        returnsDisplayContainer.innerHTML = ''; // 清空加载提示

        returnsData.forEach(item => {
            const { period, return: returnValue, profit, growth } = item;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'return-item';

            // --- 周期标签 (例如 "本周至今") ---
            const periodLabel = document.createElement('span');
            periodLabel.className = 'return-label';
            periodLabel.textContent = period;
            itemDiv.appendChild(periodLabel);

            // --- 创建带颜色数值的辅助函数 ---
            const createValueSpan = (value, isPercent) => {
                const span = document.createElement('span');
                const sign = value > 0 ? '+' : '';
                let text;
                if (isPercent) {
                    text = `${sign}${(value * 100).toFixed(2)}%`;
                } else {
                    text = `${sign}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                }
                span.textContent = text;

                // 添加颜色类
                if (value > 0) {
                    span.classList.add('positive');
                } else if (value < 0) {
                    span.classList.add('negative');
                }
                return span;
            };

            // --- 1. 收益率 (Return) ---
            const returnValueSpan = createValueSpan(returnValue, true);
            returnValueSpan.classList.add('return-value'); // 使用这个类来定义大号字体
            itemDiv.appendChild(returnValueSpan);

            // --- 2. 盈利 (Profit) ---
            const profitDiv = document.createElement('div');
            profitDiv.className = 'detail-line';
            const profitLabel = document.createElement('span');
            profitLabel.className = 'detail-label';
            profitLabel.textContent = '盈利';
            const profitValueSpan = createValueSpan(profit, false);
            profitValueSpan.classList.add('detail-value');
            profitDiv.append(profitLabel, profitValueSpan);
            itemDiv.appendChild(profitDiv);

            // --- 3. 增值 (Growth) ---
            const growthDiv = document.createElement('div');
            growthDiv.className = 'detail-line';
            const growthLabel = document.createElement('span');
            growthLabel.className = 'detail-label';
            growthLabel.textContent = '增值';
            const growthValueSpan = createValueSpan(growth, false);
            growthValueSpan.classList.add('detail-value');
            growthDiv.append(growthLabel, growthValueSpan);
            itemDiv.appendChild(growthDiv);

            returnsDisplayContainer.appendChild(itemDiv);
        });

    } catch (error) {
        console.error('加载收益率数据失败:', error);
        returnsDisplayContainer.innerHTML = `<p style="font-size: 14px; color: #d73a49;">收益率加载失败</p>`;
    }
}


async function loadInitialSummary() {
    const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_details_history.csv`;
    const valueChartUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_value_chart.png`;
    const pieChartUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_pie_chart.png`;

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

    // 同时加载收益率数据
    loadReturnsData();

    try {
        const response = await fetch(`${csvUrl}?t=${timestamp}`);
        if (!response.ok) throw new Error(`无法加载 CSV: ${response.statusText}`);

        const csvText = await response.text();
        const lines = csvText.trim().split('\n');

        if (lines.length < 2) throw new Error('CSV 文件内容不正确。');

        const headers = lines[0].split(',');
        const latestDataLine = lines[1].split(',');
        const totalValueIndex = headers.indexOf('total_value');
        const dateIndex = headers.indexOf('date');

        if (totalValueIndex === -1) throw new Error('CSV 中未找到 "total_value" 列。');
        if (dateIndex === -1) throw new Error('CSV 中未找到 "date" 列。');

        const latestTotalValue = parseFloat(latestDataLine[totalValueIndex]);
        if (isNaN(latestTotalValue)) throw new Error('最新的 "total_value" 无效。');

        totalValueDisplay.textContent = `总资产：$${latestTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        lastUpdatedTime.textContent = latestDataLine[dateIndex];

    } catch (error) {
        console.error('加载资产概览失败:', error);
        totalValueDisplay.textContent = '总资产：加载失败';
        totalValueDisplay.style.color = 'red';
    }
}
// ========================================================


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

function forceRefreshPage() {
    const baseUrl = window.location.origin + window.location.pathname;
    const newUrl = `${baseUrl}?t=${new Date().getTime()}`;
    window.location.href = newUrl;
}
