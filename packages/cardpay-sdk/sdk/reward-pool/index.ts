/* eslint @typescript-eslint/naming-convention: "off" */

import { ContractMeta } from '../version-resolver';

import v0_6_0 from './v0.6.0';

// add more versions as we go, but also please do drop version that we don't
// want to maintain simultaneously
export type RewardPool = v0_6_0;

export const rewardPoolMeta = {
  apiVersions: { v0_6_0 },
  contractName: 'rewardPool',
} as ContractMeta;
