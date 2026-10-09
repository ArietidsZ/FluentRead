import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES, normalizeInformationHighlightPreferences} from '@/src/core/config/informationHighlight';

describe('信息高亮偏好与配置迁移', () => {
    it('旧配置和非法字段获得独立默认值，不保存页面启用状态', () => {
        for (const value of [undefined, null, [], false, '', {mode:'cloud',density:NaN,color:'red',style:'bold'}]) {
            expect(normalizeInformationHighlightPreferences(value)).toEqual(DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES);
            expect(normalizeConfig({informationHighlight:value}).informationHighlight).toEqual(DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES);
        }
        const first=new Config(); const second=new Config();
        first.informationHighlight.color='blue';
        expect(second.informationHighlight.color).toBe('amber');
        expect(Object.keys(second.informationHighlight)).not.toContain('enabled');
    });
    it('合法设置可往返，源对象不被改写，未知会话字段被移除', () => {
        for (const mode of ['keywords','surprisal-local'] as const) for (const density of ['low','medium','high'] as const)
            for (const color of ['amber','mint','blue'] as const) for (const style of ['background','underline'] as const) {
                const preferences={mode,density,color,style};
                const source={informationHighlight:{...preferences,enabled:true}};
                const normalized=normalizeConfig(source);
                expect(normalized.informationHighlight).toEqual(preferences);
                expect(normalizeConfig(JSON.parse(JSON.stringify(normalized))).informationHighlight).toEqual(preferences);
                expect(source.informationHighlight.enabled).toBe(true);
            }
    });
});
