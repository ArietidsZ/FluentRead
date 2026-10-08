import {describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {createVisionProbeHandlers, VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/app/background/handlers/visionProbe';
import {createVisionProbeIdentity} from '@/src/core/config/visionProbe';
import {prepareModelVisionRoute, freezeVisionProbeConfig} from '@/src/services/translation/visionProbe';
import {createAreaTranslationBackgroundHandlers, AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE} from '@/src/features/area-translation/background';

// 旧 URL-only/油猴适配的兼容契约；原生来源、文档 Port 和 UI 由独立集成套件验证。
vi.mock('@/src/core/config/incognitoRoute', async original => ({...await original<object>(), NATIVE_PRIVATE_ROUTE_SUPPORTED: false}));

const context = {sender:{url:'chrome-extension://fixture/options.html'}};
const config = () => { const c=new Config();c.service='deepseek';c.model.deepseek='future-vision'; return c; };
describe('识图测试后台契约与圈选路由',()=>{
    it('圈选使用异步能力判断，支持时跳过 OCR，未知时标明回退，检测错误不触发 OCR',async()=>{
        const resolve=vi.fn<any>().mockResolvedValueOnce({mode:'vision'}).mockResolvedValueOnce({mode:'ocr',fallback:'unknown'}).mockRejectedValueOnce(new Error('HTTP 401'));
        const ocr=vi.fn(async()=>({image:'cropped',lines:[]})), vision=vi.fn(async()=>({image:'cropped',lines:[],recognitionMethod:'vision'}));
        const languages=vi.fn(async()=>undefined);
        const [,handler]=createAreaTranslationBackgroundHandlers({captureVisibleTab:async()=>'',getDefaultSourceLanguage:()=> 'en',assertLanguagesDownloaded:languages,
            prepareVisionRoute:()=>resolve,prepareVisionTranslation:()=>vision,translateArea:ocr});
        const message={type:AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE,image:'data:image/png,x',selection:{left:0,top:0,width:20,height:20,viewportWidth:100,viewportHeight:100}};
        await expect(handler.handle(message,{})).resolves.toMatchObject({recognitionMethod:'vision'});expect(ocr).not.toHaveBeenCalled();expect(languages).not.toHaveBeenCalled();
        await expect(handler.handle(message,{})).resolves.toMatchObject({recognitionMethod:'ocr',recognitionFallback:'unknown'});
        await expect(handler.handle(message,{})).rejects.toThrow('401');expect(ocr).toHaveBeenCalledOnce();
    });
    it('只接受真实设置页和当前配置身份，拒绝非法服务、模型和旧配置',async()=>{
        const source=config(), resolve=vi.fn(async(_source:unknown,_service:string,_model:string,_options:unknown)=>({capability:'supported' as const,source:'probe' as const}));
        const [test,cancel]=createVisionProbeHandlers({ready:Promise.resolve(),getConfig:()=>source,isSettingsUrl:url=>url===context.sender.url,resolve});
        const message={type:VISION_PROBE_MESSAGE,service:'deepseek',model:'future-vision',requestId:'probe-1',identity:createVisionProbeIdentity(source,'deepseek','future-vision')};
        await expect(test.handle(message,{})).rejects.toThrow('设置页');
        expect(()=>cancel.handle({type:VISION_PROBE_CANCEL_MESSAGE},{})).toThrow('设置页');
        for(const patch of [{service:null},{service:' '},{model:null},{model:' '},{identity:'stale'}]) await expect(test.handle({...message,...patch},context)).rejects.toThrow();
        const pending=test.handle(message,context); source.token.deepseek='changed';
        await expect(pending).rejects.toThrow('已更改');
        const result=test.handle({...message,identity:createVisionProbeIdentity(source,'deepseek','future-vision')},context);
        await expect(result).resolves.toMatchObject({success:true,capability:'supported'});
        expect(resolve.mock.calls[0]?.[0]).not.toBe(source);
    });
    it('取消测试会中止真实请求，提前取消不启动请求，错误直接传给路由器',async()=>{
        const source=config();let signal:AbortSignal | undefined;
        const resolve=vi.fn(async(_c,_s,_m,options)=> {signal=options.signal;return new Promise<any>((_r,reject)=>signal!.addEventListener('abort',()=>reject(new Error('aborted'))));});
        const [test,cancel]=createVisionProbeHandlers({ready:Promise.resolve(),getConfig:()=>source,isSettingsUrl:()=>true,resolve});
        const message={type:VISION_PROBE_MESSAGE,service:'deepseek',model:'future-vision',requestId:'probe-1',identity:createVisionProbeIdentity(source,'deepseek','future-vision')};
        const result=test.handle(message,context);const failure=expect(result).rejects.toMatchObject({name:'AbortError'});
        await vi.waitFor(()=>expect(resolve).toHaveBeenCalledOnce());
        expect(cancel.handle({type:VISION_PROBE_CANCEL_MESSAGE,requestId:'probe-1'},context)).toMatchObject({cancelled:true});
        await failure;expect(signal?.aborted).toBe(true);
        cancel.handle({type:VISION_PROBE_CANCEL_MESSAGE,requestId:'probe-2'},context);
        await expect(test.handle({...message,requestId:'probe-2'},context)).rejects.toMatchObject({name:'AbortError'});
        resolve.mockRejectedValueOnce(new Error('HTTP 401'));
        await expect(test.handle({...message,requestId:'probe-3'},context)).rejects.toThrow('401');
    });
    it('首次圈选在等待前冻结模型、密钥、覆盖与模式，再由能力结论选择识别路径',async()=>{
        const source=config(); source.areaRecognitionMode='prefer-vision';source.modelVision.deepseek={'future-vision':true};
        const resolve=vi.fn(async()=>({capability:'supported' as const,source:'probe' as const}));
        const run=prepareModelVisionRoute(source,resolve);
        source.service='freeTranslation';source.model.deepseek='other';source.modelVision.deepseek['future-vision']=false;source.areaRecognitionMode='ocr';
        await expect(run({})).resolves.toEqual({mode:'vision'});
        expect(resolve.mock.calls[0]).toMatchObject([{model:{deepseek:'future-vision'},modelVision:{deepseek:{'future-vision':true}}},'deepseek','future-vision',{probeUnknown:true}]);
        expect(freezeVisionProbeConfig({...config(),modelVision:undefined}).modelVision).toEqual({});
    });
    it('本地 OCR 不探测，明确不支持或无法确认走 OCR，探测网络失败不回退',async()=>{
        const source=config(), resolve=vi.fn<any>().mockResolvedValueOnce({capability:'unsupported'}).mockResolvedValueOnce({capability:'unknown'}).mockRejectedValueOnce(new Error('network'));
        source.areaRecognitionMode='ocr';await expect(prepareModelVisionRoute(source,resolve)({})).resolves.toMatchObject({mode:'ocr'});expect(resolve).not.toHaveBeenCalled();
        source.areaRecognitionMode='prefer-vision';const run=prepareModelVisionRoute(source,resolve);
        await expect(run({})).resolves.toEqual({mode:'ocr',fallback:'unsupported'});
        await expect(run({})).resolves.toEqual({mode:'ocr',fallback:'unknown'});
        await expect(run({})).rejects.toThrow('network');
    });
});
