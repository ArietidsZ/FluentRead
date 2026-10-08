import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {isAnchorNearViewport, TranslationSourceStabilityGate} from '@/src/features/full-page-translation/content/sourceStabilityGate';
import type {TranslationCandidate} from '@/src/core/translation/public';

function fixture() {
    const {document} = parseHTML('<html><body><p>Visitors: 1</p></body></html>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', {innerWidth:1280, innerHeight:900, setTimeout:globalThis.setTimeout, clearTimeout:globalThis.clearTimeout});
    const element = document.querySelector<HTMLElement>('p')!;
    const candidate: TranslationCandidate = {element, kind:'content', reason:'source-stability'};
    const session = {translationMode:'all', scheduled:new Map<Node, TranslationCandidate>(), candidateAnchors:new Map<Node, HTMLElement>(),
        unchangedCandidates:new WeakMap<Node, unknown>(), lifecycleRetries:new WeakMap<Node, unknown>()};
    const ports = {isCurrent:vi.fn(() => true), resolve:vi.fn<() => TranslationCandidate | null>(() => candidate),
        discover:vi.fn((_session: typeof session, fresh:TranslationCandidate) => {session.scheduled.set(fresh.element, {...fresh, scope:'all'});}),
        source:vi.fn(() => 'The latest source.'), queue:vi.fn(), drain:vi.fn()};
    const gate = new TranslationSourceStabilityGate(ports);
    gate.blocks(candidate, 'Visitors: 1', session);
    return {document, element, candidate, session, ports, gate};
}

