// --- 脚本开始 ---

const WORKFLOW_FILE_NAME = 'main.yml';
const CONFIG_FILE_PATH = 'config.ini';
let fileSha = null;
let token = '';
let originalIniLines = []; // <-- 新增: 用于存储原始文件行

const tokenInput = document.getElementById('github-token');
const loadBtn = document.getElementById('load-btn');
const saveBtn = document.getElementById('save-btn');
const runWorkflowBtn = document.getElementById('run-workflow-btn');
const statusMsg = document.getElementById('status-msg');
const portfolioEditor = document.getElementById('portfolio-editor');

function getRepoInfoFromURL() {
    const hostname = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (hostname.includes('github.io') && pathParts.length > 0) {
        return { owner: hostname.split('.')[0], repo: pathParts[0] };
    }
    // 开发者请注意：如果不是通过 github.io 访问，请在此处填写您的仓库信息
    return { owner: 'YOUR_USERNAME', repo: 'YOUR_REPONAME' };
}
const { owner, repo } = getRepoInfoFromURL();
console.log(`已自动识别仓库: ${owner}/${repo}`);

loadBtn.addEventListener('click', loadPortfolio);
saveBtn.addEventListener('click', savePortfolio);
runWorkflowBtn.addEventListener('click', runWorkflow);

// --- 函数已修改 ---
async function loadPortfolio() {
    token = tokenInput.value;
    if (!token) {
        updateStatus('错误: 请先输入 Personal Access Token!', true);
        return;
    }
    updateStatus('正在加载...');
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!response.ok) throw new Error(`GitHub API 错误: ${response.statusText}`);
        const data = await response.json();
        fileSha = data.sha;
        const content = decodeURIComponent(escape(atob(data.content)));

        originalIniLines = content.split('\n'); // 保存原始文件行
        displayPortfolio(originalIniLines);      // 传递行数组用于显示

        updateStatus('持仓已成功加载！', false);
    } catch (error) {
        console.error(error);
        updateStatus(`加载失败: ${error.message}`, true);
    }
}

async function savePortfolio() {
    if (!token || !fileSha) {
        updateStatus('错误: 请先加载持仓并输入Token!', true);
        return;
    }
    updateStatus('正在验证并保存...', false);
    let isValid = true;
    const errorMessages = [];
    document.querySelectorAll('input.invalid, select.invalid').forEach(el => el.classList.remove('invalid'));
    const sections = document.querySelectorAll('.portfolio-section');

    sections.forEach(section => {
        const sectionName = section.querySelector('h3').textContent;
        if (sectionName !== 'Portfolio' && sectionName !== 'OptionsPortfolio') return;
        const keys = new Set();
        const items = section.querySelectorAll('.portfolio-item, .option-item-row');
        items.forEach(item => {
            let key = '', value = '', inputToMark = null;
            if (item.classList.contains('option-item-row')) {
                const tickerInput = item.querySelector('.option-ticker-input');
                const dateInput = item.querySelector('.option-date-select');
                const strikeInput = item.querySelector('.option-strike-input');
                const typeSelect = item.querySelector('.option-type-select');
                const valueInput = item.querySelector('.value-input');
                const ticker = tickerInput.value.trim().toUpperCase();
                value = valueInput.value.trim();
                inputToMark = tickerInput;
                if (!ticker && !strikeInput.value.trim() && !value) return; // 忽略完全空白的新增行
                if (ticker && dateInput.value && strikeInput.value.trim()) {
                    key = `${ticker}_${dateInput.value}_${strikeInput.value.trim()}_${typeSelect.value}`;
                }
            } else {
                const keyInput = item.querySelector('.key-input');
                const valueInput = item.querySelector('.value-input');
                key = keyInput.value.trim();
                value = valueInput.value.trim();
                inputToMark = keyInput;
                if (!key && !value) return; // 忽略完全空白的新增行
            }
            if (!key && value) {
                isValid = false;
                inputToMark.classList.add('invalid');
                errorMessages.push(`[${sectionName}] 中有条目缺少“代码/名称”。`);
            } else if (key && keys.has(key)) {
                isValid = false;
                inputToMark.classList.add('invalid');
                errorMessages.push(`[${sectionName}] 中存在重复条目: ${key}`);
            } else if (key) {
                keys.add(key);
            }
        });
    });

    if (!isValid) {
        updateStatus(`保存失败，请修正以下错误：<br>- ${errorMessages.join('<br>- ')}`, true);
        return;
    }
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
        originalIniLines = newContent.split('\n'); // 更新内存中的原始文件
        updateStatus('持仓已成功保存！', false);
    } catch (error) {
        console.error(error);
        updateStatus(`保存失败: ${error.message}`, true);
    }
}

