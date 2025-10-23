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
 * (纯前端调试版)
 * 使用 allorigins.win 作为 CORS 代理，从雅虎财经获取期权到期日。
 * 增加了详细的控制台日志，以便于排查问题。
 */
async function fetchAndPopulateDates(tickerInput, dateSelect) {
    const ticker = tickerInput.value.trim().toUpperCase();
    if (!ticker) return;

    dateSelect.disabled = true;
    dateSelect.innerHTML = '<option>加载中...</option>';

    const targetUrl = encodeURIComponent(`https://finance.yahoo.com/quote/${ticker}/options`);
    const proxyUrl = `https://api.allorigins.win/get?url=${targetUrl}`;

    try {
        const response = await fetch(proxyUrl, { cache: 'no-cache' }); // 添加 no-cache 避免浏览器缓存旧的失败请求
        if (!response.ok) {
            throw new Error(`代理服务网络响应错误: ${response.statusText} (状态码: ${response.status})`);
        }

        const data = await response.json();
        const htmlContent = data.contents;

        // --- 关键调试步骤 ---
        // 在控制台打印从代理获取到的原始 HTML 内容
        console.log('--- 从代理获取的原始HTML内容 ---');
        console.log(htmlContent);
        console.log('------------------------------');

        if (!htmlContent) {
            throw new Error('代理未能获取到任何内容。目标网站可能拒绝了代理的访问，或者Ticker无效。');
        }

        // 使用一个稍微更健壮的非贪婪正则表达式
        const match = htmlContent.match(/root\.App\.main\s*=\s*({.*?});/);
        if (!match || !match[1]) {
            throw new Error('无法在返回的HTML中找到 "root.App.main" 数据块。雅虎财经页面结构可能已更新。');
        }

        const yahooData = JSON.parse(match[1]);

        const timestamps = yahooData?.context?.dispatcher?.stores?.OptionContractsStore?.expirationDates;

        if (!timestamps || timestamps.length === 0) {
            dateSelect.innerHTML = '<option>无可用日期</option>';
        } else {
            dateSelect.innerHTML = '';
            const dates = timestamps.map(ts => new Date(ts * 1000).toISOString().split('T')[0]);
            dates.forEach(dateStr => {
                const option = document.createElement('option');
                option.value = dateStr;
                option.textContent = dateStr;
                dateSelect.appendChild(option);
            });
        }
        dateSelect.disabled = false;

    } catch (error) {
        // --- 增强的错误处理 ---
        console.error('获取期权日期时发生严重错误:', error);
        // 在UI上给用户更明确的指示
        dateSelect.innerHTML = `<option>加载失败,请按F12查看控制台</option>`;
    }
}


/**
 * 在指定分区下添加新行。
 * (此函数与上一个方案中的版本完全相同，核心是为 tickerInput 添加事件监听)
 */
function addNewRow(sectionDiv) {
    const sectionTitle = sectionDiv.querySelector('h3').textContent;
    const addBtn = sectionDiv.querySelector('.add-btn');

    if (sectionTitle === 'OptionsPortfolio') {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'option-item-row';

        const tickerInput = document.createElement('input');
        tickerInput.type = 'text';
        tickerInput.placeholder = 'Ticker';
        tickerInput.className = 'option-ticker-input';

        const dateSelect = document.createElement('select');
        dateSelect.className = 'option-date-select';
        dateSelect.disabled = true;
        dateSelect.innerHTML = '<option>先输入Ticker</option>';

        // 核心逻辑：当 Ticker 输入框内容改变并失焦时，触发数据获取
        tickerInput.addEventListener('change', () => {
            fetchAndPopulateDates(tickerInput, dateSelect);
        });

        const strikeInput = document.createElement('input');
        strikeInput.type = 'number';
        strikeInput.placeholder = 'Strike';
        strikeInput.className = 'option-strike-input';

        const typeSelect = document.createElement('select');
        typeSelect.className = 'option-type-select';
        ['CALL', 'PUT'].forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            typeSelect.appendChild(option);
        });

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.placeholder = '数量';
        valueInput.className = 'value-input';

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '删除';
        removeBtn.className = 'remove-btn';
        removeBtn.onclick = () => itemDiv.remove();

        itemDiv.appendChild(tickerInput);
        itemDiv.appendChild(dateSelect);
        itemDiv.appendChild(strikeInput);
        itemDiv.appendChild(typeSelect);
        itemDiv.appendChild(valueInput);
        itemDiv.appendChild(removeBtn);

        sectionDiv.insertBefore(itemDiv, addBtn);

    } else {
        // 其他分区逻辑不变
        const itemDiv = document.createElement('div');
        itemDiv.className = 'portfolio-item';
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = '股票代码 (例如: AAPL)';
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
