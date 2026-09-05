import {describe, expect, it, vi} from 'vitest';

import {
  LOCAL_VIDEO_MODEL_STATUS_ERROR,
  requestLocalVideoModelReadiness,
} from '@/src/features/video-subtitle/content/localModelReadiness';

describe('local video model readiness port', () => {
  it('returns ready only when the normalized requested model is cached', async () => {
    const sendMessage = vi.fn(async (message: {type: string}) => {
      expect(message).toEqual({type: 'fluentReadGetLocalVideoModelState'});
      return {success: true, models: ['base', 'tiny', 'tiny']};
    });

    await expect(requestLocalVideoModelReadiness('base', sendMessage)).resolves.toBe('ready');
    await expect(requestLocalVideoModelReadiness('unknown-model', sendMessage)).resolves.toBe('ready');
    await expect(requestLocalVideoModelReadiness('base', vi.fn(async () => ({success: true, models: ['tiny']}))))
      .resolves.toBe('missing');
  });

  it('treats a valid empty list as missing without confusing it with a failed read', async () => {
    const sendMessage = vi.fn(async () => ({success: true, models: []}));
    await expect(requestLocalVideoModelReadiness('tiny', sendMessage)).resolves.toBe('missing');
  });

  it.each([
    undefined,
    null,
    {success: false, models: []},
    {success: true},
    {success: true, models: null},
    {success: true, models: 'tiny'},
    {success: true, models: ['tiny', 'not-a-model']},
    {success: true, models: ['']},
    {success: true, models: [42]},
  ])('rejects malformed or unsuccessful response %#', async (response) => {
    await expect(requestLocalVideoModelReadiness(
      'tiny',
      vi.fn(async () => response),
    )).rejects.toThrow(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  });

  it('maps a rejected message port to the actionable status error', async () => {
    await expect(requestLocalVideoModelReadiness(
      'tiny',
      vi.fn(async () => { throw new Error('background unavailable'); }),
    )).rejects.toThrow(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  });
});
