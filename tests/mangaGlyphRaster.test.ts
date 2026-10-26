/** @file tests/mangaGlyphRaster.test.ts 验证单计划字形的严格像素支持、局部相位、页预算与异常释放；假画布端口不代表原生字体或OCR通过。 */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {
    auditMangaGlyphRaster,createMangaGlyphRasterLedger,MANGA_GLYPH_RASTER_LIMITS as LIMITS,rasterizeMangaGlyphs,
    type MangaGlyphRasterBox,type MangaGlyphRasterPlan,
} from '@/src/features/image-translation/services/mangaGlyphRaster';

const box={x0:10.25,y0:20.5,x1:30.25,y1:40.5};
const plan:MangaGlyphRasterPlan={font:'italic 600 23.9681px sans-serif',lineWidth:3.355534,chunks:[{text:'A complete line.',x:12.125,y:33.875}]};
const styles={fillStyle:'#111111',strokeStyle:'#ffffff'};
function pixels(width:number,height:number,points:Array<[number,number,number,number,number,number]>){
    const data=new Uint8ClampedArray(width*height*4);
    for(const [x,y,r,g,b,a] of points)data.set([r,g,b,a],(y*width+x)*4);
    return data;
}
function capture(action:()=>unknown){try {action();} catch(error){return error;}throw new Error('Expected error');}
function audit(points:Array<[number,number,number,number,number,number]>,holes:MangaGlyphRasterBox[]=[],bounds={x0:0,y0:0,x1:10,y1:10},ledger=createMangaGlyphRasterLedger()){
    const data=pixels(10,10,points);
    return auditMangaGlyphRaster({pixels:data,clipped:data.slice(),width:10,height:10,x:0,y:0},bounds,holes,ledger);
}
interface PortOptions {
    ink?:{x:number;y:number;alpha?:number};empty?:boolean;differentChannel?:number;
    fail?:{layer:number;method:string;error:Error};nullContext?:number;
    cleanupErrors?:Map<number,Error>;createError?:Error;
}
function canvasPorts(options:PortOptions={}){
    const layers:Array<{canvas:HTMLCanvasElement;context:CanvasRenderingContext2D;calls:Array<[string,...unknown[]]>;size:()=>[number,number]}> = [];
    const createElement=vi.fn(()=>{
        if(options.createError)throw options.createError;
        const index=layers.length,calls:Array<[string,...unknown[]]>=[];
        const call=(method:string,...args:unknown[])=>{calls.push([method,...args]);if(options.fail?.layer===index&&options.fail.method===method)throw options.fail.error;};
        let width=0,height=0;
        const context={
            translate:(...args:unknown[])=>call('translate',...args),beginPath:()=>call('beginPath'),rect:(...args:unknown[])=>call('rect',...args),clip:(...args:unknown[])=>call('clip',...args),
            strokeText:(...args:unknown[])=>call('strokeText',...args),fillText:(...args:unknown[])=>call('fillText',...args),drawImage:(...args:unknown[])=>call('drawImage',...args),
            getImageData:(...args:unknown[])=>{
                call('getImageData',...args);
                const ink=options.ink??{x:13,y:13,alpha:255};
                const data=pixels(width,height,options.empty?[]:[[ink.x,ink.y,111,73,19,ink.alpha??255]]);
                if(index===1&&options.differentChannel!==undefined)data[(ink.y*width+ink.x)*4+options.differentChannel]++;
                return {data};
            },
        } as unknown as CanvasRenderingContext2D;
        const canvas={getContext:(...args:unknown[])=>{call('getContext',...args);return options.nullContext===index?null:context;}} as unknown as HTMLCanvasElement;
        Object.defineProperties(canvas,{
            width:{get:()=>width,set:(value:number)=>{call('width',value);if(value===0&&options.cleanupErrors?.has(index))throw options.cleanupErrors.get(index);width=value;}},
            height:{get:()=>height,set:(value:number)=>{call('height',value);height=value;}},
        });
        layers.push({canvas,context,calls,size:()=>[width,height]});return canvas;
    });
    vi.stubGlobal('document',{createElement});
    return {layers,createElement};
}
afterEach(()=>vi.unstubAllGlobals());

