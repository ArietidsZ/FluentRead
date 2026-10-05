import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LOCAL_TRANSLATION_MODEL_IDS as ids} from '@/src/core/config/localTranslation';

const fake = vi.hoisted(() => ({
  bytes: new Map<string, number>(), complete: new Set<string>(),
  gates: new Map<string, () => void>(), download: vi.fn(), remove: vi.fn(),
  supported: true, shared: false, gpu: vi.fn(),
  legacyCached: false,
}));
vi.mock('@/src/features/local-translation/offscreen/opusGpu', () => ({requireOpusGpu:fake.gpu}));
vi.mock('@/src/platform/browser/localTranslationSupport', () => ({supportsHunyuanTranslation: () => fake.supported}));
vi.mock('@/src/features/local-translation/offscreen/artifactStore', () => ({
  LOCAL_MODEL_CACHE: 'download-test-cache',
  getTranslationArtifacts: (model: string) => fake.shared && [ids.opusZhEn, ids.opusZhEnGpu].includes(model as any)
    ? [{repo:'shared', path:'tokenizer.json', size:12, revision:'fixed', sha256:'hash'}, {repo:model, path:'weights', size:12, revision:'fixed', sha256:'hash'}]
    : [ids.opusZhEn, ids.opusJaEn, ids.hunyuan, ids.index].includes(model as any)
    ? [{repo: model, path: 'weights', size: 12, revision: 'fixed', sha256: 'hash'}] : [],
  artifactComplete: async (file: {repo: string}) => fake.complete.has(file.repo),
  artifactDownloadedBytes: async (file: {repo: string}) => fake.bytes.get(file.repo) || 0,
  downloadTranslationArtifact: (...args: any[]) => fake.download(...args),
  removeTranslationArtifact: (...args: any[]) => fake.remove(...args),
}));
vi.mock('@/src/features/local-translation/offscreen/modelCache', () => ({
  isLocalTranslationModelCached: async () => fake.legacyCached,
  removeLocalTranslationModelFiles: vi.fn(async () => undefined),
}));
import {createLocalTranslationDownloadManager} from '@/src/features/local-translation/offscreen/downloads';