async function runWorkflow() {
    if (!token) {
        updateStatus('错误: 请先输入 Personal Access Token!', true);
        return;
    }
    updateStatus('正在发送触发指令...');
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ ref: 'main' })
        });
        if (response.status !== 204) throw new Error(`GitHub API 错误: ${response.statusText}`);
        updateStatus('成功触发云端分析！请稍后到 Actions 页面查看进度。', false);
    } catch (error) {
        console.error(error);
        updateStatus(`触发失败: ${error.message}`, true);
    }
}

// --- 函数已重写 ---
function displayPortfolio(lines) {
    portfolioEditor.innerHTML = '';
    let currentSection = null;

    lines.forEach((line, index) => {
        const processedLine = line.split('#')[0].trim();

        if (processedLine.startsWith('[') && processedLine.endsWith(']')) {
            currentSection = processedLine.substring(1, processedLine.length - 1);
            if (currentSection === 'Proxy') return; // 不显示 Proxy 区块
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'portfolio-section';
            sectionDiv.innerHTML = `<h3>${currentSection}</h3>`;
            portfolioEditor.appendChild(sectionDiv);

            if (currentSection === 'Portfolio' || currentSection === 'OptionsPortfolio') {
                const addBtn = document.createElement('button');
                addBtn.textContent = '＋ 新增一行';
                addBtn.className = 'add-btn';
                addBtn.onclick = function() { addNewRow(this.parentElement); };
                sectionDiv.appendChild(addBtn);
            }
        } else if (currentSection && processedLine.includes('=')) {
            const sectionDiv = Array.from(portfolioEditor.querySelectorAll('.portfolio-section h3'))
                                  .find(h3 => h3.textContent === currentSection)?.parentElement;
            if (!sectionDiv) return;

            const [key, value] = processedLine.split('=').map(s => s.trim());
            if (!key || typeof value === 'undefined') return;

            let itemDiv;
            // --- 新逻辑：为 data_source 创建下拉菜单 ---
            if (key === 'data_source') {
                const commentLine = (index > 0) ? lines[index - 1].trim() : '';
                const options = commentLine.match(/\d+\s*:\s*[\w-]+/g);

                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item-static';
                const label = document.createElement('label');
                label.textContent = key;

                if (options) { // 如果找到匹配的注释，创建下拉菜单
                    const select = document.createElement('select');
                    options.forEach(opt => {
                        const [num, desc] = opt.split(':').map(s => s.trim());
                        const optionEl = document.createElement('option');
                        optionEl.value = num;
                        optionEl.textContent = desc;
                        if (num === value) optionEl.selected = true;
                        select.appendChild(optionEl);
                    });
                    itemDiv.append(label, select);
                } else { // 否则，退回为普通输入框
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
            } else { // 其他静态配置项
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

// --- 函数已重写 ---
function buildIniStringFromUI() {
    // 1. 从 UI 构建当前状态的对象
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

    // 2. 基于原始文件行，更新或删除条目
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
        // 如果 sectionState 中没有这个 key，说明它被 UI 删除了，我们不 push 任何东西，即删除该行
    });

    // 3. 将 UI 中新增的条目追加到对应区块
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

function updateStatus(message, isError = false) {
    statusMsg.innerHTML = message;
    statusMsg.className = isError ? 'status-error' : 'status-success';
    statusMsg.style.display = 'block';
}

// --- 脚本结束 ---