describe('实际非零alpha的严格像素支持规则',()=>{
    it('alpha1/2都算字形，隐藏RGB的alpha0不算，空字形不伪造成功',()=>{
        expect(audit([[4,4,255,255,255,1]])).toBe('safe');
        expect(audit([[4,4,255,255,255,2]],[{x0:4,y0:4,x1:5,y1:5}])).toBe('unsafe');
        expect(audit([[4,4,233,111,88,0],[6,6,1,2,3,255]],[{x0:4,y0:4,x1:5,y1:5}])).toBe('safe');
        expect(audit([])).toBe('unsafe');
    });
    it('保留原italic实际反例的两点：329,59和329,60的白色alpha2不能当作透明',()=>{
        const width=616,height=81,x=12,y=12,source=pixels(width,height,[[329-x,59-y,255,255,255,2],[329-x,60-y,255,255,255,2]]);
        expect(auditMangaGlyphRaster({pixels:source,clipped:source.slice(),width,height,x,y},{x0:20,y0:20,x1:620,y1:85},[{x0:320,y0:20,x1:330,y1:85}],createMangaGlyphRasterLedger())).toBe('unsafe');
    });
    it('重叠孔不产生XOR放行，分数孔触及像素单元即拒绝，边界仅相接保持安全',()=>{
        const hole={x0:4.5,y0:4.25,x1:5.5,y1:6};
        expect(audit([[4,4,255,255,255,2]],[hole,hole])).toBe('unsafe');
        for(const outside of [{x0:0,y0:0,x1:4,y1:10},{x0:5,y0:0,x1:10,y1:10},{x0:0,y0:0,x1:10,y1:4},{x0:0,y0:5,x1:10,y1:10}]){
            expect(audit([[4,4,1,2,3,255]],[outside])).toBe('safe');
        }
    });
    it.each([0,1,2,3])('裁切前后通道%s只差1也必须拒绝',(channel)=>{
        const data=pixels(10,10,[[4,4,111,73,19,2]]),clipped=data.slice();clipped[(4*10+4)*4+channel]++;
        expect(auditMangaGlyphRaster({pixels:data,clipped,width:10,height:10,x:0,y:0},{x0:0,y0:0,x1:10,y1:10},[],createMangaGlyphRasterLedger())).toBe('unsafe');
    });
    it('原框四边和分数边界按完整像素单元检查，不能靠裁切隐藏墨迹',()=>{
        for(const bounds of [{x0:4.25,y0:0,x1:10,y1:10},{x0:0,y0:4.25,x1:10,y1:10},{x0:0,y0:0,x1:4.75,y1:10},{x0:0,y0:0,x1:10,y1:4.75}]){
            expect(audit([[4,4,1,2,3,1]],[],bounds)).toBe('unsafe');
        }
    });
    it('交孔比较共享预算，恰好8M允许，下一比较明确回退',()=>{
        const ledger=createMangaGlyphRasterLedger(),outside={x0:0,y0:0,x1:1,y1:1};ledger.holeChecks=LIMITS.holeChecks-1;
        expect(audit([[4,4,1,2,3,1]],[outside],undefined,ledger)).toBe('safe');expect(ledger.holeChecks).toBe(LIMITS.holeChecks);
        expect(audit([[4,4,1,2,3,1]],[outside],undefined,ledger)).toBe('budget');
    });
    it.each([
        {width:NaN,height:1,pixels:new Uint8ClampedArray(),clipped:new Uint8ClampedArray()},
        {width:1,height:1.5,pixels:new Uint8ClampedArray(),clipped:new Uint8ClampedArray()},
        {width:0,height:1,pixels:new Uint8ClampedArray(),clipped:new Uint8ClampedArray()},
        {width:1,height:0,pixels:new Uint8ClampedArray(),clipped:new Uint8ClampedArray()},
        {width:1,height:1,pixels:new Uint8ClampedArray(),clipped:new Uint8ClampedArray()},
        {width:1,height:1,pixels:new Uint8ClampedArray(4),clipped:new Uint8ClampedArray()},
    ])('不完整读回或非法尺寸不能宣称安全 %#',(raster)=>{
        expect(()=>auditMangaGlyphRaster({...raster,x:0,y:0},box,[],createMangaGlyphRasterLedger())).toThrow('像素尺寸无效');
    });
});

