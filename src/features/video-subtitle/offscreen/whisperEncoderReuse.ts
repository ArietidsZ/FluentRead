/**
 * @file src/features/video-subtitle/offscreen/whisperEncoderReuse.ts
 * 文件职责：适配锁定的 Transformers.js 3.8.1，将一个完整 Whisper 音频窗的编码张量交给语言检测与原有转写流水线共用。
 * 主要内容：核对模型实例与私有编码契约，临时允许生成接口接收 encoder_outputs，补齐上游遗漏的请求停止条件，并准确恢复实例配置和释放张量。
 * 模块边界：不修改库原型、不缓存跨窗张量、不复制上游解码或后处理；编码不兼容时执行原有检测，停止契约不兼容时明确拒绝。
 */

interface EncoderTensor {
  readonly dims: readonly number[];
  dispose(): void;
}

/** 仅描述 3.8.1 的实例接口；升级库版本必须重新核对，而不是尝试猜测私有 API。 */
export interface WhisperEncoderReuseModel {
  config?: {model_type?: unknown; is_encoder_decoder?: unknown};
  main_input_name?: unknown;
  forward_params?: unknown;
  _get_stopping_criteria?: (generationConfig: unknown, stoppingCriteria?: unknown) => WhisperStoppingCriteriaList;
  _prepare_encoder_decoder_kwargs_for_generation?: (parameters: {
    inputs_tensor: unknown;
    model_inputs: Record<string, unknown>;
    model_input_name: string;
    generation_config: {guidance_scale: null};
  }) => Promise<Record<string, unknown>>;
}

interface WhisperStoppingCriteriaList {
  readonly criteria: unknown[];
  push(criterion: unknown): void;
}

const activeStoppingRequests = new WeakSet<WhisperEncoderReuseModel>();

/**
 * 3.8.1 Whisper.generate 在解构后遗漏 stopping_criteria，底层 decoder loop
 * 却仍经实例 _get_stopping_criteria 建立原有长度/EOS 条件。在一个串行
 * pipeline 调用内补入该请求的中断条件，保留所有原条件并恢复属性归属。
 * https://github.com/huggingface/transformers.js/blob/3.8.1/src/models.js#L3464
 */
export async function withWhisperStoppingCriteria<T>(
  model: WhisperEncoderReuseModel | undefined,
  stoppingCriteria: unknown,
  libraryVersion: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  const original = model?._get_stopping_criteria;
  if (libraryVersion !== '3.8.1' || model?.config?.model_type !== 'whisper'
    || typeof original !== 'function') throw new Error('Whisper 请求停止条件契约不兼容');
  if (activeStoppingRequests.has(model)) throw new Error('Whisper 请求停止条件不能并发或跨请求使用');
  const descriptor = Object.getOwnPropertyDescriptor(model, '_get_stopping_criteria');
  if (descriptor && !descriptor.configurable) throw new Error('Whisper 请求停止条件接口不可恢复');
  Object.defineProperty(model, '_get_stopping_criteria', {
    configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false,
    value(this: WhisperEncoderReuseModel, generationConfig: unknown, existing?: unknown) {
      const criteria = original.call(this, generationConfig, existing);
      if (!Array.isArray(criteria?.criteria) || typeof criteria.push !== 'function') {
        throw new Error('Whisper 请求停止条件接口未返回有效列表');
      }
      if (!criteria.criteria.includes(stoppingCriteria)) criteria.push(stoppingCriteria);
      return criteria;
    },
  });
  activeStoppingRequests.add(model);
  try {
    return await operation();
  } finally {
    if (descriptor) Object.defineProperty(model, '_get_stopping_criteria', descriptor);
    else delete model._get_stopping_criteria;
    activeStoppingRequests.delete(model);
  }
}

export interface WhisperEncoderReuse {
  readonly encoderOutputs: unknown;
  /** 检测用 forward 直接接收此张量；其 KV 不参与后续转写。 */
  readonly modelInputs: Record<string, unknown>;
  /** 只允许一个无内部分块的 pipeline 调用；调用期间扩展当前实例的生成输入白名单。 */
  transcribe<T>(options: Record<string, unknown>, operation: (options: Record<string, unknown>) => Promise<T>): Promise<T>;
  dispose(): void;
}

/**
 * 上游契约：models.js 1635–1683 编码入口，1616 的输入白名单、1758 的复用分支；
 * pipelines.js 1881 保留 generation kwargs 并调用原有 generate 和 tokenizer 后处理。
 * https://github.com/huggingface/transformers.js/blob/3.8.1/src/models.js
 * https://github.com/huggingface/transformers.js/blob/3.8.1/src/pipelines.js
 */
export async function prepareWhisperEncoderReuse(
  model: WhisperEncoderReuseModel,
  processed: Record<string, unknown>,
  libraryVersion: unknown,
): Promise<WhisperEncoderReuse | null> {
  const feature = processed.input_features as {dims?: readonly number[]} | undefined;
  const forwardParams = model.forward_params;
  if (libraryVersion !== '3.8.1' || model.config?.model_type !== 'whisper'
    || model.config.is_encoder_decoder !== true || model.main_input_name !== 'input_features'
    || !Array.isArray(forwardParams) || !forwardParams.includes('input_features')
    || typeof model._prepare_encoder_decoder_kwargs_for_generation !== 'function'
    || feature?.dims?.[0] !== 1) return null;

  const encoded = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: feature,
    model_inputs: {...processed},
    model_input_name: 'input_features',
    // 生产贪心解码无 classifier-free guidance，也没有跨 batch 扩展。
    generation_config: {guidance_scale: null},
  });
  const tensor = encoded.encoder_outputs as EncoderTensor | undefined;
  if (!tensor || typeof tensor.dispose !== 'function') throw new Error('Whisper 编码复用契约缺少可释放的 encoder_outputs');
  if (!Array.isArray(tensor.dims) || tensor.dims.length !== 3 || tensor.dims[0] !== 1) {
    tensor.dispose();
    throw new Error('Whisper 编码复用只支持一个完整音频窗');
  }

  let disposed = false;
  let transcribing = false;
  return {
    encoderOutputs: tensor,
    modelInputs: {encoder_outputs: tensor},
    async transcribe(options, operation) {
      if (disposed || transcribing || Number(options.chunk_length_s || 0) > 0) {
        throw new Error('Whisper 编码复用不能跨请求、并发或内部分块使用');
      }
      // Whisper 3.8.1 的 forward_params 原本会静默丢弃 encoder_outputs。
      // Worker 的 dispatcher 保证模型实例串行；必须在 await 的 finally 恢复原数组引用。
      transcribing = true;
      const previous = model.forward_params;
      model.forward_params = [...forwardParams, 'encoder_outputs'];
      try {
        return await operation({...options, encoder_outputs: tensor});
      } finally {
        model.forward_params = previous;
        transcribing = false;
      }
    },
    dispose() {
      if (transcribing) throw new Error('Whisper 转写尚未结束，不能释放编码张量');
      if (!disposed) {
        disposed = true;
        tensor.dispose();
      }
    },
  };
}
