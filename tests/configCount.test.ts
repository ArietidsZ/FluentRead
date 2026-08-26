import {describe, expect, it, vi} from 'vitest';

import {createConfigCountIncrementHandler} from '@/src/app/background/handlers/configCount';
import {
    CONFIG_COUNT_INCREMENT_MAX,
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
} from '@/src/services/config/count';

describe('配置计数增量协议', () => {
    it('只接受有界的正安全整数', () => {
        expect(parseConfigCountIncrement(1)).toBe(1);
        expect(parseConfigCountIncrement(CONFIG_COUNT_INCREMENT_MAX)).toBe(CONFIG_COUNT_INCREMENT_MAX);
        for (const value of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, CONFIG_COUNT_INCREMENT_MAX + 1]) {
            expect(parseConfigCountIncrement(value)).toBeNull();
        }
    });

    it('handler 只把验证后的增量交给后台原子更新', async () => {
        const increment = vi.fn(async (delta: number) => 40 + delta);
        const handler = createConfigCountIncrementHandler(increment);

        await expect(handler.handle({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 2,
        }, {})).resolves.toEqual({success: true, count: 42});
        await expect(handler.handle({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 0,
        }, {})).resolves.toEqual({success: false, error: '无效的翻译计数增量'});
        expect(increment).toHaveBeenCalledOnce();
        expect(increment).toHaveBeenCalledWith(2);
    });
});
