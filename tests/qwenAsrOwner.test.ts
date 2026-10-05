import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/src/features/video-subtitle/offscreen/modelCache',()=>({cacheVideoAiQ4ModelFiles:vi.fn(async()=>{}),removeVideoAiModelFiles:vi.fn(async()=>{})}));
class WorkerFake {
    static instances:WorkerFake[]=[];onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;
    last:any;terminated=false;
    constructor(readonly url:string){WorkerFake.instances.push(this);}
    postMessage(message:any){this.last=message;}terminate(){this.terminated=true;}
    reply(data:Record<string,unknown>){this.onmessage?.({data:{requestId:this.last.requestId,...data}} as MessageEvent);}
}
let api:typeof import('@/src/features/video-subtitle/offscreen/transcription');
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(async()=>{vi.resetModules();WorkerFake.instances=[];vi.useFakeTimers();vi.stubGlobal('Worker',WorkerFake);vi.stubGlobal('window',{location:{href:'chrome-extension://test/offscreen.html'},setTimeout,clearTimeout});api=await import('@/src/features/video-subtitle/offscreen/transcription');});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
describe('Qwen owner routing and cancellation',()=>{
    it('routes to an isolated worker, keeps precision/window timing and does not retry on CPU',async()=>{
        const first=api.transcribeLocalVideoAudio({streamId:'q',model:'qwen3-asr-0.6b',audioPcm16Base64:'AAAAAA=='});await tick();
        const worker=WorkerFake.instances[0];expect(worker.url).toContain('qwenAsrWorker.js');
        worker.reply({success:true,text:'Hello',segments:[{startMs:0,endMs:200,text:'Hello'}],dtype:'q4f16',timestampSource:'window',backend:'webgpu'});
        expect(await first).toMatchObject({dtype:'q4f16',timestampSource:'window',backend:'webgpu'});
        const failure=api.transcribeLocalVideoAudio({streamId:'q',model:'qwen3-asr-0.6b',audioPcm16Base64:'AAAAAA=='});const check=expect(failure).rejects.toThrow('GPU lost');await tick();
        worker.reply({success:false,error:'GPU lost',retryWithCpu:true});await check;expect(WorkerFake.instances).toHaveLength(1);expect(worker.terminated).toBe(true);
        await api.cancelLocalVideoTranscription('q');
    });
    it('cancels warm preparation and ignores late completion, then retries in a fresh worker',async()=>{
        const first=api.prepareLocalVideoTranscriptionModel('qwen3-asr-0.6b',{keepWarm:true,streamId:'q'});const stopped=expect(first).rejects.toThrow();await tick();const old=WorkerFake.instances[0];
        await api.cancelLocalVideoTranscription('q');await stopped;expect(old.terminated).toBe(true);old.reply({success:true,dtype:'q4'});
        const next=api.prepareLocalVideoTranscriptionModel('qwen3-asr-0.6b',{keepWarm:true,streamId:'next'});await tick();
        expect(WorkerFake.instances).toHaveLength(2);WorkerFake.instances[1].reply({success:true,dtype:'q4f16',backend:'webgpu'});expect(await next).toMatchObject({dtype:'q4f16'});
        await api.cancelLocalVideoTranscription('next');
    });
    it('uses the full operation deadline and terminates without CPU rebuild on timeout',async()=>{
        const result=api.transcribeLocalVideoAudio({streamId:'q',model:'qwen3-asr-0.6b',audioPcm16Base64:'AAAAAA=='});const timed=expect(result).rejects.toThrow('32');await tick();
        await vi.advanceTimersByTimeAsync(16000);expect(WorkerFake.instances).toHaveLength(1);expect(WorkerFake.instances[0].terminated).toBe(false);
        await vi.advanceTimersByTimeAsync(16000);await timed;expect(WorkerFake.instances).toHaveLength(1);expect(WorkerFake.instances[0].terminated).toBe(true);
    });
    it('switching back to an existing model replaces the Qwen worker',async()=>{
        const first=api.prepareLocalVideoTranscriptionModel('qwen3-asr-0.6b',{keepWarm:true});await tick();WorkerFake.instances[0].reply({success:true,dtype:'q4',backend:'webgpu'});await first;
        const next=api.prepareLocalVideoTranscriptionModel('tiny',{keepWarm:true});await tick();expect(WorkerFake.instances[0].terminated).toBe(true);expect(WorkerFake.instances[1].url).toContain('videoTranscriptionWorker.js');WorkerFake.instances[1].reply({success:true,dtype:'q4'});await next;
        await api.cancelLocalVideoTranscription('');
    });
    it('cache-only preparation does not invent a dtype and removal accepts the new catalog entry',async()=>{
        expect(await api.prepareLocalVideoTranscriptionModel('qwen3-asr-0.6b')).toEqual({model:'qwen3-asr-0.6b'});
        await expect(api.removeLocalVideoTranscriptionModel('qwen3-asr-0.6b')).resolves.toBeUndefined();expect(WorkerFake.instances).toHaveLength(0);
    });

    it.each(['error','timeout'])('a terminal %s releases ownership for another stream without manual cancel',async failure=>{
        const result=api.transcribeLocalVideoAudio({streamId:'first',model:'qwen3-asr-0.6b',audioPcm16Base64:'AAAAAA=='});const rejected=expect(result).rejects.toThrow();await tick();const old=WorkerFake.instances[0];
        if(failure==='timeout')await vi.advanceTimersByTimeAsync(32000);else old.reply({success:false,error:'GPU lost'});
        await rejected;
        const next=api.prepareLocalVideoTranscriptionModel('qwen3-asr-0.6b',{keepWarm:true,streamId:'next'});await tick();expect(WorkerFake.instances).toHaveLength(2);
        old.reply({success:false,error:'late old error'});old.onerror?.({message:'late old worker error'} as ErrorEvent);
        expect(WorkerFake.instances[1].terminated).toBe(false);WorkerFake.instances[1].reply({success:true,dtype:'q4',backend:'webgpu'});await next;
        await expect(api.transcribeLocalVideoAudio({streamId:'third',model:'qwen3-asr-0.6b',audioPcm16Base64:'AAAAAA=='})).rejects.toThrow('另一个');
        await api.cancelLocalVideoTranscription('next');
    });
    it.each([
        {name: 'empty', response: {error: ''}},
        {name: 'missing', response: {}},
    ])('uses the localized fallback for a $name terminal error and lets the next stream recover', async ({response}) => {
        const first = api.transcribeLocalVideoAudio({streamId: 'first', model: 'qwen3-asr-0.6b', audioPcm16Base64: 'AAAAAA=='});
        const rejected = expect(first).rejects.toThrow('Qwen ASR GPU 会话已失效，请重试');
        await tick();
        const failedWorker = WorkerFake.instances[0];
        failedWorker.reply({success: false, retryWithCpu: true, ...response});
        await rejected;
        expect(failedWorker.terminated).toBe(true);
        expect(WorkerFake.instances).toHaveLength(1);

        const next = api.transcribeLocalVideoAudio({streamId: 'next', model: 'qwen3-asr-0.6b', audioPcm16Base64: 'AAAAAA=='});
        await tick();
        expect(WorkerFake.instances).toHaveLength(2);
        const nextWorker = WorkerFake.instances[1];
        expect(nextWorker.url).toContain('qwenAsrWorker.js');
        expect(nextWorker.terminated).toBe(false);
        nextWorker.reply({success: true, text: 'Recovered', segments: [], backend: 'webgpu'});
        await expect(next).resolves.toMatchObject({text: 'Recovered', model: 'qwen3-asr-0.6b', backend: 'webgpu'});
        await api.cancelLocalVideoTranscription('next');
    });
    it('does not allocate an unused CPU-retry PCM copy',async()=>{
        const slice=vi.spyOn(Float32Array.prototype,'slice');
        try {
            const result=api.transcribeLocalVideoAudio({streamId:'q',model:'qwen3-asr-0.6b',audioPcm16Base64:'AAAAAA=='});await tick();
            expect(slice).not.toHaveBeenCalled();WorkerFake.instances[0].reply({success:true,text:'',segments:[],backend:'webgpu'});await result;await api.cancelLocalVideoTranscription('q');
        }finally{slice.mockRestore();}
    });

});
