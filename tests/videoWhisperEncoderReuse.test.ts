import {describe, expect, it, vi} from 'vitest';
import {prepareWhisperEncoderReuse, withWhisperStoppingCriteria, type WhisperEncoderReuseModel} from '@/src/features/video-subtitle/offscreen/whisperEncoderReuse';

function fixture() {
  const tensor = {dims: [1, 1500, 384], dispose: vi.fn()};
  const processed = {input_features: {dims: [1, 80, 3000]}};
  const forwardParams = ['input_features', 'decoder_input_ids'];
  const model: WhisperEncoderReuseModel = {
    config: {model_type: 'whisper', is_encoder_decoder: true},
    main_input_name: 'input_features',
    forward_params: forwardParams,
    _prepare_encoder_decoder_kwargs_for_generation: vi.fn(async parameters => ({...parameters.model_inputs, encoder_outputs: tensor})),
  };
  return {model, processed, tensor, forwardParams};
}

describe('Whisper 3.8.1 单窗编码适配', () => {
  it.each([
    ['库升级', (f: ReturnType<typeof fixture>) => f, '3.8.2'],
    ['无配置', (f: ReturnType<typeof fixture>) => {delete f.model.config; return f;}],
    ['其他模型', (f: ReturnType<typeof fixture>) => {f.model.config!.model_type = 'other'; return f;}],
    ['非编码解码模型', (f: ReturnType<typeof fixture>) => {f.model.config!.is_encoder_decoder = false; return f;}],
    ['输入名称变化', (f: ReturnType<typeof fixture>) => {f.model.main_input_name = 'input_ids'; return f;}],
    ['无输入白名单', (f: ReturnType<typeof fixture>) => {f.model.forward_params = null; return f;}],
    ['白名单缺少特征', (f: ReturnType<typeof fixture>) => {f.model.forward_params = []; return f;}],
    ['无编码接口', (f: ReturnType<typeof fixture>) => {delete f.model._prepare_encoder_decoder_kwargs_for_generation; return f;}],
    ['没有特征', (f: ReturnType<typeof fixture>) => {f.processed = {} as any; return f;}],
    ['特征没有形状', (f: ReturnType<typeof fixture>) => {f.processed = {input_features: {}} as any; return f;}],
    ['多 batch', (f: ReturnType<typeof fixture>) => {f.processed.input_features.dims[0] = 2; return f;}],
  ] as const)('不兼容时不执行编码：%s', async (_name, change, version?: string) => {
    const f = change(fixture());
    const operation = f.model._prepare_encoder_decoder_kwargs_for_generation;
    expect(await prepareWhisperEncoderReuse(f.model, f.processed, version || '3.8.1')).toBeNull();
    if (operation) expect(operation).not.toHaveBeenCalled();
  });

  it('完整特征只编码一次，生成保留其余参数并恢复原白名单数组，释放幂等', async () => {
    const f = fixture();
    const originalProcessed = {...f.processed};
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    expect(f.model._prepare_encoder_decoder_kwargs_for_generation).toHaveBeenCalledWith({
      inputs_tensor: f.processed.input_features, model_inputs: originalProcessed,
      model_input_name: 'input_features', generation_config: {guidance_scale: null},
    });
    expect(f.processed).toEqual(originalProcessed);
    expect(lease.encoderOutputs).toBe(f.tensor);
    expect(lease.modelInputs).toEqual({encoder_outputs: f.tensor});
    const options = {num_beams: 1, language: 'ja', max_new_tokens: 64};
    const returned = await lease.transcribe(options, async actual => {
      expect(actual).toEqual({...options, encoder_outputs: f.tensor});
      expect(f.model.forward_params).toEqual([...f.forwardParams, 'encoder_outputs']);
      expect(f.tensor.dispose).not.toHaveBeenCalled();
      return '字幕';
    });
    expect(returned).toBe('字幕');
    expect(options).not.toHaveProperty('encoder_outputs');
    expect(f.model.forward_params).toBe(f.forwardParams);
    expect(f.model._prepare_encoder_decoder_kwargs_for_generation).toHaveBeenCalledTimes(1);
    lease.dispose();
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
    await expect(lease.transcribe({}, async () => null)).rejects.toThrow('跨请求');
  });

  it('生成抛错也恢复白名单，调用方仍能释放张量', async () => {
    const f = fixture();
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    await expect(lease.transcribe({chunk_length_s: 0}, async () => {throw new Error('decoder failed');})).rejects.toThrow('decoder failed');
    expect(f.model.forward_params).toBe(f.forwardParams);
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
  });

  it('拒绝同时生成、生成期间释放和内部分块，拒绝后原租约可继续使用', async () => {
    const f = fixture();
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    await expect(lease.transcribe({chunk_length_s: 10}, async () => null)).rejects.toThrow('内部分块');
    await lease.transcribe({}, async () => {
      await expect(lease.transcribe({}, async () => null)).rejects.toThrow('并发');
      expect(() => lease.dispose()).toThrow('尚未结束');
    });
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined, {}, {dispose: 'not a function'},
  ])('编码接口未返回可释放张量时报契约错误，不能默默重复编码：%s', async output => {
    const f = fixture();
    f.model._prepare_encoder_decoder_kwargs_for_generation = vi.fn(async () => ({encoder_outputs: output}));
    await expect(prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1')).rejects.toThrow('可释放');
  });

  it.each([undefined, [1, 2], [2, 1500, 384]])('形状不符合单窗契约时先释放：%s', async dims => {
    const f = fixture();
    f.tensor.dims = dims as any;
    await expect(prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1')).rejects.toThrow('完整音频窗');
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
  });

  it('编码计算错误交给现有后端恢复，不能吞掉错误再次推理', async () => {
    const f = fixture();
    f.model._prepare_encoder_decoder_kwargs_for_generation = vi.fn(async () => {throw new Error('encoder failed');});
    await expect(prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1')).rejects.toThrow('encoder failed');
  });
});

describe('Whisper 3.8.1 请求停止条件适配', () => {
  function stoppingFixture(inherited = false) {
    const previousCriteria = [vi.fn(() => [false]), vi.fn(() => [false])];
    const original = vi.fn(function (this: WhisperEncoderReuseModel, _config: unknown, existing?: unknown) {
      expect(this).toBe(model);
      const criteria = [...previousCriteria, ...(existing ? [existing] : [])];
      return {criteria, push(item: unknown) {criteria.push(item as any);}};
    });
    const model: WhisperEncoderReuseModel = inherited ? Object.create({_get_stopping_criteria: original}) : {_get_stopping_criteria: original};
    model.config = {model_type: 'whisper'};
    return {model, original, previousCriteria};
  }

  it.each(['3.8.2', undefined])('未知版本明确拒绝，不执行生成：%s', async version => {
    const f = stoppingFixture();
    const operation = vi.fn(async () => null);
    await expect(withWhisperStoppingCriteria(f.model, {}, version, operation)).rejects.toThrow('契约不兼容');
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, {config: {model_type: 'other'}, _get_stopping_criteria: vi.fn()}, {config: {model_type: 'whisper'}}])('缺少实际 Whisper hook 时拒绝：%s', async model => {
    await expect(withWhisperStoppingCriteria(model, {}, '3.8.1', async () => null)).rejects.toThrow('契约不兼容');
  });

  it.each([false, true])('保留原条件、去重注入，并恢复实例原属性归属（继承：%s）', async inherited => {
    const f = stoppingFixture(inherited), stop = () => [false];
    const descriptor = Object.getOwnPropertyDescriptor(f.model, '_get_stopping_criteria');
    await withWhisperStoppingCriteria(f.model, stop, '3.8.1', async () => {
      expect(f.model._get_stopping_criteria).not.toBe(f.original);
      const result = f.model._get_stopping_criteria!({max_length: 443}, stop);
      expect(result.criteria).toEqual([...f.previousCriteria, stop]);
      expect(result.criteria.filter(value => value === stop)).toHaveLength(1);
    });
    expect(f.model._get_stopping_criteria).toBe(f.original);
    expect(Object.getOwnPropertyDescriptor(f.model, '_get_stopping_criteria')).toEqual(descriptor);
  });

  it('定时中断实际异步生成循环，未到长度上限即停止并恢复接口', async () => {
    vi.useFakeTimers();
    try {
      const f = stoppingFixture(true);
      let interrupted = false, iterations = 0;
      const stop = () => [interrupted];
      const timer = setTimeout(() => {interrupted = true;}, 4);
      const operation = withWhisperStoppingCriteria(f.model, stop, '3.8.1', async () => {
        const criteria = f.model._get_stopping_criteria!({max_length: 443});
        while (iterations < 440 && !criteria.criteria.some(criterion => (criterion as () => boolean[])()[0])) {
          await new Promise(resolve => setTimeout(resolve, 1));
          iterations++;
        }
        return iterations;
      });
      await vi.advanceTimersByTimeAsync(5);
      expect(await operation).toBe(4);
      expect(iterations).toBeLessThan(440);
      expect(f.model._get_stopping_criteria).toBe(f.original);
      clearTimeout(timer);
    } finally {vi.useRealTimers();}
  });

  it('与共享 encoder lease 嵌套时独立恢复，生成失败释放后仍可再次使用', async () => {
    const f = fixture(), s = stoppingFixture();
    f.model._get_stopping_criteria = s.original.bind(s.model);
    const original = f.model._get_stopping_criteria;
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    await expect(lease.transcribe({}, async () => withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => {
      expect(f.model.forward_params).toEqual([...f.forwardParams, 'encoder_outputs']);
      throw new Error('decoder failed');
    }))).rejects.toThrow('decoder failed');
    expect(f.model._get_stopping_criteria).toBe(original);
    expect(f.model.forward_params).toBe(f.forwardParams);
    await withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => null);
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledOnce();
  });

  it('拒绝同一实例并发，但允许不同实例，并在异常后恢复', async () => {
    const a = stoppingFixture(), b = stoppingFixture();
    await withWhisperStoppingCriteria(a.model, {}, '3.8.1', async () => {
      await expect(withWhisperStoppingCriteria(a.model, {}, '3.8.1', async () => null)).rejects.toThrow('并发');
      expect(await withWhisperStoppingCriteria(b.model, {}, '3.8.1', async () => 'other')).toBe('other');
    });
    await expect(withWhisperStoppingCriteria(a.model, {}, '3.8.1', async () => {throw new Error('operation failed');})).rejects.toThrow('operation failed');
    expect(a.model._get_stopping_criteria).toBe(a.original);
    expect(b.model._get_stopping_criteria).toBe(b.original);
  });

  it('不可恢复的 own hook 提前拒绝，不改变实例', async () => {
    const f = stoppingFixture();
    Object.defineProperty(f.model, '_get_stopping_criteria', {configurable: false});
    await expect(withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => null)).rejects.toThrow('不可恢复');
    expect(f.model._get_stopping_criteria).toBe(f.original);
  });

  it.each([null, {criteria: null, push: vi.fn()}, {criteria: []}])('原 hook 契约不符时拒绝，并恢复接口：%s', async output => {
    const f = stoppingFixture();
    f.model._get_stopping_criteria = vi.fn(() => output as any);
    const original = f.model._get_stopping_criteria;
    await expect(withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => f.model._get_stopping_criteria!({}))).rejects.toThrow('有效列表');
    expect(f.model._get_stopping_criteria).toBe(original);
  });
});
