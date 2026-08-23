import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('host-page trust boundary', () => {
  it('does not expose page-dispatchable configuration or full-page controls', () => {
    const content = source('entrypoints/content.ts');
    const floatingBall = source('components/FloatingBall.vue');

    expect(existsSync(resolve(process.cwd(), 'entrypoints/utils/newApi.ts'))).toBe(false);
    expect(content).not.toContain('fluent:prefill');
    expect(content).not.toContain('fluentread-toggle-translation');
    expect(floatingBall).not.toContain('fluentread-toggle-translation');
    expect(content).toContain('toggleFloatingBallTranslation()');
  });

  it('rejects synthetic input before network and screenshot side effects', () => {
    const content = source('entrypoints/content.ts');
    const area = source('components/AreaTranslator.vue');
    const selection = source('components/SelectionTranslator.vue');
    const image = source('entrypoints/utils/imageTranslation.ts');
    const video = source('entrypoints/main/videoSubtitle.ts');

    expect(content.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(10);
    expect(area.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(6);
    expect(selection).toContain('TRUSTED_SELECTION_INTERACTION_GRACE_MS');
    expect(image.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(video.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps privileged controls and translated bitmaps out of page-visible shadow roots', () => {
    expect(source('entrypoints/utils/floatingBall.ts')).toContain("mode: 'closed'");
    expect(source('entrypoints/utils/selectionTranslator.ts')).toContain("mode: 'closed'");
    expect(source('entrypoints/content.ts')).toContain("mode: 'closed'");
    expect(source('entrypoints/utils/areaTranslator.ts')).toContain("mode: 'closed'");
    expect(source('entrypoints/utils/imageTranslation.ts')).toContain("attachShadow({ mode: 'closed' })");
  });
});