const entries = new Map<string, Response>();
beforeEach(() => {
  fake.bytes.clear(); fake.complete.clear(); fake.gates.clear(); entries.clear();
  fake.supported = true; fake.shared = false; fake.gpu.mockReset().mockResolvedValue(undefined);
  fake.legacyCached = false;
  vi.stubGlobal('navigator', {storage: {estimate: async () => ({quota: 10_000_000_000, usage: 0})}});
  vi.stubGlobal('caches', {open: async () => ({
    match: async (key: string) => entries.get(key)?.clone(),
    put: async (key: string, value: Response) => { entries.set(key, value.clone()); },
  })});
  fake.download.mockReset().mockImplementation((file, signal: AbortSignal, progress) => new Promise<void>((resolve, reject) => {
    fake.bytes.set(file.repo, 4);
    progress(4, false);
    signal.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), {once: true});
    fake.gates.set(file.repo, () => {
      fake.bytes.set(file.repo, 12); fake.complete.add(file.repo); progress(12, true); resolve();
    });
  }));
  fake.remove.mockReset().mockImplementation(async (file) => { fake.bytes.delete(file.repo); fake.complete.delete(file.repo); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const phase = async (manager: ReturnType<typeof createLocalTranslationDownloadManager>, model = ids.opusZhEn as string) => (await manager.status()).tasks.find((task) => task.model === model)?.phase;

describe('page-independent local model jobs', () => {
  it('does not revive a cancelled queued job when its original state write fails late', async () => {
    const manager = createLocalTranslationDownloadManager();
    await manager.status();
    const open = caches.open.bind(caches);
    let rejectWrite!: (error: Error) => void;
    let first = true;
    vi.spyOn(caches, 'open').mockImplementation(async (name) => {
      const cache = await open(name);
      const put = cache.put.bind(cache);
      cache.put = async (key, value) => {
        if (first) { first = false; await new Promise((_resolve, reject) => { rejectWrite = reject; }); }
        return put(key, value);
      };
      return cache;
    });
    const start = expect(manager.start(ids.opusZhEn)).rejects.toThrow('late disk failure');
    await vi.waitFor(() => expect(rejectWrite).toBeTypeOf('function'));
    const paused = manager.pause(ids.opusZhEn);
    await Promise.resolve();
    rejectWrite(new Error('late disk failure'));
    await start; await paused;
    expect(await phase(manager)).toBe('paused');
    expect(fake.download).not.toHaveBeenCalled();
  });
  it('turns a failed queued-state write into a recoverable storage error', async () => {
    const manager = createLocalTranslationDownloadManager();
    await manager.status();
    const open = caches.open.bind(caches);
    let writes = 0;
    vi.spyOn(caches, 'open').mockImplementation(async (name) => {
      const cache = await open(name);
      const put = cache.put.bind(cache);
      cache.put = async (key, value) => {
        if (++writes === 1) throw new Error('disk full');
        return put(key, value);
      };
      return cache;
    });
    await expect(manager.start(ids.opusZhEn)).rejects.toThrow('disk full');
    await vi.waitFor(async () => expect(await phase(manager)).toBe('error'));
    expect(fake.download).not.toHaveBeenCalled();
  });

  it('stops before fetching when paused during storage estimation', async () => {
    let estimate!: (value: object) => void;
    vi.stubGlobal('navigator', {storage: {estimate: () => new Promise((resolve) => { estimate = resolve; })}});
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.opusZhEn);
    await vi.waitFor(() => expect(estimate).toBeTypeOf('function'));
    await manager.pause(ids.opusZhEn);
    estimate({});
    await vi.waitFor(async () => expect(await phase(manager)).toBe('paused'));
    expect(fake.download).not.toHaveBeenCalled();
  });

  it('does not perform preflight if the queued controller is already aborted', async () => {
    const OriginalController = AbortController;
    vi.stubGlobal('AbortController', class extends OriginalController { constructor() { super(); this.abort(); } });
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.opusZhEn);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.download).not.toHaveBeenCalled();
  });
  it('restores completed models and keeps legacy models removable but not downloadable', async () => {
    fake.complete.add(ids.opusZhEn);
    fake.legacyCached = true;
    const manager = createLocalTranslationDownloadManager({onChange: async () => { throw new Error('page closed'); }});
    expect(await phase(manager)).toBe('ready');
    expect(await phase(manager, ids.m2m100)).toBe('ready');
    await expect(manager.start(ids.m2m100)).rejects.toThrow('LEGACY_MODEL');
    await expect(manager.start('unknown')).rejects.toThrow('INVALID_MODEL');
    await manager.remove(ids.m2m100);
    expect(await phase(manager, ids.m2m100)).toBe('idle');
    await manager.pause(ids.opusZhEn);
    expect(await phase(manager)).toBe('ready');
  });

  it.each([
    [new Error('LOCAL_TRANSLATION_INTEGRITY'), 'integrity'],
    [new Error('fetch failed'), 'network'],
    ['untyped failure', 'network'],
  ])('classifies a transfer failure and allows a clean retry', async (error, code) => {
    fake.download.mockRejectedValueOnce(error);
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.opusZhEn);
    await vi.waitFor(async () => expect(await phase(manager)).toBe('error'));
    expect((await manager.status()).tasks.find((task) => task.model === ids.opusZhEn)?.error).toBe(code);
    await manager.start(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.gates.has(ids.opusZhEn)).toBe(true));
    fake.gates.get(ids.opusZhEn)!();
    await vi.waitFor(async () => expect(await phase(manager)).toBe('ready'));
  });

  it('reports speed from elapsed bytes and preserves valid persisted idle state', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    entries.set('https://fluentread.invalid/local-translation-downloads-v2', new Response(JSON.stringify({version:2,tasks:[{model:ids.opusZhEn,phase:'idle',updatedAt:now + 50}]})));
    const manager = createLocalTranslationDownloadManager();
    expect(await phase(manager)).toBe('idle');
    await manager.start(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.gates.has(ids.opusZhEn)).toBe(true));
    vi.mocked(Date.now).mockReturnValue(now + 1000);
    fake.download.mock.calls[0]![2](8, false);
    const task = (await manager.status()).tasks.find((task) => task.model === ids.opusZhEn)!;
    expect(task.bytesPerSecond).toBe(8);
    expect(task.updatedAt).toBeGreaterThan(now + 50);
    fake.gates.get(ids.opusZhEn)!();
    await vi.waitFor(async () => expect(await phase(manager)).toBe('ready'));
  });

  it('deduplicates removal and refuses to start until the disk operation finishes', async () => {
    let finish!: () => void;
    fake.remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const manager = createLocalTranslationDownloadManager();
    const deletion = manager.remove(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledOnce());
    await expect(manager.start(ids.opusZhEn)).rejects.toThrow('REMOVING');
    expect((await manager.remove(ids.opusZhEn)).tasks.find((task) => task.model === ids.opusZhEn)?.phase).toBe('removing');
    finish(); await deletion;
    expect(await phase(manager)).toBe('idle');
    fake.remove.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(manager.remove(ids.opusZhEn)).rejects.toThrow('disk unavailable');
    expect(await phase(manager)).toBe('error');
  });

  it('waits for an aborted active transfer before resuming', async () => {
    let rejectTransfer!: (error: Error) => void;
    fake.download.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectTransfer = reject; }));
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledOnce());
    await manager.pause(ids.opusZhEn);
    const resumed = manager.start(ids.opusZhEn);
    await Promise.resolve();
    expect(fake.download).toHaveBeenCalledOnce();
    rejectTransfer(new DOMException('Paused', 'AbortError'));
    await resumed;
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledTimes(2));
    fake.gates.get(ids.opusZhEn)!();
    await vi.waitFor(async () => expect(await phase(manager)).toBe('ready'));
  });
  it('rejects an unsupported Hunyuan runtime before transferring model files', async () => {
    fake.supported = false;
    await expect(createLocalTranslationDownloadManager().start(ids.hunyuan)).rejects.toThrow('BROWSER_UNSUPPORTED');
    expect(fake.download).not.toHaveBeenCalled();
  });
  it('rejects Index on an unsupported browser without queuing or transferring model files', async () => {
    fake.supported = false;
    const manager = createLocalTranslationDownloadManager();
    await expect(manager.start(ids.index)).rejects.toThrow('LOCAL_TRANSLATION_BROWSER_UNSUPPORTED');
    expect(await phase(manager, ids.index)).toBe('idle');
    expect(fake.download).not.toHaveBeenCalled();
    expect(fake.bytes.has(ids.index)).toBe(false);
  });
  it('waits for Index GPU admission before transferring and permits retry after missing shader-f16', async () => {
    let finishProbe!: (adapter: {features: Set<string>}) => void;
    const requestAdapter = vi.fn(() => new Promise<{features: Set<string>}>((resolve) => { finishProbe = resolve; }));
    vi.stubGlobal('WebAssembly', {Suspending: class {}});
    vi.stubGlobal('navigator', {gpu: {requestAdapter}, storage: navigator.storage});
    const manager = createLocalTranslationDownloadManager();
    const rejected = expect(manager.start(ids.index)).rejects.toThrow('LOCAL_TRANSLATION_GPU_UNAVAILABLE');
    await vi.waitFor(() => expect(requestAdapter).toHaveBeenCalledOnce());
    expect(requestAdapter).toHaveBeenCalledWith({powerPreference: 'high-performance'});
    expect(await phase(manager, ids.index)).toBe('idle');
    expect(fake.download).not.toHaveBeenCalled();
    finishProbe({features: new Set()});
    await rejected;
    expect(await phase(manager, ids.index)).toBe('idle');
    expect(fake.download).not.toHaveBeenCalled();
    expect(fake.bytes.has(ids.index)).toBe(false);

    const retry = manager.start(ids.index);
    await vi.waitFor(() => expect(requestAdapter).toHaveBeenCalledTimes(2));
    expect(fake.download).not.toHaveBeenCalled();
    finishProbe({features: new Set(['shader-f16'])});
    await retry;
    await vi.waitFor(() => expect(fake.gates.has(ids.index)).toBe(true));
    expect(fake.download).toHaveBeenCalledOnce();
    expect(fake.download.mock.calls[0]![0]).toMatchObject({repo: ids.index, path: 'weights'});
    expect(await phase(manager, ids.index)).toBe('downloading');
    fake.gates.get(ids.index)!();
    await vi.waitFor(async () => expect(await phase(manager, ids.index)).toBe('ready'));
    expect((await manager.status()).tasks.find((task) => task.model === ids.index)).toMatchObject({
      downloadedBytes: 12, totalBytes: 12, bytesPerSecond: 0, error: undefined,
    });
  });
  it('returns immediately and keeps one job while settings pages detach and reattach', async () => {
    const change = vi.fn(async () => undefined);
    const manager = createLocalTranslationDownloadManager({onChange: change});
    const acknowledgement = await manager.start(ids.opusZhEn);
    expect(acknowledgement.tasks.find((task) => task.model === ids.opusZhEn)?.phase).not.toBe('ready');
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledOnce());
    await manager.status();
    await manager.status();
    await manager.start(ids.opusZhEn);
    expect(fake.download).toHaveBeenCalledOnce();
    expect(await phase(manager)).toBe('downloading');
    fake.gates.get(ids.opusZhEn)!();
    await vi.waitFor(async () => expect(await phase(manager)).toBe('ready'));
    await manager.start(ids.opusZhEn);
    expect(fake.download).toHaveBeenCalledOnce();
  });

  it('restores disk progress as paused after the offscreen document restarts, never as a running phantom job', async () => {
    const first = createLocalTranslationDownloadManager();
    await first.start(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledOnce());
    await first.pause(ids.opusZhEn);
    await vi.waitFor(async () => expect(await phase(first)).toBe('paused'));
    const reopened = createLocalTranslationDownloadManager();
    const task = (await reopened.status()).tasks.find((task) => task.model === ids.opusZhEn)!;
    expect(task).toMatchObject({phase: 'paused', downloadedBytes: 4});
    expect(fake.download).toHaveBeenCalledOnce();
    await reopened.start(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledTimes(2));
    fake.gates.get(ids.opusZhEn)!();
    await vi.waitFor(async () => expect(await phase(reopened)).toBe('ready'));
  });

  it('can delete a queued model without waiting for another large download', async () => {
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.hunyuan);
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledOnce());
    await manager.start(ids.opusZhEn);
    expect(await phase(manager)).toBe('queued');
    await manager.remove(ids.opusZhEn);
    expect(await phase(manager)).toBe('idle');
    expect(fake.remove).toHaveBeenCalledOnce();
    fake.gates.get(ids.hunyuan)!();
    await vi.waitFor(async () => expect(await phase(manager, ids.hunyuan)).toBe('ready'));
    expect(fake.download).toHaveBeenCalledOnce();
  });

  it('aborts an active download before deletion and never resurrects deleted files as ready', async () => {
    const beforeRemove = vi.fn();
    const manager = createLocalTranslationDownloadManager({beforeRemove});
    await manager.start(ids.opusZhEn);
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledOnce());
    await manager.remove(ids.opusZhEn);
    expect(fake.download.mock.calls[0]![1].aborted).toBe(true);
    expect(beforeRemove).toHaveBeenCalledWith(ids.opusZhEn);
    expect(await phase(manager)).toBe('idle');
    expect(fake.bytes.has(ids.opusZhEn)).toBe(false);
    const reopened = createLocalTranslationDownloadManager();
    expect(await phase(reopened)).toBe('idle');
  });

  it('continues a paused queued job only after an explicit resume, without duplicate execution', async () => {
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.hunyuan);
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledOnce());
    await manager.start(ids.opusZhEn);
    await manager.pause(ids.opusZhEn);
    expect(await phase(manager)).toBe('paused');
    await manager.start(ids.opusZhEn);
    fake.gates.get(ids.hunyuan)!();
    await vi.waitFor(() => expect(fake.download).toHaveBeenCalledTimes(2));
    fake.gates.get(ids.opusZhEn)!();
    await vi.waitFor(async () => expect(await phase(manager)).toBe('ready'));
  });

  it('reports insufficient disk space before opening a download', async () => {
    vi.stubGlobal('navigator', {storage: {estimate: async () => ({quota: 10, usage: 9})}});
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.opusZhEn);
    await vi.waitFor(async () => expect(await phase(manager)).toBe('error'));
    expect((await manager.status()).tasks.find((task) => task.model === ids.opusZhEn)?.error).toBe('storage');
    expect(fake.download).not.toHaveBeenCalled();
  });
});


