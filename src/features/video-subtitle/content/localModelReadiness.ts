/**
 * @file src/features/video-subtitle/content/localModelReadiness.ts
 * 文件职责：读取本地视频模型缓存状态并判断当前模型是否可以启动。
 * 主要内容：规范化模型标识、校验后台响应结构和区分“未下载”与“状态读取失败”。
 * 模块边界：只调用注入的消息端口，不读取 DOM、storage 或播放器状态。
 */
import {
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE,
  type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/transcription';

export type LocalVideoModelReadiness = 'ready' | 'missing';
export type LocalVideoModelStatusSender = (message: {
  type: typeof VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE;
}) => Promise<unknown>;

export const LOCAL_VIDEO_MODEL_STATUS_ERROR = '无法读取模型状态，请重试';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidModelList(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  return value.every((model) => typeof model === 'string'
    && normalizeVideoLocalTranscriptionModels([model]).length === 1);
}

function isStatusResponse(value: unknown): value is {success: true; models: unknown[]} {
  return isRecord(value) && value.success === true && isValidModelList(value.models);
}

/**
 * 请求后台返回的已缓存模型状态。后台不可用、返回失败或数据损坏都必须
 * 明确报错，避免把暂时无法读取误导成“模型尚未下载”。
 */
export async function requestLocalVideoModelReadiness(
  model: unknown,
  sendMessage: LocalVideoModelStatusSender,
): Promise<LocalVideoModelReadiness> {
  const normalizedModel: VideoLocalTranscriptionModel = normalizeVideoLocalTranscriptionModel(model);
  let response: unknown;
  try {
    response = await sendMessage({type: VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE});
  } catch {
    throw new Error(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  }

  if (!isStatusResponse(response)) throw new Error(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  const models = normalizeVideoLocalTranscriptionModels(response.models);
  return models.includes(normalizedModel) ? 'ready' : 'missing';
}
