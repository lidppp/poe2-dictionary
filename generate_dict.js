const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { minify } = require('html-minifier');

// 浏览器模拟请求头 - 完全匹配 CURL
const DEFAULT_HEADERS = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
};

// HTTPS 请求函数
function httpsGet(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { ...DEFAULT_HEADERS, ...extraHeaders }
        };

        const req = https.request(options, (res) => {
            const chunks = [];

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];

                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decoded) => {
                        if (err) reject(err);
                        else resolve(decoded.toString('utf-8'));
                    });
                } else if (encoding === 'deflate') {
                    zlib.inflate(buffer, (err, decoded) => {
                        if (err) reject(err);
                        else resolve(decoded.toString('utf-8'));
                    });
                } else if (encoding === 'br') {
                    zlib.brotliDecompress(buffer, (err, decoded) => {
                        if (err) reject(err);
                        else resolve(decoded.toString('utf-8'));
                    });
                } else {
                    resolve(buffer.toString('utf-8'));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// 1. 获取首页，解析 header js 地址
async function fetchHeaderScriptUrl() {
    const headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
    };

    const html = await httpsGet('https://poe2db.tw/', headers);
    const regex = /<script\s+src="(https:\/\/cdn\.poe2db\.tw\/js\/poedb_header\.[a-f0-9]+\.js)"><\/script>/i;
    const match = html.match(regex);
    if (!match) throw new Error('未找到 header js 地址');
    return match[1];
}

// 2. 解析 header js，获取 CDN 地址和 JSON 映射
async function parseHeaderJs(scriptUrl) {
    const headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'referer': 'https://poe2db.tw/',
        'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'script',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
    };

    const jsCode = await httpsGet(scriptUrl, headers);

    // 获取 CDN 地址（取 isBeta() === true 时的地址）
    let cdnUrl = 'https://cdn.poe2db.tw/';
    const cdnRegex = /return\s+isBeta\(\)\s*\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/;
    const cdnMatch = jsCode.match(cdnRegex);
    if (cdnMatch) cdnUrl = cdnMatch[1];
    console.log(`   ✅ CDN地址 (beta模式): ${cdnUrl}`);

    // 获取 JSON 映射表
    const mappingRegex = /let\s+gets\s*=\s*\{([^}]+)\}/s;
    const mappingMatch = jsCode.match(mappingRegex);
    if (!mappingMatch) throw new Error('未找到 JSON 映射表');

    const mappingObj = new Function('return {' + mappingMatch[1] + '}')();

    return { cdnUrl, mapping: mappingObj };
}