describe('动态来源安静窗口调度', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

    it('只在最后一次变化后调度最新候选，清理旧 unchanged / retry 墓碑', async () => {
        const {candidate, session, ports, gate} = fixture();
        session.unchangedCandidates.set(candidate.element, 'old');
        session.lifecycleRetries.set(candidate.element, 'old');
        expect(gate.blocks(candidate,'Preparing the next section.',session)).toBe(true);
        await vi.advanceTimersByTimeAsync(500);
        expect(gate.blocks(candidate,'The latest source.',session)).toBe(true);
        await vi.advanceTimersByTimeAsync(1700);
        expect(ports.queue).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        expect(session.unchangedCandidates.has(candidate.element)).toBe(false);
        expect(session.lifecycleRetries.has(candidate.element)).toBe(false);
        expect(ports.queue).toHaveBeenCalledWith(session,candidate.element,session.scheduled.get(candidate.element),'The latest source.');
        expect(ports.drain).toHaveBeenCalledOnce();
        expect(gate.blocks(candidate,'The latest source.',session)).toBe(false);
    });

    it('高频正文更新只保留一个安静窗口，稳定后仅派发最新来源一次', async () => {
        const {candidate, session, ports, gate} = fixture();
        let source = '';
        for (let index = 0; index < 500; index += 1) {
            source = `The article is being updated with section ${index}.`;
            expect(gate.blocks(candidate, source, session)).toBe(true);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(16);
        }
        expect(ports.queue).not.toHaveBeenCalled();
        ports.source.mockReturnValue(source);
        await vi.advanceTimersByTimeAsync(1800);
        expect(ports.queue).toHaveBeenCalledOnce();
        expect(ports.queue.mock.calls[0][3]).toBe(source);
        expect(ports.drain).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        gate.dispose(session);
    });

    it('连续数字变化取消安静定时器，悬浮暂停时不创建后台请求', async () => {
        const {candidate, session, ports, gate} = fixture();
        expect(gate.blocks(candidate,'Visitors: 2',session)).toBe(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(gate.blocks(candidate,'Visitors: 3',session)).toBe(true);
        await vi.runAllTimersAsync();
        expect(ports.queue).not.toHaveBeenCalled();
        const hoverGate = new TranslationSourceStabilityGate(ports);
        expect(hoverGate.blocks(candidate,'Initial hover source.')).toBe(false);
        expect(hoverGate.blocks(candidate,'Changed hover source.')).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        gate.dispose(session);
        gate.dispose(session);
    });

    it.each(['inactive','detached','unresolved','unscheduled','offscreen'] as const)('安静窗口后拒绝 %s 候选', async failure => {
        const {element, candidate, session, ports, gate} = fixture();
        gate.blocks(candidate,'Changed source.',session);
        if (failure === 'inactive') ports.isCurrent.mockReturnValue(false);
        if (failure === 'detached') element.remove();
        if (failure === 'unresolved') ports.resolve.mockReturnValue(null);
        if (failure === 'unscheduled') ports.discover.mockImplementation(() => undefined);
        if (failure === 'offscreen') session.translationMode='viewport';
        await vi.runAllTimersAsync();
        expect(ports.queue).not.toHaveBeenCalled();
    });

    it('视口模式只唤醒仍可见的候选，恢复和路由切换取消旧回调', async () => {
        const {element, candidate, session, ports, gate} = fixture();
        Object.defineProperty(element,'getBoundingClientRect',{value:() => ({width:400,height:40,right:400,left:0,bottom:40,top:0})});
        session.translationMode='viewport';
        gate.blocks(candidate,'Changed source.',session);
        await vi.runAllTimersAsync();
        expect(ports.queue).toHaveBeenCalledOnce();
        gate.blocks(candidate,'Another source.',session);
        gate.dispose(session);
        await vi.runAllTimersAsync();
        expect(ports.queue).toHaveBeenCalledOnce();
        gate.blocks(candidate,'A pending source.',session);
        gate.reset();
        await vi.runAllTimersAsync();
        expect(ports.queue).toHaveBeenCalledOnce();
        expect(gate.blocks(candidate,'A new route source.',session)).toBe(false);
    });

    it.each(['resolve', 'discover', 'source', 'queue'] as const)('外部 %s 端口重入路由 reset 后不继续旧调度', async port => {
        const {candidate, session, ports, gate} = fixture();
        gate.blocks(candidate, 'Changed source.', session);
        const original = ports[port].getMockImplementation() ?? (() => undefined);
        ports[port].mockImplementation(((...args: never[]) => {
            const result = (original as (...values: never[]) => unknown)(...args);
            gate.reset();
            return result;
        }) as never);
        await vi.runAllTimersAsync();
        if (port !== 'queue') expect(ports.queue).not.toHaveBeenCalled();
        expect(ports.drain).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['ready', 'numeric', 'ready-reentry'] as const)('取消后 %s 不保留 session 强引用或运行旧 timer', async reason => {
        const {candidate, session, ports, gate} = fixture();
        const pending = Reflect.get(gate, 'timers') as Map<typeof session, unknown>;
        gate.blocks(candidate, reason === 'numeric' ? 'Visitors: 2' : 'Changed source.', session);
        expect(pending.size).toBe(1);
        if (reason === 'numeric') gate.blocks(candidate, 'Visitors: 3', session);
        else if (reason === 'ready') {
            vi.setSystemTime(Date.now() + 1800); // 时钟已过 quiet window，timer 尚未执行。
            expect(gate.blocks(candidate, 'Changed source.', session)).toBe(false);
        } else {
            ports.source.mockImplementationOnce(() => {
                expect(gate.blocks(candidate, 'Changed source.', session)).toBe(false);
                return 'Changed source.';
            });
            await vi.advanceTimersByTimeAsync(1800);
        }
        await vi.runAllTimersAsync();
        expect(pending.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(ports.queue).not.toHaveBeenCalled();
        expect(ports.drain).not.toHaveBeenCalled();
    });

    it('source 端口发现新一代来源时保留新 timer，旧回调不抢先派发', async () => {
        const {candidate, session, ports, gate} = fixture();
        gate.blocks(candidate, 'Changed source.', session);
        ports.source.mockImplementationOnce(() => {
            gate.blocks(candidate, 'A newer generation.', session);
            return 'A newer generation.';
        });
        await vi.advanceTimersByTimeAsync(1800);
        expect(ports.queue).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
        ports.source.mockReturnValue('A newer generation.');
        await vi.advanceTimersByTimeAsync(1800);
        expect(ports.queue).toHaveBeenCalledOnce();
        expect(ports.queue.mock.calls[0][3]).toBe('A newer generation.');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('可见锚点布局读取重入 dispose 后不复活已取消回调', async () => {
        const {element, candidate, session, ports, gate} = fixture();
        session.translationMode = 'viewport';
        Object.defineProperty(element, 'getBoundingClientRect', {value: () => {
            gate.dispose(session);
            return {width:400, height:40, right:400, left:0, bottom:40, top:0};
        }});
        gate.blocks(candidate, 'Changed source.', session);
        await vi.runAllTimersAsync();
        expect(ports.queue).not.toHaveBeenCalled();
        expect(ports.drain).not.toHaveBeenCalled();
    });

    it('重新发现保留共享 key 的优先候选时按实际 scheduled owner 判断视口', async () => {
        const {document, element, candidate, session, ports, gate} = fixture();
        session.translationMode = 'viewport';
        const owner = document.createElement('section');
        document.body.append(owner);
        Object.defineProperty(element, 'getBoundingClientRect', {value: () => ({width:400,height:40,right:400,left:0,bottom:40,top:0})});
        Object.defineProperty(owner, 'getBoundingClientRect', {value: () => ({width:400,height:40,right:400,left:0,bottom:20040,top:20000})});
        const preferred = {...candidate, element: owner, nodes: [element]};
        ports.discover.mockImplementation(() => {session.scheduled.set(element, preferred);});
        gate.blocks(candidate, 'Changed source.', session);
        await vi.runAllTimersAsync();
        expect(ports.queue).not.toHaveBeenCalled();
    });

    it('display:contents owner 的安静重试复用重新发现绑定的可见后代锚点', async () => {
        const {document, element, candidate, session, ports, gate} = fixture();
        session.translationMode = 'viewport';
        const anchor = document.createElement('span');
        element.append(anchor);
        Object.defineProperty(element, 'getBoundingClientRect', {value: () => ({width:0,height:0,right:0,left:0,bottom:0,top:0})});
        Object.defineProperty(anchor, 'getBoundingClientRect', {value: () => ({width:400,height:40,right:400,left:0,bottom:40,top:0})});
        ports.discover.mockImplementation(() => {
            session.scheduled.set(element, candidate);
            session.candidateAnchors.set(element, anchor);
        });
        gate.blocks(candidate, 'Changed source.', session);
        await vi.runAllTimersAsync();
        expect(ports.queue).toHaveBeenCalledOnce();
        expect(ports.drain).toHaveBeenCalledOnce();
    });

    it.each([
        {width:0}, {height:0}, {rectWidth:0}, {rectHeight:0}, {right:0}, {left:1280}, {bottom:-10000}, {top:10000},
    ])('可见锚点拒绝无效或离屏几何 %j', overrides => {
        const {element} = fixture();
        Object.assign(window,{innerWidth:overrides.width ?? 1280,innerHeight:overrides.height ?? 900});
        Object.defineProperty(element,'getBoundingClientRect',{value:() => ({width:overrides.rectWidth ?? 400,height:overrides.rectHeight ?? 40,
            right:overrides.right ?? 400,left:overrides.left ?? 0,bottom:overrides.bottom ?? 40,top:overrides.top ?? 0})});
        expect(isAnchorNearViewport(element)).toBe(false);
    });

    it('可见锚点读取布局异常时保守等待 IO', () => {
        const {element} = fixture();
        Object.defineProperty(element,'getBoundingClientRect',{value:() => {throw new Error('Detached layout');}});
        expect(isAnchorNearViewport(element)).toBe(false);
    });
});
