// --- 配置区 ---
const WORKFLOW_FILE_NAME = 'main.yml';
const CONFIG_FILE_PATH = 'config.ini';
// --- 配置区结束 ---

// --- 全局变量 ---
let fileSha = null;
let token = ''; // 将 token 提升为全局变量，方便各函数使用

// --- DOM 元素 ---
const tokenInput = document.getElementById('github-token');
const loadBtn = document.getElementById('load-btn');
const saveBtn = document.getElementById('save-btn');
const runWorkflowBtn = document.getElementById('run-workflow-btn');
const statusMsg = document.getElementById('status-msg');
const portfolioEditor = document.getElementById('portfolio-editor');

// --- 自动识别仓库信息 ---
function getRepoInfoFromURL() {
    const hostname = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (hostname.includes('github.io') && pathParts.length > 0) {
        const owner = hostname.split('.')[0];
        const repo = pathParts[0];
        return { owner, repo };
    }
    return { owner: 'YOUR_USERNAME', repo: 'YOUR_REPONAME' }; // 本地测试备用
}

const { owner, repo } = getRepoInfoFromURL();
console.log(`已自动识别仓库: ${owner}/${repo}`);

// --- 事件监听 ---
loadBtn.addEventListener('click', loadPortfolio);
saveBtn.addEventListener('click', savePortfolio);
runWorkflowBtn.addEventListener('click', runWorkflow);

// --- API 调用函数 ---

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
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const decoder = new TextDecoder('utf-8');
        const content = decoder.decode(bytes);

        displayPortfolio(content);
        updateStatus('持仓已成功加载！', false);
    } catch (error) {
        console.error(error);
        updateStatus(`加载失败: ${error.message}`, true);
    }
}

async function savePortfolio() {
    if (!token) {
        updateStatus('错误: 请先输入 Personal Access Token!', true);
        return;
    }
    if (!fileSha) {
        updateStatus('错误: 请先加载持仓才能保存!', true);
        return;
    }
    updateStatus('正在验证并保存...', false);

    // --- 开始验证 ---
    let isValid = true;
    const errorMessages = [];
    const sectionsToValidate = ['Portfolio', 'OptionsPortfolio'];

    document.querySelectorAll('input.invalid').forEach(el => el.classList.remove('invalid'));

    for (const sectionName of sectionsToValidate) {
        const sectionDiv = Array.from(document.querySelectorAll('.portfolio-section h3'))
                                .find(h3 => h3.textContent === sectionName)?.parentElement;
        if (!sectionDiv) continue;

        const keys = new Set();
        const items = sectionDiv.querySelectorAll('.portfolio-item');

        items.forEach((item) => {
            const keyInput = item.querySelector('.key-input');
            if (!keyInput) return;

            const key = keyInput.value.trim();
            const valueInput = item.querySelector('.value-input');
            const value = valueInput ? valueInput.value.trim() : '';

            // 如果 key 和 value 都为空，则认为是用户想删除的空行，跳过验证
            if (key === '' && value === '') {
                return;
            }

            if (key === '') {
                isValid = false;
                keyInput.classList.add('invalid');
                errorMessages.push(`[${sectionName}] 中有一行的“代码/名称”为空，但“值”不为空。`);
            } else if (keys.has(key)) {
                isValid = false;
                keyInput.classList.add('invalid');
                errorMessages.push(`[${sectionName}] 中存在重复的“代码/名称”: ${key}`);
            } else {
                keys.add(key);
            }
        });
    }

    if (!isValid) {
        updateStatus(`保存失败，请修正以下错误：<br>- ${errorMessages.join('<br>- ')}`, true);
        return;
    }
    // --- 验证结束 ---

    const newContent = buildIniStringFromUI();
    const encoder = new TextEncoder();
    const uint8array = encoder.encode(newContent);
    const binaryString = String.fromCharCode.apply(null, uint8array);
    const newContentBase64 = btoa(binaryString);

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({
                message: `Update ${CONFIG_FILE_PATH} via web editor`,
                content: newContentBase64,
                sha: fileSha
            })
        });

        if (!response.ok) throw new Error(`GitHub API 错误: ${response.statusText}`);

        const data = await response.json();
        fileSha = data.content.sha;
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
    } catch (error)
    {
        console.error(error);
        updateStatus(`触发失败: ${error.message}`, true);
    }
}

