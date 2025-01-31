/*global fetch */

import Web3 from 'web3';
import RewardPoolABI from '../../contracts/abi/v0.8.5/reward-pool';
import { Contract, ContractOptions } from 'web3-eth-contract';
import { getAddress } from '../../contracts/addresses';
import { AbiItem, fromWei, toWei } from 'web3-utils';
import { signRewardSafe, signSafeTx, createEIP1271VerifyingData } from '../utils/signing-utils';
import { getSDK } from '../version-resolver';
import { getConstant, ZERO_ADDRESS } from '../constants';
import BN from 'bn.js';
import ERC20ABI from '../../contracts/abi/erc-20';
import ERC677ABI from '../../contracts/abi/erc-677';
import { gasEstimate, executeTransaction, getNextNonceFromEstimate } from '../utils/safe-utils';
import { isTransactionHash, TransactionOptions, waitForSubgraphIndexWithTxnReceipt } from '../utils/general-utils';
import { TransactionReceipt } from 'web3-core';
interface Proof {
  rootHash: string;
  paymentCycle: number;
  tokenAddress: string;
  payee: string;
  proof: string;
  timestamp: string;
  blockNumber: number;
  rewardProgramId: string;
}

const DEFAULT_PAGE_SIZE = 1000000;

export interface RewardTokenBalance {
  rewardProgramId: string;
  tokenAddress: string;
  tokenSymbol: string;
  balance: BN;
}

export interface ProofWithBalance extends Proof {
  tokenSymbol: string;
  balance: BN;
}
export default class RewardPool {
  private rewardPool: Contract | undefined;

  constructor(private layer2Web3: Web3) {}

  async getCurrentPaymentCycle(): Promise<string> {
    return await (await this.getRewardPool()).methods.numPaymentCycles().call();
  }

  async getBalanceForProof(
    rewardProgramId: string,
    tokenAddress: string,
    address: string,
    proof: string
  ): Promise<string> {
    return (await this.getRewardPool()).methods
      .balanceForProofWithAddress(rewardProgramId, tokenAddress, address, proof)
      .call();
  }

  async getBalanceForPool(tokenAddress: string): Promise<string> {
    let rewardPoolAddress = await getAddress('rewardPool', this.layer2Web3);
    const tokenContract = new this.layer2Web3.eth.Contract(ERC20ABI as AbiItem[], tokenAddress);
    return await tokenContract.methods.balanceOf(rewardPoolAddress).call();
  }

