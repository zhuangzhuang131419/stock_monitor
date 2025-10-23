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

function addNewRow(sectionDiv) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'portfolio-item';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = '代码/名称 (例如: 600519.SH)';
    keyInput.className = 'key-input';

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = '数量/值 (例如: 100)';
    valueInput.className = 'value-input';

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '删除';
    removeBtn.className = 'remove-btn';
    removeBtn.onclick = () => itemDiv.remove();

    itemDiv.appendChild(keyInput);
    itemDiv.appendChild(valueInput);
    itemDiv.appendChild(removeBtn);

    const addBtn = sectionDiv.querySelector('.add-btn');
    sectionDiv.insertBefore(itemDiv, addBtn);
}

function buildIniStringFromUI() {
    let iniString = '';
    const sections = document.querySelectorAll('.portfolio-section');

    sections.forEach(section => {
        const sectionTitle = section.querySelector('h3').textContent;
        iniString += `[${sectionTitle}]\n`;

        // 处理动态行 (Portfolio, OptionsPortfolio)
        section.querySelectorAll('.portfolio-item').forEach(item => {
            const keyInput = item.querySelector('.key-input');
            const valueInput = item.querySelector('.value-input');
            if (keyInput && valueInput) {
                const key = keyInput.value.trim();
                const value = valueInput.value.trim();
                if (key) { // 只有 key 不为空才添加
                    iniString += `${key} = ${value}\n`;
                }
            }
        });

        // 处理静态行 (其他 section)
        section.querySelectorAll('.portfolio-item-static').forEach(item => {
            const label = item.querySelector('label');
            const input = item.querySelector('input');
            if (label && input) {
                const key = label.textContent.trim();
                const value = input.value.trim();
                iniString += `${key} = ${value}\n`;
            }
        });

        iniString += '\n';
    });
    return iniString.trim();
}

function updateStatus(message, isError = false) {
    // 使用 innerHTML 以便支持 <br> 换行
    statusMsg.innerHTML = message;
    statusMsg.className = isError ? 'status-error' : 'status-success';
    statusMsg.style.display = 'block';
}