describe('局部裁图保留原坐标相位并复用同一bitmap',()=>{
    it('仅两张局部画布/两次读取，完整文字与原样式不变，成功只把原glyph交给调用方',()=>{
        const ports=canvasPorts(),ledger=createMangaGlyphRasterLedger(),hole={x0:24,y0:25,x1:26,y1:30};
        const result=rasterizeMangaGlyphs(plan,box,[hole,hole],styles,ledger);
        expect(result.kind).toBe('accepted');if(result.kind!=='accepted')throw new Error('Expected accepted');
        expect([result.x,result.y]).toEqual([2,12]);expect(ports.layers).toHaveLength(2);
        const [glyph,verify]=ports.layers;
        expect(result.canvas).toBe(glyph.canvas);expect(glyph.size()).toEqual([37,37]);expect(verify.size()).toEqual([0,0]);
        expect(glyph.calls).toContainEqual(['translate',-2,-12]);expect(glyph.calls).toContainEqual(['strokeText','A complete line.',12.125,33.875]);
        expect(glyph.calls).toContainEqual(['fillText','A complete line.',12.125,33.875]);
        expect(glyph.context.font).toBe(plan.font);expect(glyph.context.lineWidth).toBe(plan.lineWidth);expect(glyph.context.fillStyle).toBe(styles.fillStyle);expect(glyph.context.strokeStyle).toBe(styles.strokeStyle);
        expect(glyph.context.textAlign).toBe('left');expect(glyph.context.textBaseline).toBe('alphabetic');expect(glyph.context.lineJoin).toBe('round');
        expect(verify.calls.filter(c=>c[0]==='clip')).toEqual([['clip'],['clip','evenodd'],['clip','evenodd']]);
        expect(verify.calls).toContainEqual(['drawImage',glyph.canvas,2,12]);
        for(const layer of ports.layers){expect(layer.calls).toContainEqual(['getContext','2d',{willReadFrequently:true}]);expect(layer.calls).toContainEqual(['getImageData',0,0,37,37]);}
        expect(ledger).toEqual({canvasPixels:2738,readbackPixels:2738,auditPixels:1369,holeChecks:2,liveCanvasPixels:1369,liveReadbackPixels:0});
        result.dispose();result.dispose();expect(glyph.size()).toEqual([0,0]);expect(ledger.liveCanvasPixels).toBe(0);expect(ledger.canvasPixels).toBe(2738);
    });
    it.each([{empty:true},{differentChannel:0},{ink:{x:0,y:0,alpha:2}}])('不安全实际读回仅返回unsafe并释放两层 %#',(options)=>{
        const ports=canvasPorts(options),ledger=createMangaGlyphRasterLedger();
        expect(rasterizeMangaGlyphs(plan,box,[],styles,ledger)).toEqual({kind:'unsafe'});
        expect(ports.layers.every(l=>l.size().every(v=>v===0))).toBe(true);expect(ledger.liveCanvasPixels).toBe(0);expect(ledger.liveReadbackPixels).toBe(0);
    });
    it('像素交孔预算失败区分为budget，不会变成允许h1的unsafe',()=>{
        const ports=canvasPorts(),ledger=createMangaGlyphRasterLedger();ledger.holeChecks=LIMITS.holeChecks;
        expect(rasterizeMangaGlyphs(plan,box,[{x0:24,y0:25,x1:26,y1:30}],styles,ledger)).toEqual({kind:'budget',reason:'intersection'});
        expect(ports.layers.every(l=>l.size().every(v=>v===0))).toBe(true);expect(ledger.liveCanvasPixels+ledger.liveReadbackPixels).toBe(0);
    });
    it('负原点仍用整数平移且保留fractional phase，不截成整页大小',()=>{
        const ports=canvasPorts({ink:{x:9,y:9}}),ledger=createMangaGlyphRasterLedger();
        const result=rasterizeMangaGlyphs(plan,{x0:.25,y0:.125,x1:12.25,y1:13.5},[],styles,ledger);
        expect(result.kind).toBe('accepted');if(result.kind!=='accepted')throw new Error('Expected accepted');
        expect([result.x,result.y]).toEqual([-8,-8]);expect(ports.layers[0].calls).toContainEqual(['translate',8,8]);result.dispose();
    });
});

