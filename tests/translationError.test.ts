import {describe, expect, it} from 'vitest';

import {serializeTranslationError} from '@/entrypoints/utils/translationError';

describe('translation error serialization', () => {
  it('prioritizes rate-limit evidence over a generic API-key mention', () => {
    expect(serializeTranslationError(
      new Error('Rate limit reached for API key tenant-1 (HTTP 429)'),
    )).toMatchObject({kind: 'rate-limit', retryable: true});
  });

  it('recognizes explicit credential failures without treating model setup as authentication', () => {
    expect(serializeTranslationError(new Error('HTTP 401 Unauthorized')))
      .toMatchObject({kind: 'authentication', retryable: false});
    expect(serializeTranslationError(new Error('模型尚未配置')))
      .toMatchObject({kind: 'bad-request', retryable: false});
  });
});
