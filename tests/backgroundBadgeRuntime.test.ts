import {afterEach, describe, expect, it, vi} from 'vitest';
import {installBackgroundBadge} from '@/src/app/background/badgeRuntime';
import {TabTranslationStateStore} from '@/src/app/background/tabTranslationState';
const previous = (globalThis as any).browser;
afterEach(() => { (globalThis as any).browser = previous; vi.restoreAllMocks(); });
const event = () => { const listeners: Function[] = []; return {addListener: (fn: Function) => listeners.push(fn), emit: (...args: unknown[]) => listeners.forEach(fn => fn(...args))}; };
function setup(namespace = 'action', sendMessage = vi.fn(async () => ({status:'success',isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'}))) {
    const action = {setBadgeBackgroundColor: vi.fn(async (_details: {tabId:number;color:string}) => {}), setBadgeTextColor: vi.fn(async (_details: {tabId:number;color:string}) => {}), setBadgeText: vi.fn(async (_details: {tabId:number;text:string}) => {}), setIcon: vi.fn(async (_details: {tabId:number;path:Record<number,string>}) => {})};
    const tabs = {onActivated: event(), onUpdated: event(), onRemoved: event(), sendMessage};
    (globalThis as any).browser = {...(namespace === 'none' ? {} : {[namespace]:action}), tabs};
    const store = new TabTranslationStateStore();
    return {action, tabs, store, badge: installBackgroundBadge(store)};
}
const settle = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
describe('工具栏原生三态角标', () => {
    it.each(['translated','translating','error'] as const)('按真实 %s 结果显示原生角标并恢复原图', async status => {
        const {store,badge,action}=setup(); store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:status}); await badge.update(1);
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:1,text:{translated:'✓',translating:'…',error:'!'}[status]});
        expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({tabId:1,color:{translated:'#15803d',translating:'#2563eb',error:'#b45309'}[status]});
        expect(action.setBadgeTextColor).toHaveBeenCalledWith({tabId:1,color:'#ffffff'});
        expect(action.setIcon).toHaveBeenLastCalledWith({tabId:1,path:Object.fromEntries([16,32,48,64,128].map(size=>[size,`icon/${size}.png`]))});
        await badge.update(1); expect(action.setIcon).toHaveBeenCalledTimes(1);
    });
    it('恢复、禁用、旧消息与另一标签页都不会误用成功图标', async () => {
        const {store,badge,action}=setup();
        for(const state of [{isTranslated:false,isSiteDisabled:false},{isTranslated:true,isSiteDisabled:true},{isTranslated:true,isSiteDisabled:false}]) {
            store.set(2,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});await badge.update(2);
            store.set(2,state);await badge.update(2);expect(action.setIcon.mock.lastCall?.[0].path[16]).toBe('icon/16.png');
            expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:2,text:''});
        }
        store.set(3,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});await badge.update(3);
        await badge.update(4);expect(action.setIcon.mock.lastCall?.[0]).toMatchObject({tabId:4,path:{16:'icon/16.png'}});
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:4,text:''});
    });
    it('激活时回源，包括完整但陈旧的缓存；查询失败保留安全默认', async () => {
        const {store,tabs,action}=setup();store.set(5,{isTranslated:false,isSiteDisabled:false});tabs.onActivated.emit({tabId:5});await settle();
        expect(tabs.sendMessage).toHaveBeenCalledWith(5,{type:'getFullPageTranslationState'});expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:5,text:'✓'});
        tabs.sendMessage.mockRejectedValueOnce(new Error('no receiver'));tabs.onActivated.emit({tabId:6});await settle();expect(action.setIcon.mock.lastCall?.[0].path[16]).toBe('icon/16.png');
    });
    it('导航恢复原图，普通更新不清空，关闭取消还未写出的任务', async () => {
        const {store,badge,tabs,action}=setup();store.set(7,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});await badge.update(7);
        tabs.onUpdated.emit(7,{status:'complete'});await settle();expect(action.setIcon).toHaveBeenCalledTimes(1);
        tabs.onUpdated.emit(7,{status:'loading'});await settle();expect(action.setIcon.mock.lastCall?.[0].path[16]).toBe('icon/16.png');
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:7,text:''});
        const pending=badge.update(8);tabs.onRemoved.emit(8);await pending;expect(action.setIcon).toHaveBeenCalledTimes(2);
    });
    it('慢旧写入不能覆盖较新的恢复状态', async () => {
        const {store,badge,action}=setup();let release!:()=>void;action.setIcon.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}));
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});const first=badge.update(1);await settle();store.reset(1);const restore=badge.update(1);release();await Promise.all([first,restore]);expect(action.setIcon.mock.lastCall?.[0].path[16]).toBe('icon/16.png');
    });
    it('Firefox MV2 使用 browserAction；无 action 环境不查询或写入', async () => {
        const ff=setup('browserAction');await ff.badge.update(1);expect(ff.action.setIcon).toHaveBeenCalled();const none=setup('none');await none.badge.update(1);none.tabs.onActivated.emit({tabId:1});expect(none.badge.isSupported).toBe(false);expect(none.tabs.sendMessage).not.toHaveBeenCalled();
    });
    it('图标 API 失败不会拒绝，后续刷新可以重试', async () => {
        const {badge,action}=setup();const error=vi.spyOn(console,'error').mockImplementation(()=>{});action.setIcon.mockRejectedValueOnce(new Error('tab gone'));await badge.update(1);await badge.update(1);expect(error).toHaveBeenCalled();expect(action.setIcon).toHaveBeenCalledTimes(2);
    });
    it('没有文字颜色 API 时仍能显示完成角标', async () => {
        const {store,badge,action}=setup('browserAction');
        delete (action as any).setBadgeTextColor;
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});
        await badge.update(1);
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:1,text:'✓'});
    });
    it('慢颜色写入期间恢复原文，不再写出过期成功角标', async () => {
        const {store,badge,action}=setup();let release!:()=>void;
        action.setBadgeBackgroundColor.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}));
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});
        const first=badge.update(1);await settle();store.reset(1);
        const restore=badge.update(1);release();await Promise.all([first,restore]);
        expect(action.setBadgeText).not.toHaveBeenCalledWith({tabId:1,text:'✓'});
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:1,text:''});
    });
    it.each(['setBadgeText','setIcon','setBadgeBackgroundColor','setBadgeTextColor'] as const)(
        '%s 写入中回到已显示过的完成状态，仍会重画完成角标', async method => {
            const {store,badge,action}=setup();
            store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});
            await badge.update(1);
            let release!:()=>void;
            action[method].mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}));
            store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translating'});
            const pending=badge.update(1);await settle();
            expect(release).toBeTypeOf('function');
            store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});
            const completed=badge.update(1);release();await Promise.all([pending,completed]);
            expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:1,text:'✓'});
            expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({tabId:1,color:'#15803d'});
        },
    );
    it('已显示原文时，迟到的完成文字写入不能覆盖再次恢复原文', async () => {
        const {store,badge,action}=setup();await badge.update(1);
        let release!:()=>void;
        action.setBadgeText.mockResolvedValueOnce(undefined)
            .mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}));
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});
        const completed=badge.update(1);await settle();
        expect(release).toBeTypeOf('function');
        store.reset(1);const restored=badge.update(1);release();await Promise.all([completed,restored]);
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:1,text:''});
    });
    it('部分写入失败后回到上次完成状态，也能重新显示对勾', async () => {
        const {store,badge,action}=setup();
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});await badge.update(1);
        const error=vi.spyOn(console,'error').mockImplementation(()=>{});
        action.setBadgeBackgroundColor.mockRejectedValueOnce(new Error('temporary API failure'));
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translating'});await badge.update(1);
        store.set(1,{isTranslated:true,isSiteDisabled:false,toolbarStatus:'translated'});await badge.update(1);
        expect(error).toHaveBeenCalled();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId:1,text:'✓'});
    });
});