describe('分配前预算与输入准入',()=>{
    it('4097孔在读取其坐标前拒绝，不用无界some遍历',()=>{
        const ports=canvasPorts(),holes=Array.from({length:4097},()=>({get x0(){throw new Error('Must not read');}} as unknown as MangaGlyphRasterBox));
        expect(rasterizeMangaGlyphs(plan,box,holes,styles,createMangaGlyphRasterLedger())).toEqual({kind:'budget',reason:'holes'});expect(ports.createElement).not.toHaveBeenCalled();
    });
    it.each([
        {box:{...box,x0:NaN}},{box:{...box,x1:box.x0}},{box:{...box,y1:box.y0}},
        {plan:{...plan,font:''}},{plan:{...plan,lineWidth:NaN}},{plan:{...plan,lineWidth:0}},
        {plan:{...plan,chunks:[{text:42,x:1,y:1}]}},{plan:{...plan,chunks:[{text:'a',x:Infinity,y:1}]}},{plan:{...plan,chunks:[{text:'a',x:1,y:NaN}]}},
        {holes:[{...box,x1:box.x0}]},
    ])('非法计划/框/孔不能进入原生栅格 %#',(input)=>{
        const ports=canvasPorts();expect(()=>rasterizeMangaGlyphs((input.plan??plan) as MangaGlyphRasterPlan,input.box??box,input.holes??[],styles,createMangaGlyphRasterLedger())).toThrow('栅格参数无效');expect(ports.createElement).not.toHaveBeenCalled();
    });
    it.each([
        {x0:8,y0:8,x1:8185,y1:9},{x0:8,y0:8,x1:9,y1:8185},
        {x0:8,y0:8,x1:2041,y1:1016},{x0:Number.MAX_VALUE/2,y0:8,x1:Number.MAX_VALUE,y1:9},
        {x0:8,y0:-Number.MAX_VALUE,x1:9,y1:-Number.MAX_VALUE/2},
    ])('超edge/2MP/坐标数值界限分配前拒绝 %#',(bounds)=>{
        const ports=canvasPorts();expect(rasterizeMangaGlyphs(plan,bounds,[],styles,createMangaGlyphRasterLedger())).toEqual({kind:'budget',reason:'layer'});expect(ports.createElement).not.toHaveBeenCalled();
    });
    it('恰好2MP及8192边可准入，显式读回活动峰值不超过4MP',()=>{
        for(const bounds of [{x0:8,y0:8,x1:2040,y1:1016},{x0:8,y0:8,x1:8184,y1:9}]){
            const ports=canvasPorts({ink:{x:8,y:8}}),ledger=createMangaGlyphRasterLedger(),result=rasterizeMangaGlyphs(plan,bounds,[],styles,ledger);
            expect(result.kind).toBe('accepted');if(result.kind!=='accepted')throw new Error('Expected accepted');
            expect(ledger.auditPixels).toBeLessThanOrEqual(LIMITS.layerPixels);expect(ledger.liveReadbackPixels).toBe(0);result.dispose();expect(ports.layers.every(l=>l.size().every(v=>v===0))).toBe(true);
        }
    });
    it.each([
        ['canvasPixels',LIMITS.pageCanvasPixels,2738],['readbackPixels',LIMITS.pageReadbackPixels,2738],['auditPixels',LIMITS.pageAuditPixels,1369],
        ['liveCanvasPixels',LIMITS.liveCanvasPixels,2738],['liveReadbackPixels',LIMITS.liveReadbackPixels,2738],
    ] as const)('共享%s边界允许等值，超1拒绝且不退款',(key,limit,cost)=>{
        const ports=canvasPorts(),ledger=createMangaGlyphRasterLedger();ledger[key]=limit-cost+1;
        const before={...ledger};expect(rasterizeMangaGlyphs(plan,box,[],styles,ledger)).toEqual({kind:'budget',reason:'page'});expect(ledger).toEqual(before);expect(ports.createElement).not.toHaveBeenCalled();
        ledger[key]--;const result=rasterizeMangaGlyphs(plan,box,[],styles,ledger);expect(result.kind).toBe('accepted');if(result.kind!=='accepted')throw new Error('Expected accepted');result.dispose();
        if(!key.startsWith('live'))expect(ledger[key]).toBe(limit);
    });
});