// 3. 加载指定的 JSON 数据
async function loadJsonData(cdnUrl, mapping, keys) {
    const result = {};

    for (const key of keys) {
        const mappedFile = mapping[key];
        if (!mappedFile) {
            console.warn(`⚠️ 警告: 未找到映射 ${key}`);
            result[key] = [];
            continue;
        }

        const url = `${cdnUrl}json/${mappedFile}`;
        console.log(`📥 正在加载: ${url}`);

        const headers = {
            'accept': '*/*',
            'accept-language': 'zh-CN,zh;q=0.9',
            'cache-control': 'no-cache',
            'origin': 'https://poe2db.tw',
            'pragma': 'no-cache',
            'priority': 'u=1, i',
            'referer': 'https://poe2db.tw/',
            'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
        };

        try {
            const data = await httpsGet(url, headers);
            try {
                result[key] = JSON.parse(data);
                console.log(`   ✅ 成功: ${mappedFile} (${result[key].length} 条数据)`);
            } catch (parseErr) {
                console.error(`   ❌ JSON解析失败: ${mappedFile}`);
                console.error(`   错误: ${parseErr.message}`);
                result[key] = [];
            }
        } catch (err) {
            console.error(`   ❌ 请求失败: ${mappedFile} - ${err.message}`);
            result[key] = [];
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return result;
}

// 4. 生成 HTML 文件（压缩版）
function generateHtml(jsonData, versionInfo) {
    const templatePath = path.join(__dirname, 'template.html');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`模板文件不存在: ${templatePath}`);
    }

    let template = fs.readFileSync(templatePath, 'utf-8');

    const usData = jsonData['autocompletecb_us.json'] || [];
    const twData = jsonData['autocompletecb_tw.json'] || [];
    const cnData = jsonData['autocompletecb_cn.json'] || [];

    // 生成注入脚本（无换行、无多余空格）
    const dataScript = `<script>window.__DICT_DATA__={version:"${versionInfo.hash}",generatedAt:"${versionInfo.time}",us:${JSON.stringify(usData)},tw:${JSON.stringify(twData)},cn:${JSON.stringify(cnData)}};</script>`;

    // 替换占位符
    let finalHtml = template.replace('<!-- {{DICT_DATA_PLACEHOLDER}} -->', dataScript);

    // 压缩 HTML
    const minifiedHtml = minify(finalHtml, {
        collapseWhitespace: true,        // 合并空白字符
        removeComments: true,            // 移除注释
        removeRedundantAttributes: true, // 移除冗余属性
        removeScriptTypeAttributes: true, // 移除 script 的 type 属性
        removeStyleLinkTypeAttributes: true, // 移除 style/link 的 type 属性
        useShortDoctype: true,           // 使用短 DOCTYPE
        removeEmptyAttributes: true,     // 移除空属性
        removeOptionalTags: true,        // 移除可选标签
        minifyCSS: true,                 // 压缩 CSS
        minifyJS: true,                  // 压缩 JS
        sortAttributes: true,            // 排序属性
        sortClassName: true,             // 排序 class 名
        decodeEntities: true,            // 解码实体
        collapseBooleanAttributes: true, // 压缩布尔属性
        removeAttributeQuotes: true      // 移除属性引号（安全情况）
    });

    const outputFile = path.join(__dirname, 'index.html');
    fs.writeFileSync(outputFile, minifiedHtml, 'utf-8');

    const originalSize = (Buffer.byteLength(finalHtml, 'utf-8') / 1024).toFixed(2);
    const minifiedSize = (Buffer.byteLength(minifiedHtml, 'utf-8') / 1024).toFixed(2);
    const compression = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

    console.log(`\n✅ 生成成功: ${outputFile}`);
    console.log(`📊 文件大小: ${originalSize} KB → ${minifiedSize} KB (压缩 ${compression}%)`);
    console.log(`📊 数据统计:`);
    console.log(`   🇺🇸 US服: ${usData.length} 条`);
    console.log(`   🇹🇼 TW服: ${twData.length} 条`);
    console.log(`   🇨🇳 CN服: ${cnData.length} 条`);
    console.log(`🔖 版本标识: ${versionInfo.hash}`);
    console.log(`⏰ 生成时间: ${versionInfo.time}`);
}

function extractHash(mapping, key) {
    const file = mapping[key];
    if (!file) return 'unknown';
    const match = file.match(/[a-f0-9]{16}/);
    return match ? match[0] : 'unknown';
}

async function main() {
    console.log('🚀 流放字典数据更新工具');
    console.log('=' .repeat(50));

    try {
        console.log('\n📡 步骤 1/4: 获取最新脚本地址...');
        const headerUrl = await fetchHeaderScriptUrl();
        console.log(`   ✅ 地址: ${headerUrl}`);

        console.log('\n🔧 步骤 2/4: 解析配置文件...');
        const { cdnUrl, mapping } = await parseHeaderJs(headerUrl);
        console.log(`   ✅ 映射表条目: ${Object.keys(mapping).length}`);

        console.log('\n📦 步骤 3/4: 加载语言数据...');
        const jsonData = await loadJsonData(cdnUrl, mapping, [
            'autocompletecb_us.json',
            'autocompletecb_tw.json',
            'autocompletecb_cn.json'
        ]);

        const usHash = extractHash(mapping, 'autocompletecb_us.json');
        const twHash = extractHash(mapping, 'autocompletecb_tw.json');
        const cnHash = extractHash(mapping, 'autocompletecb_cn.json');

        console.log('\n🎨 步骤 4/4: 生成 HTML 文件...');
        generateHtml(jsonData, {
            hash: `${usHash} / ${twHash} / ${cnHash}`,
            time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        });

        console.log('\n' + '=' .repeat(50));
        console.log('🎉 完成！打开生成的 "index.html" 即可使用');
        console.log('💡 提示: 游戏版本更新后，重新运行本脚本即可获取最新数据');

    } catch (error) {
        console.error('\n❌ 错误:', error.message);
        console.error('\n可能的解决方案:');
        console.error('1. 检查网络连接');
        console.error('2. 确认 https://poe2db.tw 可以访问');
        console.error('3. 稍后重试（可能有临时限制）');
        process.exit(1);
    }
}

process.on('uncaughtException', (error) => {
    console.error('\n💥 未捕获的异常:', error.message);
    process.exit(1);
});

main();