// --- 辅助函数 ---

function displayPortfolio(iniContent) {
    portfolioEditor.innerHTML = '';
    const lines = iniContent.split('\n');
    let currentSection = null;
    let sectionDiv = null;

    lines.forEach(line => {
        const processedLine = line.split('#')[0].trim();
        if (!processedLine) return;

        if (processedLine.startsWith('[') && processedLine.endsWith(']')) {
            currentSection = processedLine.substring(1, processedLine.length - 1);
            sectionDiv = document.createElement('div');
            sectionDiv.className = 'portfolio-section';
            sectionDiv.innerHTML = `<h3>${currentSection}</h3>`;
            portfolioEditor.appendChild(sectionDiv);

            if (currentSection === 'Portfolio' || currentSection === 'OptionsPortfolio') {
                const addBtn = document.createElement('button');
                addBtn.textContent = '＋ 新增一行';
                addBtn.className = 'add-btn';
                const correctSectionDiv = sectionDiv;
                addBtn.onclick = () => addNewRow(correctSectionDiv);
                sectionDiv.appendChild(addBtn);
            }
        } else if (processedLine.includes('=') && sectionDiv) {
            const [key, value] = processedLine.split('=').map(s => s.trim());
            if (key && typeof value !== 'undefined') {
                let itemDiv;
                if (currentSection === 'Portfolio' || currentSection === 'OptionsPortfolio') {
                    itemDiv = document.createElement('div');
                    itemDiv.className = 'portfolio-item';

                    const keyInput = document.createElement('input');
                    keyInput.type = 'text';
                    keyInput.value = key;
                    keyInput.className = 'key-input';
                    keyInput.placeholder = '代码/名称';

                    const valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.value = value;
                    valueInput.className = 'value-input';
                    valueInput.placeholder = '数量/值';

                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = '删除';
                    removeBtn.className = 'remove-btn';
                    removeBtn.onclick = () => itemDiv.remove();

                    itemDiv.appendChild(keyInput);
                    itemDiv.appendChild(valueInput);
                    itemDiv.appendChild(removeBtn);
                } else {
                    itemDiv = document.createElement('div');
                    itemDiv.className = 'portfolio-item-static'; // 使用新的 class

                    const label = document.createElement('label');
                    label.textContent = key;
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = value;

                    itemDiv.appendChild(label);
                    itemDiv.appendChild(input);
                }

                const addBtn = sectionDiv.querySelector('.add-btn');
                if (addBtn) {
                    sectionDiv.insertBefore(itemDiv, addBtn);
                } else {
                    sectionDiv.appendChild(itemDiv);
                }
            }
        }
    });
}

/**
 * 在指定分区下添加新行。
 * 如果是期权分区，则创建 Ticker, Date, Strike, Type 等多个输入控件。
 * 否则，创建标准的 Key-Value 输入行。
 */
