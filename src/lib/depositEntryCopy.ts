export interface CopyableDepositSigner {
  id: string;
  fullName: string;
}

export interface CopyableDepositEntry {
  basisChoice: string;
  customBasis: string;
  basisDetails: string;
  signers: CopyableDepositSigner[];
}

export const copyDepositIdentity = (
  source: CopyableDepositEntry,
  signatures: ReadonlyMap<string, string>,
  createId: () => string = () => crypto.randomUUID(),
) => {
  const copiedSignatures = new Map<string, string>();
  const signers = source.signers.map(signer => {
    const id = createId();
    const signature = signatures.get(signer.id);
    if (signature) copiedSignatures.set(id, signature);
    return { id, fullName: signer.fullName };
  });

  return {
    basisChoice: source.basisChoice,
    customBasis: source.customBasis,
    basisDetails: source.basisDetails,
    signers,
    signatures: copiedSignatures,
  };
};