describe('shared Q8 and FP16 cache ownership', () => {
  it('rechecks own removal after waiting for a shared-file removal',async()=>{
    fake.shared=true;
    let finishFirst!:()=>void, finishSecond!:()=>void;
    fake.remove.mockImplementationOnce(()=>new Promise<void>(resolve=>{finishFirst=resolve;}))
      .mockImplementationOnce(async()=>undefined)
      .mockImplementationOnce(()=>new Promise<void>(resolve=>{finishSecond=resolve;}));
    const manager=createLocalTranslationDownloadManager();
    const first=manager.remove(ids.opusZhEn);
    await vi.waitFor(()=>expect(finishFirst).toBeTypeOf('function'));
    const started=expect(manager.start(ids.opusZhEnGpu)).rejects.toThrow('REMOVING');
    await new Promise(resolve=>setTimeout(resolve,10));
    const second=manager.remove(ids.opusZhEnGpu);
    await vi.waitFor(()=>expect(finishSecond).toBeTypeOf('function'));
    finishFirst(); await first; await started;
    expect(fake.download).not.toHaveBeenCalled();
    finishSecond();await second;
  });

  const autoDownload = () => fake.download.mockImplementation(async (file, _signal, progress) => {
    fake.bytes.set(file.repo, 12); fake.complete.add(file.repo); progress(12, true);
  });
  it.each([[ids.opusZhEn,ids.opusZhEnGpu],[ids.opusZhEnGpu,ids.opusZhEn]])('preserves shared files for cached/in-use sibling while removing %s first, then permits reinstall', async (first, second) => {
    fake.shared = true;
    ['shared',first,second].forEach(key => fake.complete.add(key));
    const beforeRemove = vi.fn(), manager = createLocalTranslationDownloadManager({beforeRemove});
    await manager.remove(first);
    expect(beforeRemove).toHaveBeenCalledWith(first);
    expect(beforeRemove).not.toHaveBeenCalledWith(second);
    expect(fake.complete.has('shared')).toBe(true);
    expect(await phase(manager,second)).toBe('ready');
    expect(await phase(createLocalTranslationDownloadManager(),first)).toBe('idle');
    await manager.remove(second);
    expect(fake.complete.has('shared')).toBe(false);
    autoDownload(); await manager.start(first);
    await vi.waitFor(async () => expect(await phase(manager,first)).toBe('ready'));
  });
  it('does not turn shared metadata alone into a partial GPU download', async () => {
    fake.shared = true; fake.complete.add('shared');
    expect(await phase(createLocalTranslationDownloadManager(),ids.opusZhEnGpu)).toBe('idle');
  });
  it('protects files needed by a partial/failed sibling, then cleans them when the last owner is removed', async () => {
    fake.shared = true; fake.complete.add('shared'); fake.bytes.set(ids.opusZhEnGpu,4);
    const manager = createLocalTranslationDownloadManager();
    expect(await phase(manager,ids.opusZhEnGpu)).toBe('paused');
    await manager.remove(ids.opusZhEn);
    expect(fake.complete.has('shared')).toBe(true);
    fake.download.mockRejectedValueOnce(new Error('network'));
    await manager.start(ids.opusZhEnGpu);
    await vi.waitFor(async () => expect(await phase(manager,ids.opusZhEnGpu)).toBe('error'));
    await manager.remove(ids.opusZhEn);
    expect(fake.complete.has('shared')).toBe(true);
    await manager.remove(ids.opusZhEnGpu);
    expect(fake.complete.has('shared')).toBe(false);
  });
  it('preserves shared files for a downloading sibling without waiting for its large weights', async () => {
    fake.shared = true;
    const manager = createLocalTranslationDownloadManager();
    await manager.start(ids.opusZhEnGpu);
    await vi.waitFor(() => expect(fake.gates.has('shared')).toBe(true));
    await manager.remove(ids.opusZhEn);
    expect(fake.remove.mock.calls.every(([file]) => file.repo !== 'shared')).toBe(true);
    fake.gates.get('shared')!();
    await vi.waitFor(() => expect(fake.gates.has(ids.opusZhEnGpu)).toBe(true));
    fake.gates.get(ids.opusZhEnGpu)!();
    await vi.waitFor(async () => expect(await phase(manager,ids.opusZhEnGpu)).toBe('ready'));
  });
  it('waits for an earlier shared-file removal before downloading the sibling', async () => {
    fake.shared = true;
    let finish!: () => void;
    fake.remove.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const manager = createLocalTranslationDownloadManager();
    const removal = manager.remove(ids.opusZhEn);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    autoDownload(); const start = manager.start(ids.opusZhEnGpu);
    await new Promise(resolve => setTimeout(resolve,10));
    expect(fake.download).not.toHaveBeenCalled();
    finish(); await removal; await start;
    await vi.waitFor(async () => expect(await phase(manager,ids.opusZhEnGpu)).toBe('ready'));
  });
});
