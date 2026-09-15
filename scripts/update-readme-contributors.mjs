import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// 用 GitHub 头像刷新 README 中的贡献者列表；第三方头像服务在 GitHub 渲染时容易超时。
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = 'FluentRead/FluentRead';
const readmes = ['README.md', 'misc/README_ZH.md'];
const start = '<!-- contributors:start -->';
const end = '<!-- contributors:end -->';

const headers = {Accept: 'application/vnd.github+json', 'User-Agent': 'fluentread-readme-contributors'};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const contributors = [];
for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/contributors?per_page=100&page=${page}`, {headers});
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    const batch = await response.json();
    contributors.push(...batch.filter(user => user.type === 'User'));
    if (batch.length < 100) break;
}

const avatars = contributors.map(({login, id}) =>
    `<a href="https://github.com/${login}"><img src="https://avatars.githubusercontent.com/u/${id}?s=96&v=4" width="48" height="48" alt="${login}" /></a>`,
).join('');

for (const name of readmes) {
    const file = resolve(root, name);
    const content = await readFile(file, 'utf8');
    const from = content.indexOf(start);
    const to = content.indexOf(end);
    if (from < 0 || to < from) throw new Error(`Missing contributor markers in ${name}`);
    await writeFile(file, `${content.slice(0, from + start.length)}\n${avatars}\n${content.slice(to)}`);
}
console.log(`Updated ${contributors.length} contributors in ${readmes.join(', ')}`);
