import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createVideoPlayerMenu, handleVideoMenuNavigation, renderVideoSourceStatus, setVideoMenuToolsOpen} from '@/src/features/video-subtitle/content/playerMenu';

function fixture(markup = '') {
    const {document, window} = parseHTML(`<!doctype html><body>${markup}</body>`);
    vi.stubGlobal('document', document); vi.stubGlobal('window', window);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    let active: Element | null = null;
    Object.defineProperty(document, 'activeElement', {configurable: true, get: () => active});
    const track = (root: Element) => {
        for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
            button.focus = () => { active = button; };
        }
    };
    return {document, track};
}
// Direct handler contracts use explicit event records; these are not native trusted-browser input evidence.
function key(menu: HTMLElement, target: EventTarget | null, value: string, trusted = true) {
    const event = {currentTarget: menu, target, key: value, isTrusted: trusted,
        stopPropagation: vi.fn(), preventDefault: vi.fn()};
    handleVideoMenuNavigation(event as unknown as KeyboardEvent);
    return event;
}
afterEach(() => vi.unstubAllGlobals());

describe('video menu keyboard contract', () => {
    it('navigates only enabled visible buttons, wraps and preserves non-navigation shortcuts', () => {
        const f = fixture('<div id="menu"><button id="first"></button><button disabled></button><div hidden><button></button></div><button id="last"></button></div>');
        const menu = f.document.getElementById('menu')!; f.track(menu);
        const first = f.document.getElementById('first')!, last = f.document.getElementById('last')!;
        for (const [target, value, expected] of [[first, 'ArrowDown', last], [last, 'ArrowDown', first],
            [first, 'ArrowUp', last], [first, 'End', last], [last, 'Home', first]] as const) {
            const event = key(menu, target, value);
            expect(f.document.activeElement).toBe(expected);
            expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
        }
        const space = key(menu, first, ' ');
        expect(space.stopPropagation).toHaveBeenCalledOnce(); expect(space.preventDefault).not.toHaveBeenCalled();
    });
    it('restricts horizontal keys to the mode group and rejects invalid or nontrusted targets', () => {
        const f = fixture('<div id="menu"><div class="fluent-read-video-menu-mode-group"><button id="a"></button><button id="b"></button></div><button id="outside-group"></button><span id="nonbutton"></span></div><button id="outside"></button>');
        const menu = f.document.getElementById('menu')!; f.track(menu);
        const a = f.document.getElementById('a')!, b = f.document.getElementById('b')!;
        key(menu, a, 'ArrowLeft'); expect(f.document.activeElement).toBe(b);
        key(menu, b, 'ArrowRight'); expect(f.document.activeElement).toBe(a);
        expect(key(menu, f.document.getElementById('outside-group'), 'ArrowRight').preventDefault).not.toHaveBeenCalled();
        key(menu, f.document.getElementById('nonbutton'), 'ArrowDown'); expect(f.document.activeElement).toBe(a);
        for (const target of [null, f.document.createTextNode('text'), f.document.getElementById('outside')]) {
            expect(key(menu, target, 'Home').stopPropagation).not.toHaveBeenCalled();
        }
        expect(key(menu, a, 'Home', false).stopPropagation).not.toHaveBeenCalled();
        for (const button of menu.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true;
        expect(key(menu, a, 'Home').preventDefault).not.toHaveBeenCalled();
    });
    it('leaves non-local and incomplete layouts unchanged when tools or source sections are absent', () => {
        const f = fixture();
        const plain = createVideoPlayerMenu('en-US', false), before = plain.outerHTML;
        setVideoMenuToolsOpen(plain, true);
        renderVideoSourceStatus(plain, {enabled: true, source: 'native', cueCount: 1,
            checking: false, generating: false, translationFailed: false, canRegenerate: false}, 'en-US');
        expect(plain.outerHTML).toBe(before);
        const partial = f.document.createElement('div');
        partial.innerHTML = '<div class="fluent-read-video-menu-watch"></div>';
        const original = partial.outerHTML;
        setVideoMenuToolsOpen(partial, true);
        expect(partial.outerHTML).toBe(original);
    });
    it('ignores synchronous reentry during a focused local-action move and releases the guard afterward', () => {
        const f = fixture(), menu = createVideoPlayerMenu('en-US', true);
        menu.hidden = false; f.document.body.appendChild(menu); f.track(menu);
        const secondary = menu.querySelector<HTMLElement>('.fluent-read-video-menu-secondary-ai')!;
        const local = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]')!;
        local.focus();
        const state = {enabled: true, source: 'native' as const, cueCount: 1,
            checking: false, generating: false, translationFailed: false, canRegenerate: false};
        const append = secondary.appendChild.bind(secondary);
        const nested = vi.fn((node: Node) => {
            renderVideoSourceStatus(menu, {...state, source: 'ai'}, 'en-US');
            return append(node);
        });
        secondary.appendChild = nested as typeof secondary.appendChild;
        renderVideoSourceStatus(menu, state, 'en-US');
        expect(nested).toHaveBeenCalledOnce();
        expect(local.dataset.native).toBe('true');
        renderVideoSourceStatus(menu, {...state, source: 'ai'}, 'en-US');
        expect(local.dataset.native).toBe('false');
    });
    it.each([true, false])('restores focus when local action moves behind tools (checked mode=%s)', checked => {
        const f = fixture(); const menu = createVideoPlayerMenu('en-US', true);
        menu.hidden = false; f.document.body.appendChild(menu); f.track(menu);
        const mode = menu.querySelector<HTMLButtonElement>('[data-mode]')!;
        if (checked) mode.setAttribute('aria-checked', 'true');
        const local = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]')!;
        local.focus();
        renderVideoSourceStatus(menu, {enabled: true, source: 'native', cueCount: 1,
            checking: false, generating: false, translationFailed: false, canRegenerate: false}, 'en-US');
        expect(local.closest('.fluent-read-video-menu-secondary-ai')).not.toBeNull();
        expect(f.document.activeElement).toBe(checked ? mode : local);
    });
});
