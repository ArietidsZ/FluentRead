import {afterEach,describe,expect,it,vi} from 'vitest';
const probe=vi.hoisted(()=>vi.fn());
vi.mock('@/src/shared/onnx/webgpu',()=>({probeWebGpu:probe}));
import {probeMangaGpu} from '@/src/features/image-translation/services/mangaGpu';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('漫画 GPU 运行接口兼容性',()=>{
    it('无 GPU 接口或旧设备缺少 adapterInfo 时直接用 CPU，不分配设备',async()=>{
        vi.stubGlobal('GPUDevice',undefined);expect(await probeMangaGpu()).toEqual({available:false,info:''});
        vi.stubGlobal('GPUDevice',class{});expect(await probeMangaGpu()).toEqual({available:false,info:''});expect(probe).not.toHaveBeenCalled();
    });
    it.each([true,false])('兼容接口继续采用有界硬件探测结果，available=%s',async available=>{
        vi.stubGlobal('GPUDevice',class{get adapterInfo(){return {};}});probe.mockResolvedValue({available,info:available?'hardware':''});
        expect(await probeMangaGpu()).toEqual({available,info:available?'hardware':''});expect(probe).toHaveBeenCalledOnce();
    });
});
