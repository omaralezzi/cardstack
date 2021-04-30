import fetch from 'node-fetch';
import HDWalletProvider from 'parity-hdwallet-provider';
import Web3 from 'web3';
import yargs from 'yargs';
import BN from 'bn.js';
import { HttpProvider, TokenBridge, getConstant, networkIds, getAddress } from '@cardstack/cardpay-sdk';

const { toWei } = Web3.utils;

//@ts-ignore polyfilling fetch
global.fetch = fetch;

const { network, mnemonic = process.env.MNEMONIC_PHRASE, amount } = yargs(process.argv.slice(2))
  .options({
    network: {
      alias: 'n',
      type: 'string',
      description: "The Layer 1 network to ruin this script in ('kovan' or 'mainnet')",
    },
    mnemonic: {
      alias: 'm',
      type: 'string',
      description: 'Phrase for mnemonic wallet. Also can be pulled from env using MNEMONIC_PHRASE',
    },
    amount: {
      alias: 'a',
      type: 'number',
      description: 'Amount in DAI you would like bridged',
    },
  })
  .demandOption(['network'], `'network' must be specified.`)
  .demandOption(['amount'], `'amount' must be specified.`)
  .help().argv;

(async () => {
  if (!mnemonic) {
    throw new Error(
      'No mnemonic is defined, either specify the mnemonic as a positional arg or pass it in using the MNEMONIC_PHRASE env var'
    );
  }
  const amountInWei = toWei(amount.toString()).toString();

  let web3 = new Web3(
    new HDWalletProvider({
      chainId: networkIds[network],
      mnemonic: {
        phrase: mnemonic,
      },
      providerOrUrl: new HttpProvider(await getConstant('rpcNode', network)),
    })
  );
  let tokenBridge = new TokenBridge(web3);
  let tokenAddress = await getAddress('daiToken', web3);
  let blockExplorer = await getConstant('blockExplorer', web3);

  {
    console.log('Sending approve transaction request');
    let result = await tokenBridge.unlockTokens(tokenAddress, new BN(amountInWei));
    console.log(`Approve transaction hash: ${blockExplorer}/tx/${result.transactionHash}`);
  }

  {
    console.log('Sending relay tokens transaction request');
    let result = await tokenBridge.relayTokens(tokenAddress, new BN(amountInWei));
    console.log(`Relay tokens transaction hash: ${blockExplorer}/tx/${result.transactionHash}`);
  }

  process.exit(0); //eslint-disable-line no-process-exit
})().catch((e) => {
  console.error(`Error: ${e}`);
  process.exit(1); //eslint-disable-line no-process-exit
});