function addNewRow(sectionDiv) {
    const sectionTitle = sectionDiv.querySelector('h3').textContent;
    const addBtn = sectionDiv.querySelector('.add-btn');

    if (sectionTitle === 'OptionsPortfolio') {
        // --- 创建期权专用的复杂输入行 ---
        const itemDiv = document.createElement('div');
        itemDiv.className = 'option-item-row'; // 使用新的CSS类

        // 1. Ticker 输入框
        const tickerInput = document.createElement('input');
        tickerInput.type = 'text';
        tickerInput.placeholder = 'Ticker';
        tickerInput.className = 'option-ticker-input';

        // 2. 到期日下拉菜单
        const dateSelect = document.createElement('select');
        dateSelect.className = 'option-date-select';
        const expirationDates = generateExpirationDates();
        expirationDates.forEach(dateStr => {
            const option = document.createElement('option');
            option.value = dateStr;
            option.textContent = dateStr;
            dateSelect.appendChild(option);
        });

        // 3. 行权价输入框
        const strikeInput = document.createElement('input');
        strikeInput.type = 'number';
        strikeInput.placeholder = 'Strike';
        strikeInput.className = 'option-strike-input';

        // 4. 类型 (Call/Put) 下拉菜单
        const typeSelect = document.createElement('select');
        typeSelect.className = 'option-type-select';
        ['CALL', 'PUT'].forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            typeSelect.appendChild(option);
        });

        // 5. 数量输入框 (Value)
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.placeholder = '数量';
        valueInput.className = 'value-input';

        // 6. 删除按钮
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '删除';
        removeBtn.className = 'remove-btn';
        removeBtn.onclick = () => itemDiv.remove();

        // 将所有控件添加到行容器中
        itemDiv.appendChild(tickerInput);
        itemDiv.appendChild(dateSelect);
        itemDiv.appendChild(strikeInput);
        itemDiv.appendChild(typeSelect);
        itemDiv.appendChild(valueInput);
        itemDiv.appendChild(removeBtn);

        sectionDiv.insertBefore(itemDiv, addBtn);

    } else {
        // --- 对于 Portfolio 和其他分区，保持原来的简单输入行 ---
        const itemDiv = document.createElement('div');
        itemDiv.className = 'portfolio-item';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = (sectionTitle === 'Portfolio') ? '股票代码 (例如: AAPL)' : '代码/名称';
        keyInput.className = 'key-input';

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.placeholder = '数量/值';
        valueInput.className = 'value-input';

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '删除';
        removeBtn.className = 'remove-btn';
        removeBtn.onclick = () => itemDiv.remove();

        itemDiv.appendChild(keyInput);
        itemDiv.appendChild(valueInput);
        itemDiv.appendChild(removeBtn);

        sectionDiv.insertBefore(itemDiv, addBtn);
    }
}

/**
 * 从UI界面读取所有输入，并构建符合 ini 格式的字符串。
 * 能够识别并正确拼接期权分区的多个输入控件。
 */
function buildIniStringFromUI() {
    let iniContent = '';
    const sections = document.querySelectorAll('.portfolio-section');

    sections.forEach(section => {
        const title = section.querySelector('h3').textContent;
        iniContent += `[${title}]\n`;

        // 选择所有行项目，无论是简单的还是复杂的期权行
        const items = section.querySelectorAll('.portfolio-item, .option-item-row');

        items.forEach(item => {
            let key, value;

            // 判断是否为期权行
            if (item.classList.contains('option-item-row')) {
                const ticker = item.querySelector('.option-ticker-input').value.trim().toUpperCase();
                const date = item.querySelector('.option-date-select').value;
                const strike = item.querySelector('.option-strike-input').value.trim();
                const type = item.querySelector('.option-type-select').value;
                value = item.querySelector('.value-input').value.trim();

                // 只有在关键信息都填写后才拼接
                if (ticker && strike && value) {
                    key = `${ticker}_${date}_${strike}_${type}`;
                }
            } else {
                // 处理标准行
                const keyInput = item.querySelector('.key-input');
                const valueInput = item.querySelector('.value-input');
                if (keyInput && valueInput) {
                    key = keyInput.value.trim();
                    value = valueInput.value.trim();
                }
            }

            // 如果 key 和 value 都有效，则添加到 ini 字符串中
            if (key && value) {
                iniContent += `${key} = ${value}\n`;
            }
        });
        iniContent += '\n'; // 每个分区后加一个空行
    });

    return iniContent.trim();
}

function updateStatus(message, isError = false) {
    // 使用 innerHTML 以便支持 <br> 换行
    statusMsg.innerHTML = message;
    statusMsg.className = isError ? 'status-error' : 'status-success';
    statusMsg.style.display = 'block';
}


/**
 * 动态生成未来N个月的期权到期日（通常为每月的第三个星期五）
 * @returns {string[]} 返回格式为 "YYYY-MM-DD" 的日期字符串数组
 */
function generateExpirationDates() {
    const dates = [];
    const today = new Date();
    // 生成未来36个月的到期日
    for (let i = 0; i < 36; i++) {
        let date = new Date(today.getFullYear(), today.getMonth() + i, 1);

        // 找到当月第一个星期五
        while (date.getDay() !== 5) {
            date.setDate(date.getDate() + 1);
        }

        // 加上14天，得到第三个星期五
        date.setDate(date.getDate() + 14);

        // 格式化为 YYYY-MM-DD
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        dates.push(`${year}-${month}-${day}`);
    }
    return dates;
}
