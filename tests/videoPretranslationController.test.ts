import {afterEach, describe, expect, it, vi} from 'vitest';
import {VideoPretranslationController, installVideoTranslationLifetime} from '@/src/features/video-subtitle/content/pretranslationController';

const track = (kind = 'captions') => Object.assign(new EventTarget(), {kind}) as unknown as TextTrack;
const video = (tracks: TextTrack[]) => {
  const list = Object.assign(new EventTarget(), {length: tracks.length, [Symbol.iterator]: () => tracks[Symbol.iterator]()});
  return Object.assign(new EventTarget(), {textTracks: list}) as unknown as HTMLVideoElement;
};
afterEach(() => vi.useRealTimers());
describe('VideoPretranslationController', () => {
  it('合并普通更新，立即预取取消等待，并在清理和卸载后停止计时器', () => {
    vi.useFakeTimers();
    const prime = vi.fn();
    const controller = new VideoPretranslationController(prime, vi.fn());
    controller.schedule(); controller.schedule();
    vi.advanceTimersByTime(119); expect(prime).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(prime).toHaveBeenCalledTimes(1);
    controller.schedule(); controller.schedule(true);
    expect(prime).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(120); expect(prime).toHaveBeenCalledTimes(2);
    controller.clear(); controller.schedule(); controller.clear();
    vi.advanceTimersByTime(120); expect(prime).toHaveBeenCalledTimes(2);
    controller.schedule(); controller.destroy(); controller.destroy(); controller.schedule(true); controller.schedule();
    vi.advanceTimersByTime(120); expect(prime).toHaveBeenCalledTimes(2);
  });

  it('轨道加入、删除、选择或 cue 更新立即预取，换视频和销毁释放旧监听', () => {
    const prime = vi.fn(); const changed = vi.fn();
    const caption = track(); const subtitle = track('subtitles'); const metadata = track('metadata');
    const tracks = [caption, metadata];
    const first = video(tracks); const second = video([subtitle]);
    const controller = new VideoPretranslationController(prime, changed);
    controller.observe(null); controller.observe(first); controller.observe(first);
    caption.dispatchEvent(new Event('cuechange')); metadata.dispatchEvent(new Event('cuechange'));
    tracks.push(subtitle); first.textTracks.dispatchEvent(new Event('addtrack'));
    subtitle.dispatchEvent(new Event('cuechange'));
    tracks.splice(0, 1); first.textTracks.dispatchEvent(new Event('removetrack'));
    caption.dispatchEvent(new Event('cuechange'));
    first.textTracks.dispatchEvent(new Event('change'));
    expect(prime).toHaveBeenCalledTimes(5); expect(changed).toHaveBeenCalledTimes(5);
    controller.observe(second);
    first.textTracks.dispatchEvent(new Event('change')); first.dispatchEvent(new Event('load'));
    subtitle.dispatchEvent(new Event('cuechange'));
    expect(prime).toHaveBeenCalledTimes(6);
    controller.destroy(); controller.observe(first);
    second.textTracks.dispatchEvent(new Event('change')); subtitle.dispatchEvent(new Event('cuechange'));
    expect(prime).toHaveBeenCalledTimes(6);
  });

  it('仅当前 video 的 track load 触发预取，忽略其他元素和其他媒体的 load', () => {
    const prime = vi.fn(); const controller = new VideoPretranslationController(prime, vi.fn());
    const current = video([]); controller.observe(current);
    const dispatchLoad = (target: unknown) => {
      const event = new Event('load');
      Object.defineProperty(event, 'target', {value: target});
      current.dispatchEvent(event);
    };
    dispatchLoad(null); dispatchLoad({tagName: 'IMG', parentElement: current});
    dispatchLoad({tagName: 'TRACK', parentElement: video([])});
    expect(prime).not.toHaveBeenCalled();
    dispatchLoad({tagName: 'TRACK', parentElement: current});
    expect(prime).toHaveBeenCalledOnce();
    controller.destroy();
  });
});


describe('native video route/media lifetime owner',()=>{
 it.each([null,{currentSrc:'',src:'preload-source'}])('initial %s deduplicates href/media, ignores unrelated signals and releases listeners twice',initial=>{
  const document=new EventTarget(),events=new EventTarget(),invalidate=vi.fn();const location={href:'https://video.synthetic.test/first'};
  let selected:{currentSrc:string;src:string}|null=initial;const window={location,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)} as unknown as Window;
  const release=installVideoTranslationLifetime(document,window,invalidate,()=>selected);
  document.dispatchEvent(new Event('fluentread-route-change'));document.dispatchEvent(new Event('loadedmetadata'));expect(invalidate).not.toHaveBeenCalled();
  selected={currentSrc:'',src:'first'};document.dispatchEvent(new Event('loadstart'));expect(invalidate).toHaveBeenLastCalledWith(true);document.dispatchEvent(new Event('loadedmetadata'));expect(invalidate).toHaveBeenCalledTimes(1);
  selected.currentSrc='second';document.dispatchEvent(new Event('emptied'));expect(invalidate).toHaveBeenCalledTimes(2);
  selected={currentSrc:'second',src:''};document.dispatchEvent(new Event('loadedmetadata'));expect(invalidate).toHaveBeenCalledTimes(3);
  selected={currentSrc:'',src:''};document.dispatchEvent(new Event('loadedmetadata'));selected=null;document.dispatchEvent(new Event('emptied'));expect(invalidate).toHaveBeenCalledTimes(5);
  location.href='https://video.synthetic.test/second';document.dispatchEvent(new Event('fluentread-route-change'));document.dispatchEvent(new Event('fluentread-route-change'));expect(invalidate).toHaveBeenCalledTimes(6);
  events.dispatchEvent(new Event('pagehide'));expect(invalidate).toHaveBeenLastCalledWith(false);release();release();location.href='https://video.synthetic.test/third';document.dispatchEvent(new Event('fluentread-route-change'));events.dispatchEvent(new Event('pagehide'));selected={currentSrc:'third',src:''};document.dispatchEvent(new Event('loadedmetadata'));expect(invalidate).toHaveBeenCalledTimes(7);
 });
});
