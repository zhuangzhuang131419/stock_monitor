// --- 配置区 ---
// 您需要在这里指定您的 GitHub Actions 工作流文件的确切名称
const WORKFLOW_FILE_NAME = 'main.yml'; // 例如: 'main.yml', 'ci.yml' 等
const CONFIG_FILE_PATH = 'config.ini';
// --- 配置区结束 ---

// --- 全局变量 ---
let fileSha = null; // 用于在更新文件时提供给 GitHub API

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
    // 本地测试时的备用值
    return { owner: 'YOUR_USERNAME', repo: 'YOUR_REPONAME' };
}

const { owner, repo } = getRepoInfoFromURL();
console.log(`已自动识别仓库: ${owner}/${repo}`);


// --- 事件监听 ---
loadBtn.addEventListener('click', loadPortfolio);
saveBtn.addEventListener('click', savePortfolio);
runWorkflowBtn.addEventListener('click', runWorkflow);


// --- API 调用函数 ---

/**
 * 加载 config.ini 文件内容并显示
 */
async function loadPortfolio() {
    const token = tokenInput.value;
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
        fileSha = data.sha; // 保存 SHA 以便后续更新
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

/**
 * 保存当前编辑器的内容到 config.ini
 */
async function savePortfolio() {
    const token = tokenInput.value;
    if (!token) {
        updateStatus('错误: 请先输入 Personal Access Token!', true);
        return;
    }
    if (!fileSha) {
        updateStatus('错误: 请先加载持仓才能保存!', true);
        return;
    }
    updateStatus('正在保存...');

    const newContent = buildIniStringFromUI();
    // 使用 TextEncoder 和 btoa 的组合来正确编码包含中文的字符串
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
                sha: fileSha // 必须提供旧文件的 SHA
            })
        });

        if (!response.ok) throw new Error(`GitHub API 错误: ${response.statusText}`);

        const data = await response.json();
        fileSha = data.content.sha; // 更新 SHA 以便连续保存
        updateStatus('配置已成功保存并提交到 GitHub！', false);

    } catch (error) {
        console.error(error);
        updateStatus(`保存失败: ${error.message}`, true);
    }
}

/**
 * 触发 GitHub Actions 工作流
 */
async function runWorkflow() {
    const token = tokenInput.value;
    if (!token) {
        updateStatus('错误: 请先输入 Personal Access Token!', true);
        return;
    }
    updateStatus('正在发送触发指令...');

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({
                ref: 'main' // 或者您的主分支名，如 'master'
            })
        });

        if (response.status !== 204) throw new Error(`GitHub API 错误: ${response.statusText}`);

        updateStatus('成功触发云端分析！请稍后到 Actions 页面查看进度。', false);

    } catch (error) {
        console.error(error);
        updateStatus(`触发失败: ${error.message}`, true);
    }
}


// --- 辅助函数 ---

/**
 * 解析 INI 字符串并在页面上生成表单
 * @param {string} iniContent
 */
function displayPortfolio(iniContent) {
    portfolioEditor.innerHTML = ''; // 清空现有内容
    const lines = iniContent.split('\n');
    let currentSection = null;
    let sectionDiv = null;

    lines.forEach(line => {
        // --- 新增逻辑：处理注释 ---
        // 1. 使用 split('#') 来分割字符串，取第一部分，这样就去掉了'#'及之后的所有内容。
        // 2. 使用 trim() 去除处理后可能留下的前后空格。
        const processedLine = line.split('#')[0].trim();

        // 如果处理后是空行（说明原行为空、或者只有注释），则直接跳过这一行
        if (!processedLine) {
            return; // 在 forEach 中，return 的作用相当于 for 循环里的 continue
        }
        // --- 新增逻辑结束 ---


        // 后续的所有逻辑都基于处理过的 processedLine，而不是原始的 line
        if (processedLine.startsWith('[') && processedLine.endsWith(']')) {
            // 创建新的 section
            currentSection = processedLine.substring(1, processedLine.length - 1);
            sectionDiv = document.createElement('div');
            sectionDiv.className = 'portfolio-section';
            sectionDiv.innerHTML = `<h3>${currentSection}</h3>`;
            portfolioEditor.appendChild(sectionDiv);
        } else if (processedLine.includes('=') && sectionDiv) {
            // 在当前 section 中添加键值对
            const [key, value] = processedLine.split('=').map(s => s.trim());

            // 增加一个健壮性检查，防止 "key=" 这种不规范格式导致 value 为 undefined
            if (key && typeof value !== 'undefined') {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item';

                const label = document.createElement('label');
                label.setAttribute('for', `input-${currentSection}-${key}`);
                label.textContent = key;

                const input = document.createElement('input');
                input.type = 'text';
                input.id = `input-${currentSection}-${key}`;
                input.value = value;
                input.dataset.section = currentSection;
                input.dataset.key = key;

                itemDiv.appendChild(label);
                itemDiv.appendChild(input);
                sectionDiv.appendChild(itemDiv);
            }
        }
    });
}

/**
 * 从 UI 表单构建 INI 格式的字符串
 * @returns {string}
 */
function buildIniStringFromUI() {
    let newContent = '';
    const sections = {};

    portfolioEditor.querySelectorAll('input[type="text"]').forEach(input => {
        const { section, key } = input.dataset;
        if (!sections[section]) {
            sections[section] = [];
        }
        sections[section].push(`${key} = ${input.value}`);
    });

    for (const sectionName in sections) {
        newContent += `[${sectionName}]\n`;
        newContent += sections[sectionName].join('\n');
        newContent += '\n\n';
    }

    return newContent.trim();
}

/**
 * 更新状态消息
 * @param {string} message 消息文本
 * @param {boolean} isError 是否是错误消息
 */
function updateStatus(message, isError = false) {
    statusMsg.textContent = message;
    statusMsg.className = isError ? 'status-error' : 'status-success';
    statusMsg.style.display = 'block';
}