  // Utility function
  // - it is important to use this if there are many reward tokens
  async rewardTokensAvailable(address: string, rewardProgramId?: string): Promise<string[]> {
    let tallyServiceURL = await getConstant('tallyServiceURL', this.layer2Web3);
    let url =
      `${tallyServiceURL}/reward-tokens/${address}` + (rewardProgramId ? `?reward_program_id=${rewardProgramId}` : '');

    let options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };
    let response = await fetch(url, options);
    if (!response?.ok) {
      throw new Error(await response.text());
    }
    let json = await response.json();
    return json['tokenAddresses'];
  }

  async getProofs(
    address: string,
    rewardProgramId?: string,
    tokenAddress?: string,
    offset?: number,
    limit?: number
  ): Promise<Proof[]> {
    let tallyServiceURL = await getConstant('tallyServiceURL', this.layer2Web3);
    let url = new URL(`${tallyServiceURL}/merkle-proofs/${address}`);
    if (tokenAddress) {
      url.searchParams.append('token_address', tokenAddress);
    }
    if (rewardProgramId) {
      url.searchParams.append('reward_program_id', rewardProgramId);
    }
    if (offset) {
      url.searchParams.append('offset', offset.toString());
    }
    url.searchParams.append('limit', limit ? limit.toString() : DEFAULT_PAGE_SIZE.toString());
    let options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };
    let response = await fetch(url.toString(), options);
    let json = await response.json();
    if (!response?.ok) {
      throw new Error(await response.text());
    }
    return json['results'];
  }

  async getProofsWithBalance(
    address: string,
    rewardProgramId?: string,
    tokenAddress?: string
  ): Promise<ProofWithBalance[]> {
    let rewardPool = await this.getRewardPool();
    let proofs = await this.getProofs(address, rewardProgramId, tokenAddress);
    const tokenAddresses = [...new Set(proofs.map((item) => item.tokenAddress))];
    let tokenMapping = await this.tokenSymbolMapping(tokenAddresses);
    return await Promise.all(
      proofs.map(async (o: Proof) => {
        const balance = await rewardPool.methods
          .balanceForProofWithAddress(o.rewardProgramId, o.tokenAddress, address, o.proof)
          .call();
        return {
          ...o,
          balance: new BN(balance),
          tokenSymbol: tokenMapping[o.tokenAddress],
        };
      })
    );
  }

  async getProofsWithNonZeroBalance(
    address: string,
    rewardProgramId?: string,
    tokenAddress?: string
  ): Promise<ProofWithBalance[]> {
    const proofsWithBalance = await this.getProofsWithBalance(address, rewardProgramId, tokenAddress);
    return proofsWithBalance
      .filter(({ balance }) => {
        return balance.gt(new BN(0));
      })
      .sort(compare);
  }

  async rewardTokenBalance(
    address: string,
    tokenAddress: string,
    rewardProgramId?: string
  ): Promise<RewardTokenBalance> {
    let rewardTokensAvailable = await this.rewardTokensAvailable(address, rewardProgramId);
    if (!rewardTokensAvailable.includes(tokenAddress)) {
      throw new Error(`Payee does not have any reward token ${tokenAddress}`);
    }
    const tokenContract = new this.layer2Web3.eth.Contract(ERC20ABI as AbiItem[], tokenAddress);
    let tokenSymbol = await tokenContract.methods.symbol().call();
    let proofs = await this.getProofs(address, rewardProgramId, tokenAddress);

    let rewardPool = await this.getRewardPool();
    let ungroupedTokenBalance = await Promise.all(
      proofs.map(async (o: Proof) => {
        const balance = await rewardPool.methods
          .balanceForProofWithAddress(o.rewardProgramId, o.tokenAddress, address, o.proof)
          .call();
        return {
          rewardProgramId: o.rewardProgramId,
          tokenAddress: o.tokenAddress,
          tokenSymbol,
          balance: new BN(balance),
        };
      })
    );
    return ungroupedTokenBalance.reduce(
      (accum, { tokenAddress, tokenSymbol, balance, rewardProgramId }: RewardTokenBalance) => {
        return {
          rewardProgramId,
          tokenAddress,
          tokenSymbol,
          balance: accum.balance.add(balance),
        };
      }
    );
  }

  async rewardTokenBalances(address: string, rewardProgramId?: string): Promise<RewardTokenBalance[]> {
    let rewardPool = await this.getRewardPool();
    if (rewardProgramId) {
      let rewardTokensAvailable = await this.rewardTokensAvailable(address, rewardProgramId);
      return await Promise.all(
        rewardTokensAvailable.map(async (tokenAddress: string) => {
          return this.rewardTokenBalance(address, tokenAddress, rewardProgramId);
        })
      );
    } else {
      let proofs = await this.getProofs(address);
      let ungroupedTokenBalanceWithoutSymbol = await Promise.all(
        proofs.map(async (o: Proof) => {
          const balance = await rewardPool.methods
            .balanceForProofWithAddress(o.rewardProgramId, o.tokenAddress, address, o.proof)
            .call();
          return {
            tokenAddress: o.tokenAddress,
            rewardProgramId: o.rewardProgramId,
            balance: new BN(balance),
          };
        })
      );
      const tokenAddresses = [...new Set(ungroupedTokenBalanceWithoutSymbol.map((item) => item.tokenAddress))];
      let tokenMapping = await this.tokenSymbolMapping(tokenAddresses);
      let ungroupedTokenBalance = ungroupedTokenBalanceWithoutSymbol.map((o) => {
        return {
          ...o,
          tokenSymbol: tokenMapping[o.tokenAddress],
        };
      });
      return aggregateBalance(ungroupedTokenBalance);
    }
  }

  async addRewardTokens(txnHash: string): Promise<TransactionReceipt>;
  async addRewardTokens(
    safeAddress: string,
    rewardProgramId: string,
    tokenAddress: string,
    amount: string,
    txnOptions?: TransactionOptions,
    contractOptions?: ContractOptions
  ): Promise<TransactionReceipt>;
  async addRewardTokens(
    safeAddressOrTxnHash: string,
    rewardProgramId?: string,
    tokenAddress?: string,
    amount?: string,
    txnOptions?: TransactionOptions,
    contractOptions?: ContractOptions
  ): Promise<TransactionReceipt> {
    if (isTransactionHash(safeAddressOrTxnHash)) {
      let txnHash = safeAddressOrTxnHash;
      return await waitForSubgraphIndexWithTxnReceipt(this.layer2Web3, txnHash);
    }
    let safeAddress = safeAddressOrTxnHash;
    if (!rewardProgramId) {
      throw new Error('rewardProgramId must be provided');
    }
    if (!tokenAddress) {
      throw new Error('tokenAddress must be provided');
    }
    if (!amount) {
      throw new Error('amount must be provided');
    }

    let rewardManager = await getSDK('RewardManager', this.layer2Web3);

    if (!(await rewardManager.isRewardProgram(rewardProgramId))) {
      throw new Error('reward program does not exist');
    }

    let from = contractOptions?.from ?? (await this.layer2Web3.eth.getAccounts())[0];
    let token = new this.layer2Web3.eth.Contract(ERC677ABI as AbiItem[], tokenAddress);
    let symbol = await token.methods.symbol().call();
    let balance = new BN(await token.methods.balanceOf(safeAddress).call());
    let weiAmount = new BN(toWei(amount));
    if (balance.lt(weiAmount)) {
      throw new Error(
        `Safe does not have enough balance add reward tokens. The reward token ${tokenAddress} balance of the safe ${safeAddress} is ${fromWei(
          balance
        )}, the total amount necessary to add reward tokens is ${fromWei(weiAmount)} ${symbol} + a small amount for gas`
      );
    }
    let payload = await this.getAddRewardTokensPayload(rewardProgramId, tokenAddress, weiAmount);
    let estimate = await gasEstimate(this.layer2Web3, safeAddress, tokenAddress, '0', payload, 0, tokenAddress);
    let { nonce, onNonce, onTxnHash } = txnOptions ?? {};

    if (nonce == null) {
      nonce = getNextNonceFromEstimate(estimate);
      if (typeof onNonce === 'function') {
        onNonce(nonce);
      }
    }
    let gnosisTxn = await executeTransaction(
      this.layer2Web3,
      safeAddress,
      tokenAddress,
      payload,
      estimate,
      nonce,
      await signSafeTx(this.layer2Web3, safeAddress, tokenAddress, payload, estimate, nonce, from)
    );
    if (typeof onTxnHash === 'function') {
      await onTxnHash(gnosisTxn.ethereumTx.txHash);
    }
    return await waitForSubgraphIndexWithTxnReceipt(this.layer2Web3, gnosisTxn.ethereumTx.txHash);
  }

  async claim(txnHash: string): Promise<TransactionReceipt>;
  async claim(
    safeAddress: string,
    rewardProgramId: string,
    tokenAddress: string,
    proof: string,
    amount?: string,
    txnOptions?: TransactionOptions,
    contractOptions?: ContractOptions
  ): Promise<TransactionReceipt>;
  async claim(
    safeAddressOrTxnHash: string,
    rewardProgramId?: string,
    tokenAddress?: string,
    proof?: string,
    amount?: string,
    txnOptions?: TransactionOptions,
    contractOptions?: ContractOptions
  ): Promise<TransactionReceipt> {
    if (isTransactionHash(safeAddressOrTxnHash)) {
      let txnHash = safeAddressOrTxnHash;
      return await waitForSubgraphIndexWithTxnReceipt(this.layer2Web3, txnHash);
    }
    let safeAddress = safeAddressOrTxnHash;
    if (!rewardProgramId) {
      throw new Error('rewardProgramId must be provided');
    }
    if (!tokenAddress) {
      throw new Error('tokenAddress must be provided');
    }
    if (!proof) {
      throw new Error('proof must be provided');
    }

    let rewardManager = await getSDK('RewardManager', this.layer2Web3);

    if (!(await rewardManager.isRewardProgram(rewardProgramId))) {
      throw new Error('reward program does not exist');
    }

    let from = contractOptions?.from ?? (await this.layer2Web3.eth.getAccounts())[0];
    let rewardSafeOwner = await rewardManager.getRewardSafeOwner(safeAddress);
    let unclaimedRewards = new BN(await this.getBalanceForProof(rewardProgramId, tokenAddress, rewardSafeOwner, proof));
    let rewardPoolBalanceForRewardProgram = (await this.balance(rewardProgramId, tokenAddress)).balance;

    if (!(rewardSafeOwner == from)) {
      throw new Error(
        `Reward safe owner is NOT the signer of transaction.
The owner of reward safe ${safeAddress} is ${rewardSafeOwner}, but the signer is ${from}`
      );
    }
    let weiAmount = amount ? new BN(toWei(amount)) : unclaimedRewards;
    if (weiAmount.gt(unclaimedRewards)) {
      throw new Error(
        `Insufficient rewards for rewardSafeOwner.
For the proof, the reward safe owner can only redeem ${unclaimedRewards} but user is asking for ${amount}`
      );
    }

    if (weiAmount.gt(rewardPoolBalanceForRewardProgram)) {
      throw new Error(
        `Insufficient funds inside reward pool for reward program.
The reward program ${rewardProgramId} has balance equals ${fromWei(
          rewardPoolBalanceForRewardProgram.toString()
        )} but user is asking for ${amount}`
      );
    }
    let rewardPoolAddress = await getAddress('rewardPool', this.layer2Web3);

    let payload = (await this.getRewardPool()).methods
      .claim(rewardProgramId, tokenAddress, weiAmount, proof)
      .encodeABI();
    let estimate = await gasEstimate(this.layer2Web3, safeAddress, rewardPoolAddress, '0', payload, 0, tokenAddress);

    let gasCost = new BN(estimate.safeTxGas).add(new BN(estimate.baseGas)).mul(new BN(estimate.gasPrice));
    if (weiAmount.lt(gasCost)) {
      throw new Error(
        `Reward safe does not have enough to pay for gas when claiming rewards. The reward safe ${safeAddress} unclaimed balance for token ${tokenAddress} is ${fromWei(
          unclaimedRewards
        )}, amount being claimed is ${amount}, the gas cost is ${fromWei(gasCost)}`
      );
    }
    let { nonce, onNonce, onTxnHash } = txnOptions ?? {};

    if (nonce == null) {
      nonce = getNextNonceFromEstimate(estimate);
      if (typeof onNonce === 'function') {
        onNonce(nonce);
      }
    }
    let fullSignature = await signRewardSafe(
      this.layer2Web3,
      rewardPoolAddress,
      0,
      payload,
      0,
      estimate,
      tokenAddress,
      ZERO_ADDRESS,
      nonce,
      rewardSafeOwner,
      safeAddress,
      await getAddress('rewardManager', this.layer2Web3)
    );

    let eip1271Data = createEIP1271VerifyingData(
      this.layer2Web3,
      rewardPoolAddress,
      '0',
      payload,
      '0',
      estimate.safeTxGas,
      estimate.baseGas,
      estimate.gasPrice,
      tokenAddress,
      ZERO_ADDRESS,
      nonce.toString()
    );
    let gnosisTxn = await executeTransaction(
      this.layer2Web3,
      safeAddress,
      rewardPoolAddress,
      payload,
      estimate,
      nonce,
      fullSignature,
      eip1271Data
    );
    if (typeof onTxnHash === 'function') {
      await onTxnHash(gnosisTxn.ethereumTx.txHash);
    }
    return await waitForSubgraphIndexWithTxnReceipt(this.layer2Web3, gnosisTxn.ethereumTx.txHash);
  }

  async balance(rewardProgramId: string, tokenAddress: string): Promise<RewardTokenBalance> {
    let balance: string = await (await this.getRewardPool()).methods
      .rewardBalance(rewardProgramId, tokenAddress)
      .call();
    let tokenContract = new this.layer2Web3.eth.Contract(ERC20ABI as AbiItem[], tokenAddress);
    let tokenSymbol = await tokenContract.methods.symbol().call();
    return {
      rewardProgramId,
      tokenAddress,
      tokenSymbol,
      balance: new BN(balance),
    };
  }

  async address(): Promise<string> {
    return await getAddress('rewardPool', this.layer2Web3);
  }

  private async getAddRewardTokensPayload(rewardProgramId: string, tokenAddress: string, amount: BN): Promise<string> {
    let token = new this.layer2Web3.eth.Contract(ERC677ABI as AbiItem[], tokenAddress);
    let rewardPoolAddress = await getAddress('rewardPool', this.layer2Web3);
    let data = this.layer2Web3.eth.abi.encodeParameters(['address'], [rewardProgramId]);
    return token.methods.transferAndCall(rewardPoolAddress, amount, data).encodeABI();
  }

  private async tokenSymbolMapping(tokenAddresses: string[]): Promise<any> {
    let o = {};
    await Promise.all(
      tokenAddresses.map(async (tokenAddress: string) => {
        const tokenContract = new this.layer2Web3.eth.Contract(ERC20ABI as AbiItem[], tokenAddress);
        const tokenSymbol = await tokenContract.methods.symbol().call();
        o = {
          ...o,
          [tokenAddress]: tokenSymbol,
        };
      })
    );
    return o;
  }
  private async getRewardPool(): Promise<Contract> {
    if (this.rewardPool) {
      return this.rewardPool;
    }
    this.rewardPool = new this.layer2Web3.eth.Contract(
      RewardPoolABI as AbiItem[],
      await getAddress('rewardPool', this.layer2Web3)
    );
    return this.rewardPool;
  }
}

const aggregateBalance = (arr: RewardTokenBalance[]): RewardTokenBalance[] => {
  let output: RewardTokenBalance[] = [];
  arr.forEach(function (item) {
    let existing = output.filter(function (v) {
      return v.rewardProgramId == item.rewardProgramId && v.tokenAddress == item.tokenAddress;
    });
    if (existing.length) {
      var existingIndex = output.indexOf(existing[0]);
      output[existingIndex].balance = output[existingIndex].balance.add(item.balance);
    } else {
      output.push(item);
    }
  });
  return output;
};

function compare(a: ProofWithBalance, b: ProofWithBalance) {
  if (a.balance.lt(b.balance)) {
    return 1;
  }
  if (a.balance.gt(b.balance)) {
    return -1;
  }
  return 0;
}