describe('实际端口异常保持首因且释放所有活动资源',()=>{
    it.each([
        {layer:0,method:'width'},{layer:0,method:'height'},{layer:0,method:'getContext'},
        {layer:1,method:'getContext'},{layer:0,method:'translate'},{layer:0,method:'strokeText'},{layer:0,method:'fillText'},
        {layer:1,method:'clip'},{layer:1,method:'drawImage'},{layer:0,method:'getImageData'},{layer:1,method:'getImageData'},
    ])('真实异常不吞成预算或unsafe %#',(failure)=>{
        const error=new Error('Native first cause'),ports=canvasPorts({fail:{...failure,error}}),ledger=createMangaGlyphRasterLedger();
        expect(capture(()=>rasterizeMangaGlyphs(plan,box,[],styles,ledger))).toBe(error);
        expect(ledger.liveCanvasPixels).toBe(0);expect(ledger.liveReadbackPixels).toBe(0);expect(ledger.canvasPixels).toBe(2738);
        expect(ports.layers.every(l=>l.size().every(v=>v===0))).toBe(true);
    });
    it.each([0,1])('context为空时两层都安全释放 %#',(nullContext)=>{
        const ports=canvasPorts({nullContext}),ledger=createMangaGlyphRasterLedger();expect(()=>rasterizeMangaGlyphs(plan,box,[],styles,ledger)).toThrow('画布不可用');expect(ledger.liveCanvasPixels).toBe(0);expect(ports.layers.every(l=>l.size().every(v=>v===0))).toBe(true);
    });
    it('元素创建失败不产生活动计费，累计准入不退款',()=>{
        const error=new Error('Create failed');canvasPorts({createError:error});const ledger=createMangaGlyphRasterLedger();expect(()=>rasterizeMangaGlyphs(plan,box,[],styles,ledger)).toThrow(error);expect(ledger.liveCanvasPixels).toBe(0);expect(ledger.canvasPixels).toBe(2738);
    });
    it('原生读取失败后即使两层释放又失败，仍抛首次原生错误并尝试高度清零',()=>{
        const first=new Error('Read first'),ports=canvasPorts({fail:{layer:1,method:'getImageData',error:first},cleanupErrors:new Map([[0,new Error('Glyph cleanup')],[1,new Error('Verify cleanup')]])}),ledger=createMangaGlyphRasterLedger();
        expect(capture(()=>rasterizeMangaGlyphs(plan,box,[],styles,ledger))).toBe(first);expect(ledger.liveCanvasPixels+ledger.liveReadbackPixels).toBe(0);expect(ports.layers.every(l=>l.size()[1]===0)).toBe(true);
    });
    it('成功审计后的verify释放异常也不能返回accepted，glyph同样释放且保留先发生的释放错误',()=>{
        const first=new Error('Verify cleanup'),ports=canvasPorts({cleanupErrors:new Map([[0,new Error('Glyph cleanup')],[1,first]])}),ledger=createMangaGlyphRasterLedger();
        expect(capture(()=>rasterizeMangaGlyphs(plan,box,[],styles,ledger))).toBe(first);expect(ledger.liveCanvasPixels).toBe(0);expect(ports.layers.every(l=>l.size()[1]===0)).toBe(true);
    });
    it('unsafe后的glyph释放异常抛出，初始化失败后释放异常也不能覆盖原因',()=>{
        const cleanup=new Error('Glyph cleanup');canvasPorts({empty:true,cleanupErrors:new Map([[0,cleanup]])});const ledger=createMangaGlyphRasterLedger();
        expect(()=>rasterizeMangaGlyphs(plan,box,[],styles,ledger)).toThrow(cleanup);expect(ledger.liveCanvasPixels).toBe(0);
        const initial=new Error('Context initial');canvasPorts({fail:{layer:0,method:'getContext',error:initial},cleanupErrors:new Map([[0,cleanup]])});
        expect(()=>rasterizeMangaGlyphs(plan,box,[],styles,createMangaGlyphRasterLedger())).toThrow(initial);
    });
});
