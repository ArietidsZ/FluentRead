/**
 * @file src/services/harness/memoryRecall.ts
 * 文件职责：把浏览器中由用户主动保存的学习记忆适配给 Harness 社区插件的纯检索内核。
 * 主要内容：映射本地时间与类型字段，优先保留一条最近的学习偏好，再按中英文词法相关度补充学习要点，总量不超过三条。
 * 模块边界：不采集网页、不写入记忆、不调用模型或向量服务；具体仓库由后台注入，开关与隐私窗口隔离由 Harness runtime 负责。
 */
import {hasMeaningfulQuery, rankRecords, type MemoryRecord} from '@/src/core/harness/memorySearch';
import type {LearningMemory} from './learningMemory';

export function createLearningMemoryRecall(store: {list(): Promise<LearningMemory[]>}) {
    return async (query: string): Promise<LearningMemory[]> => {
        const entries = await store.list();
        const preference = entries.filter(item => item.kind === 'preference').sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const records: MemoryRecord[] = entries.map(item => ({
            id: item.id, content: item.content, kind: item.kind, tags: [], scope: 'user', project: null,
            importance: 2, createdAt: new Date(item.createdAt).toISOString(), updatedAt: new Date(item.updatedAt).toISOString(),
            accessedAt: null, accessCount: 0, expiresAt: null,
        }));
        const relevant = hasMeaningfulQuery(query) ? rankRecords(records, query, 3) : [];
        const ids = new Set([...(preference ? [preference.id] : []), ...relevant.map(hit => hit.record.id)]);
        return [...ids].slice(0, 3).map(id => entries.find(item => item.id === id)!);
    };
}
