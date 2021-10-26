import { AbiItem } from 'web3-utils';
import { ERC20ABI } from '@cardstack/cardpay-sdk/index.js';
import { getAddressByNetwork, AddressKeys } from '@cardstack/cardpay-sdk';
import { ChainAddress } from './web3-strategies/types';
import { NetworkSymbol } from './web3-strategies/types';
import BN from 'bn.js';

// symbols
export const tokenSymbols = {
  DAI: 'DAI',
  CARD: 'CARD',
  'DAI.CPXD': 'DAI.CPXD',
  'CARD.CPXD': 'CARD.CPXD',
  ETH: 'ETH',
} as const;
export type TokenSymbol = keyof typeof tokenSymbols;

// conversion
export const convertibleSymbols = [
  tokenSymbols.DAI,
  tokenSymbols.CARD,
] as const;

// contract/bridging
export const bridgeableSymbols = [tokenSymbols.DAI, tokenSymbols.CARD] as const;
export const bridgedSymbols = [
  tokenSymbols['DAI.CPXD'],
  tokenSymbols['CARD.CPXD'],
] as const;

// balances
export const layer1BalanceSymbols = [
  tokenSymbols.DAI,
  tokenSymbols.CARD,
  tokenSymbols.ETH,
] as const;

// symbol categories
export type ConvertibleSymbol = typeof convertibleSymbols[number];
export type BridgeableSymbol = typeof bridgeableSymbols[number];
export type Layer1BalanceSymbol = typeof layer1BalanceSymbols[number];
export type BridgedTokenSymbol = typeof bridgedSymbols[number];

export type ConversionFunction = (amountInWei: string) => number;

const contractNames: Record<NetworkSymbol, Record<BridgeableSymbol, string>> = {
  kovan: {
    DAI: 'daiToken',
    CARD: 'cardToken',
  },
  mainnet: {
    DAI: 'daiToken',
    CARD: 'cardToken',
  },
  sokol: {
    DAI: 'daiCpxd',
    CARD: 'cardCpxd',
  },
  // xdai does not have any addresses as of yet.
  xdai: {
    DAI: '',
    CARD: '',
  },
};

export function getUnbridgedSymbol(
  bridgedSymbol: BridgedTokenSymbol
): BridgeableSymbol {
  if (bridgedSymbol === tokenSymbols['DAI.CPXD']) {
    return tokenSymbols.DAI;
  } else if (bridgedSymbol === tokenSymbols['CARD.CPXD']) {
    return tokenSymbols.CARD;
  } else {
    throw new Error(`Unknown bridgedSymbol ${bridgedSymbol}`);
  }
}

export function isBridgedTokenSymbol(
  symbol: TokenSymbol
): symbol is BridgedTokenSymbol {
  return bridgedSymbols.includes(symbol as BridgedTokenSymbol);
}

export class TokenContractInfo {
  symbol: BridgeableSymbol;
  address: ChainAddress;
  abi = ERC20ABI as AbiItem[];

  constructor(symbol: BridgeableSymbol, network: NetworkSymbol) {
    this.symbol = symbol;
    this.address = getAddressByNetwork(
      contractNames[network][this.symbol] as AddressKeys,
      network
    );
  }
}

// display only
interface DisplayInfo {
  name?: string;
  symbol: TokenSymbol;
  description?: string;
  icon: string;
}

const _tokenDisplayInfoMap: Record<TokenSymbol, DisplayInfo> = {
  ETH: {
    symbol: 'ETH',
    icon: 'ethereum-token',
  },
  CARD: {
    name: 'Card',
    symbol: 'CARD',
    description: 'ERC-20 Cardstack token',
    icon: 'card-token',
  },
  DAI: {
    name: 'Dai',
    symbol: 'DAI',
    description: 'USD-based stablecoin',
    icon: 'dai-token',
  },
  'CARD.CPXD': {
    name: 'Card',
    symbol: 'CARD',
    description: '',
    icon: 'card-token',
  },
  'DAI.CPXD': {
    name: 'Dai',
    symbol: 'DAI.CPXD',
    description: '',
    icon: 'dai-token',
  },
};

export class TokenDisplayInfo<T extends TokenSymbol> implements DisplayInfo {
  name: string;
  symbol: T;
  description: string;
  icon: string;

  constructor(symbol: T) {
    this.symbol = symbol;
    let displayInfo = _tokenDisplayInfoMap[symbol];
    this.name = displayInfo.name!;
    this.description = displayInfo.description!;
    this.icon = displayInfo.icon;
  }

  static iconFor(symbol: TokenSymbol) {
    return _tokenDisplayInfoMap[symbol].icon;
  }
}

export class TokenBalance<T extends TokenSymbol> implements DisplayInfo {
  tokenDisplayInfo: TokenDisplayInfo<T>;
  balance: BN;
  constructor(symbol: T, balance: BN) {
    this.tokenDisplayInfo = new TokenDisplayInfo(symbol);
    this.balance = balance;
  }
  get name() {
    return this.tokenDisplayInfo.name;
  }
  get symbol() {
    return this.tokenDisplayInfo.symbol;
  }
  get description() {
    return this.tokenDisplayInfo.description;
  }
  get icon() {
    return this.tokenDisplayInfo.icon;
  }
}
