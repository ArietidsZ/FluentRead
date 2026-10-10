/**
 * @file src/features/information-highlight/offscreen/artifacts.ts
 * 文件职责：把固定信息高亮模型清单接到通用校验分块缓存。
 * 主要内容：专属缓存名、固定官方 canonical URL 与离线读取端口；没有原文或云端分析请求。
 * 模块边界：仅组合纯清单和 platform 存储，不依赖其他 feature 的模型缓存，不初始化模型。
 */
import {INFORMATION_HIGHLIGHT_MODEL, INFORMATION_HIGHLIGHT_MODEL_FILES, INFORMATION_HIGHLIGHT_MODEL_REVISION} from '@/src/core/config/informationHighlightModel';
import {createModelArtifactStore} from '@/src/platform/storage/modelArtifacts';
export const INFORMATION_HIGHLIGHT_CACHE = 'fluent-read-information-highlight-model-v1';
export const informationHighlightArtifacts = INFORMATION_HIGHLIGHT_MODEL_FILES.map(file => ({...file, url: `https://huggingface.co/${INFORMATION_HIGHLIGHT_MODEL}/resolve/${INFORMATION_HIGHLIGHT_MODEL_REVISION}/${file.path}`}));
export const informationHighlightArtifactStore = createModelArtifactStore(INFORMATION_HIGHLIGHT_CACHE, informationHighlightArtifacts);
