import { createHmac } from 'crypto';
import {
  Bip32PublicKey,
  BaseAddress,
  NetworkInfo,
  StakeCredential,
  RewardAddress,
  ByronAddress,
} from '@emurgo/cardano-serialization-lib-nodejs';
import AssetFingerprint from '@emurgo/cip14-js';
import { ParseAssetResult } from '../types/utils';
import { SignatureVerificationError } from './errors';
import { isDebugEnabled } from './index';

/**
 * Derives an address with derivation path m/1852'/1815'/account'/role/addressIndex
 * If role === 2 then it returns a stake address (m/1852'/1815'/account'/2/addressIndex)
 *
 * @Returns {address: string, path: number[] } Bech32 address shaped as {address: string, path: [role, addressIndex]}
 * */
export const deriveAddress = (
  accountPublicKey: string,
  role: number,
  addressIndex: number,
  isTestnet: boolean,
  isByron?: boolean,
): { address: string; path: [number, number] } => {
  const accountKey = Bip32PublicKey.from_bytes(
    Buffer.from(accountPublicKey, 'hex'),
  );
  const utxoPubKey = accountKey.derive(role).derive(addressIndex);
  const mainStakeKey = accountKey.derive(2).derive(0);

  const networkId = isTestnet
    ? NetworkInfo.testnet().network_id()
    : NetworkInfo.mainnet().network_id();

  const baseAddr = BaseAddress.new(
    networkId,
    StakeCredential.from_keyhash(utxoPubKey.to_raw_key().hash()),
    StakeCredential.from_keyhash(mainStakeKey.to_raw_key().hash()),
  );

  if (role === 2 && !isByron) {
    const addressSpecificStakeKey = accountKey.derive(2).derive(addressIndex);
    // always return stake address
    const rewardAddr = RewardAddress.new(
      networkId,
      StakeCredential.from_keyhash(addressSpecificStakeKey.to_raw_key().hash()),
    )
      .to_address()
      .to_bech32();
    return {
      address: rewardAddr,
      path: [role, addressIndex],
    };
  }

  if (isByron) {
    const protocolMagic = isTestnet
      ? NetworkInfo.testnet().protocol_magic()
      : NetworkInfo.mainnet().protocol_magic();

    const byronAddress = ByronAddress.icarus_from_key(
      utxoPubKey,
      protocolMagic,
    );

    return {
      address: byronAddress.to_base58(),
      path: [role, addressIndex],
    };
  }

  return {
    address: baseAddr.to_address().to_bech32(),
    path: [role, addressIndex],
  };
};

export const hexToString = (input: string): string => {
  const hex = input.toString();
  let str = '';
  for (let n = 0; n < hex.length; n += 2) {
    str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
  }

  return str;
};

export const getFingerprint = (policyId: string, assetName?: string): string =>
  AssetFingerprint.fromParts(
    Uint8Array.from(Buffer.from(policyId, 'hex')),
    Uint8Array.from(Buffer.from(assetName || '', 'hex')),
  ).fingerprint();

export const parseAsset = (hex: string): ParseAssetResult => {
  const policyIdSize = 56;
  const policyId = hex.slice(0, policyIdSize);
  const assetNameInHex = hex.slice(policyIdSize);
  const assetName = hexToString(assetNameInHex);
  const fingerprint = getFingerprint(policyId, assetNameInHex);

  return {
    policyId,
    assetName,
    fingerprint,
  };
};

/**
 * Verifies webhook signature
 *
 * @param {string|Buffer} webhookPayload Buffer or stringified payload of the webhook request.
 * @param {string|Buffer} signatureHeader Blockfrost-Signature header.
 * @param {string} secret Auth token for the webhook.
 * @param {number} [timestampToleranceSeconds=600] Time tolerance affecting signature validity. By default signatures older than 600s are considered invalid.
 * @returns {boolean} Whether the signature is valid.
 * */
export const verifyWebhookSignature = (
  webhookPayload: unknown,
  signatureHeader: string,
  secret: string,
  timestampToleranceSeconds = 600,
) => {
  let timestamp;
  let signature;

  if (Array.isArray(signatureHeader)) {
    throw new SignatureVerificationError(
      'Unexpected: An array was passed as a header',
    );
  }

  const decodedWebhookPayload = Buffer.isBuffer(webhookPayload)
    ? webhookPayload.toString('utf8')
    : webhookPayload;

  const decodedSignatureHeader = Buffer.isBuffer(signatureHeader)
    ? signatureHeader.toString('utf8')
    : signatureHeader;

  // Parse signature header (example: t=1648550558,v1=162381a59040c97d9b323cdfec02facdfce0968490ec1732f5d938334c1eed4e)
  const tokens = decodedSignatureHeader.split(',');
  for (const token of tokens) {
    const [key, value] = token.split('=');
    switch (key) {
      case 't':
        timestamp = Number(value);
        break;
      case 'v1':
        signature = value;
        break;
      default:
        console.warn(
          `Cannot parse part of the signature header, key "${key}" is not supported by this version of Blockfrost SDK.`,
        );
    }
  }

  if (!timestamp || !signature) {
    throw new SignatureVerificationError('Invalid signature header format', {
      signatureHeader: decodedSignatureHeader,
      webhookPayload: decodedWebhookPayload,
    });
  }

  // Recreate signature by concatenating timestamp with stringified payload,
  // then compute HMAC using sha256 and provided secret (auth token)
  const signaturePayload = `${timestamp}.${decodedWebhookPayload}`;
  const hmac = createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');

  if (hmac !== signature) {
    return false;
  }

  // computed hmac should match signature parsed from a signature header
  const currentTimestamp = Math.floor(new Date().getTime() / 1000);
  if (currentTimestamp - timestamp > timestampToleranceSeconds) {
    if (isDebugEnabled()) {
      console.info(
        `Invalid signature. Blockfrost signature timestamp is out of range!`,
      );
    }
    return false;
  } else {
    // Successfully validate the signature only if it is within tolerance
    return true;
  }
};
