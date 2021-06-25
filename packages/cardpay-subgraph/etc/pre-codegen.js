/* global __dirname, process, console */

import { writeJSONSync, writeFileSync, readFileSync, removeSync, existsSync, ensureDirSync } from 'fs-extra';
import { join, resolve } from 'path';
import { addFilePreamble } from './pre-tsc-build-entrypoint';

// This file runs before tsc compiles the rest of the mono repo so we need to
// get creative about how we load our data

const sourceAbiDir = resolve(join(__dirname, '..', '..', 'cardpay-sdk', 'contracts', 'abi', 'latest'));
const addressFile = resolve(join(__dirname, '..', '..', 'cardpay-sdk', 'contracts', 'addresses.ts'));
const abiDir = resolve(join(__dirname, '..', 'abis', 'generated'));
const subgraphTemplateFile = resolve(join(__dirname, '..', 'subgraph-template.yaml'));
const subgraphFile = resolve(join(__dirname, '..', 'subgraph.yaml'));

const network = process.argv.slice(2)[0];
if (!network) {
  console.error(`need to specify network`);
  process.exit(1);
}
let cleanNetwork = network.replace('poa-', '');

let abis = {
  PrepaidCardManager: getAbi(join(sourceAbiDir, 'prepaid-card-manager.ts')),
  RevenuePool: getAbi(join(sourceAbiDir, 'revenue-pool.ts')),
  Spend: getAbi(join(sourceAbiDir, 'spend.ts')),
  PayMerchantHandler: getAbi(join(sourceAbiDir, 'pay-merchant-handler.ts')),
  RegisterMerchantHandler: getAbi(join(sourceAbiDir, 'register-merchant-handler.ts')),
  MerchantManager: getAbi(join(sourceAbiDir, 'merchant-manager.ts')),
  SupplierManager: getAbi(join(sourceAbiDir, 'supplier-manager.ts')),
  Exchange: getAbi(join(sourceAbiDir, 'exchange.ts')),
};

removeSync(abiDir);
ensureDirSync(abiDir);
for (let [name, abi] of Object.entries(abis)) {
  if (!abi) {
    continue;
  }
  writeJSONSync(join(abiDir, `${name}.json`), abi, { spaces: 2 });
}

let subgraph = readFileSync(subgraphTemplateFile, { encoding: 'utf8' })
  .replace(/{NETWORK}/g, network)
  .replace(/{PREPAID_CARD_MANAGER_ADDRESS}/g, getAddress('prepaidCardManager', cleanNetwork))
  .replace(/{UNISWAP_V2_FACTORY_ADDRESS}/g, getAddress('uniswapV2Factory', cleanNetwork))
  .replace(/{HOME_TOKEN_BRIDGE_ADDRESS}/g, getAddress('homeBridge', cleanNetwork))
  .replace(/{REVENUE_POOL_ADDRESS}/g, getAddress('revenuePool', cleanNetwork))
  .replace(/{EXCHANGE_ADDRESS}/g, getAddress('exchange', cleanNetwork))
  .replace(/{PAY_MERCHANT_HANDLER_ADDRESS}/g, getAddress('payMerchantHandler', cleanNetwork))
  .replace(/{REGISTER_MERCHANT_HANDLER_ADDRESS}/g, getAddress('registerMerchantHandler', cleanNetwork))
  .replace(/{MERCHANT_MANAGER_ADDRESS}/g, getAddress('merchantManager', cleanNetwork))
  .replace(/{SUPPLIER_MANAGER_ADDRESS}/g, getAddress('supplierManager', cleanNetwork))
  .replace(/{SPEND_ADDRESS}/g, getAddress('spend', cleanNetwork));
removeSync(subgraphFile);
writeFileSync(subgraphFile, subgraph);

addFilePreamble(
  subgraphFile,
  `### This is an auto generated file, please do not edit this file ###
`
);

function getAbi(path) {
  if (!existsSync(path)) {
    return;
  }
  let file = readFileSync(path, { encoding: 'utf8' })
    .replace(/^export default /, '')
    .replace(/;$/, '');
  return eval(file);
}

function getAddress(contractName, network) {
  let file = readFileSync(addressFile, { encoding: 'utf8' });
  let [, networkContents] = file.match(new RegExp(`${network}: {([^}]*)}`));
  let [, address] = networkContents.match(new RegExp(`${contractName}: ['"](\\w*)['"]`));
  return address;
}
