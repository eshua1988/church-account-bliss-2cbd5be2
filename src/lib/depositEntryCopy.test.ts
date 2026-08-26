import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { copyDepositIdentity } from './depositEntryCopy.ts';

describe('copyDepositIdentity', () => {
  it('copies the basis, every sender name, and every signature with new ids', () => {
    const ids = ['new-signer-1', 'new-signer-2'];
    const copied = copyDepositIdentity({
      basisChoice: 'donation',
      customBasis: '',
      basisDetails: 'youth ministry',
      signers: [
        { id: 'old-signer-1', fullName: 'Jan Kowalski' },
        { id: 'old-signer-2', fullName: 'Anna Nowak' },
      ],
    }, new Map([
      ['old-signer-1', 'signature-one'],
      ['old-signer-2', 'signature-two'],
    ]), () => ids.shift()!);

    assert.deepEqual({
      basisChoice: copied.basisChoice,
      customBasis: copied.customBasis,
      basisDetails: copied.basisDetails,
      signers: copied.signers,
    }, {
      basisChoice: 'donation',
      customBasis: '',
      basisDetails: 'youth ministry',
      signers: [
        { id: 'new-signer-1', fullName: 'Jan Kowalski' },
        { id: 'new-signer-2', fullName: 'Anna Nowak' },
      ],
    });
    assert.deepEqual(
      [...copied.signatures],
      [
        ['new-signer-1', 'signature-one'],
        ['new-signer-2', 'signature-two'],
      ],
    );
  });
});
